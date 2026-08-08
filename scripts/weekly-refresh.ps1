# Weekly easy.co.il refresh, run by Windows Task Scheduler.
#
# Deliberately does NOT extract, commit, or publish. It refreshes the collected
# JSONL and tells you whether anything moved; turning that into benefits costs
# money and judgement, so it stays a decision you make at the keyboard.
#
# Log: data/generated/weekly-refresh.log (git-ignored, appended, newest last).

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$log = Join-Path $repo 'data\generated\weekly-refresh.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Write-Log($text) { $text | Add-Content -Path $log -Encoding utf8 }

Write-Log ""
Write-Log "=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="

npm run scrape:easy 2>&1 | ForEach-Object { Write-Log $_ }
$code = $LASTEXITCODE

if ($code -ne 0) {
    # The scraper refuses to write a file whose crawl was cut short, so a
    # failure here means the previous catalog is intact, not half-overwritten.
    Write-Log "RESULT: FAILED (exit $code) - existing catalog left untouched"
    exit $code
}

# Prove the links still resolve. Without this the catalog slowly fills with
# deals pointing at businesses that closed, and nothing ever notices.
node scripts/validate-easy.mjs 2>&1 | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Log "RESULT: FAILED - validation could not verify anything"
    exit $LASTEXITCODE
}

$changed = git status --porcelain -- collected/easy
if ($changed) {
    Write-Log "RESULT: CHANGED"
    Write-Log $changed
    Write-Log "Next: npm run extract -- --collected collected/easy/<file>.jsonl --program <id> --all"
} else {
    Write-Log "RESULT: no changes"
}
