# Twice-weekly official-catalog refresh, run by a Claude Cowork scheduled task.
#
# Collect over plain HTTP -> extract (the pipeline calls Gemini for changed
# pages only) -> publish -> prove it -> commit -> push.
#
# Unlike weekly-refresh.ps1, this one DOES extract, publish, commit and push —
# the owner asked for new discounts to reach the data unattended. What makes
# that safe is not this script being careful; it is the gates it refuses to
# skip:
#   - the 0.85 confidence gate: nothing below it ships without a human
#   - validate:data: blocked a 221.85% discount from shipping once already
#   - shipped-data.test: the catalog must parse with the app's own schemas
# Any of them failing restores the owned paths and publishes nothing.
#
# Owns exactly two paths: collected/catalogs and data/benefits.json. It never
# stages anything else — collected/easy is routinely left dirty by the Windows
# link-check tasks, which deliberately do not commit, and a `git add -A` here
# would sweep their half-finished work into an unattended commit.
#
# It never deletes data/generated: human approvals made in `review` live there
# until publish, and a fresh start would silently throw them away.
#
# Log: data/generated/catalog-refresh.log (git-ignored, appended, newest last).
# Last line of every run is a RESULT line the scheduled task reports verbatim.
#
#   powershell -File scripts/refresh-catalogs.ps1            # the real run
#   powershell -File scripts/refresh-catalogs.ps1 -DryRun    # everything but commit/push

param([switch]$DryRun)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$log = Join-Path $repo 'data\generated\catalog-refresh.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Write-Log($text) {
    $text | Add-Content -Path $log -Encoding utf8
    Write-Output $text
}

$owned = @('collected/catalogs', 'data/benefits.json')

function Restore-Owned {
    # Owned paths were verified clean at the start, so anything here now came
    # from this run and is regenerable: collection is free HTTP, and every model
    # answer is already in the git-ignored cache.
    git checkout -- $owned 2>&1 | Out-Null
    git clean -fdq -- collected/catalogs 2>&1 | Out-Null
}

function Stop-Run($why, [int]$code = 1, [switch]$Restore) {
    if ($Restore) { Restore-Owned }
    Write-Log "RESULT: FAILED - $why"
    exit $code
}

function Get-CatalogCount {
    node -e "console.log(require('./data/benefits.json').length)"
}

Write-Log ""
Write-Log "=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') $(if ($DryRun) { '(dry run)' }) ==="

# --- preflight -------------------------------------------------------------
$dirty = git status --porcelain -- $owned
if ($dirty) {
    # Someone is mid-change in a path this run would overwrite. Mixing their
    # work into an unattended commit is worse than skipping a refresh.
    Write-Log $dirty
    Stop-Run "owned paths have uncommitted changes; not mixing them into an unattended commit"
}

git fetch origin --quiet 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) { Stop-Run "git fetch failed (offline?)" }

# --ff-only, not rebase: rebase refuses to run with the link-check tasks'
# uncommitted files present, and a fast-forward leaves them alone.
git merge --ff-only origin/main 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) {
    Stop-Run "local main cannot fast-forward to origin/main; resolve by hand, then re-run"
}

$before = Get-CatalogCount
Write-Log "catalog before: $before"

# --- collect ---------------------------------------------------------------
# Plain HTTP, no API key. A catalog that returns less than half its previous
# size is refused inside the collector, so a site that is down this morning
# leaves its last good file in place.
# --limit 150, not 60: at 60, max lost 13 of its 73 seeded offers every run and
# fly_card and p100_members both stopped at exactly 60.
node scripts/collect-catalog.mjs --all --limit 150 --concurrency 3 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) { Stop-Run "collection crashed (exit $LASTEXITCODE)" -Restore }

# --- extract ---------------------------------------------------------------
# The extraction pipeline itself calls Gemini (with a model pool that steps down
# when a model's daily quota runs out), so there is no separate model pass here.
# Keyed by content_hash: a page whose text did not change since the last run is
# a cache hit and never reaches the model.
#
# The app's key in apps/mobile/.env is the key of record and wins over any
# GEMINI_API_KEY already in the environment: one stale value there once cost a
# whole pass to "API key not valid" while the working key sat in .env.
$envFile = Join-Path $repo 'apps\mobile\.env'
$appKey = if (Test-Path $envFile) {
    (Select-String -Path $envFile -Pattern '^EXPO_PUBLIC_GEMINI_API_KEY=(.+)$' | Select-Object -First 1).Matches.Groups[1].Value.Trim()
}
if ($appKey) {
    $env:GEMINI_API_KEY = $appKey
    Write-Log "gemini key: apps/mobile/.env"
} elseif ($env:GEMINI_API_KEY) {
    Write-Log "gemini key: GEMINI_API_KEY from the environment"
} else {
    Stop-Run "no Gemini key: set EXPO_PUBLIC_GEMINI_API_KEY in apps/mobile/.env" -Restore
}

# npm.cmd, never bare `npm`. In PowerShell `npm` resolves to the npm.ps1 shim,
# and PowerShell consumes the `--` as its own end-of-parameters marker before
# npm sees it — so `--collected` reached npm as an unknown config flag and every
# program failed with EUNKNOWNCONFIG. It went unnoticed because a positional
# argument after `--` (the test file below) still gets through.
$pipelineFailures = @()
$pageFailures = 0
$programs = @(Get-ChildItem collected/catalogs -Filter *.jsonl)
foreach ($file in $programs) {
    $program = $file.BaseName
    npm.cmd run extract -- --collected "collected/catalogs/$($file.Name)" --program $program --all 2>&1 |
        Select-String -Pattern '^(benefits|published|review|failures):' |
        ForEach-Object {
            Write-Log "  $program  $($_.Line)"
            # A page the model could not read exits 0 — only a crash or a missing
            # key is a non-zero exit — so page failures are counted from the report.
            if ($_.Line -match '^failures:\s*(\d+)') { $pageFailures += [int]$Matches[1] }
        }
    # One program failing keeps its previous benefits live; the gates below
    # still decide whether anything else ships.
    if ($LASTEXITCODE -ne 0) { $pipelineFailures += $program }
}

# Every program failing is a broken pipeline, not a quiet week. Without this the
# catalog comes out unchanged, every gate passes on the unchanged catalog, and
# the run reports "no changes" — the one outcome indistinguishable from health.
if ($programs.Count -gt 0 -and $pipelineFailures.Count -eq $programs.Count) {
    Stop-Run "the extraction pipeline failed for all $($programs.Count) programs" -Restore
}

# --- publish, then prove it ------------------------------------------------
npm.cmd run publish:catalog 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) { Stop-Run "publish:catalog failed" -Restore }

npm.cmd run validate:data 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) { Stop-Run "validate:data rejected the catalog - nothing published" -Restore }

npm.cmd run -w @sbr/core test -- tests/shipped-data.test.ts 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) { Stop-Run "shipped catalog no longer parses with the app's schemas" -Restore }

$after = Get-CatalogCount
$changes = git status --porcelain -- $owned
$notes = @()
if ($pipelineFailures.Count) { $notes += "pipeline failed for: $($pipelineFailures -join ', ')" }
if ($pageFailures) { $notes += "$pageFailures pages unread by the model, retried next run" }
$note = if ($notes.Count) { " ($($notes -join '; '))" } else { '' }

if (-not $changes) {
    Write-Log "RESULT: no changes - catalog $before$note"
    exit 0
}

if ($DryRun) {
    git diff --stat -- $owned 2>&1 | ForEach-Object { Write-Log $_ }
    Restore-Owned
    Write-Log "RESULT: DRY RUN - would publish catalog $before -> $after$note"
    exit 0
}

# --- commit only what this run owns, then push -----------------------------
git add -- $owned 2>&1 | Out-Null
$message = @"
refresh official catalogs: $before -> $after benefits

Unattended twice-weekly run of scripts/refresh-catalogs.ps1. Passed the
0.85 confidence gate, validate:data and shipped-data.test before commit.$note

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
"@
git commit --quiet -m $message 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) { Stop-Run "git commit failed" -Restore }

# Never forced. If origin moved in the minutes since the fetch, the commit stays
# local and the next run fast-forwards past it only after a human looks.
git push origin HEAD:main 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Log "RESULT: COMMITTED LOCALLY, PUSH FAILED - catalog $before -> $after; push by hand"
    exit 1
}

Write-Log "RESULT: PUBLISHED - catalog $before -> $after$note"
exit 0
