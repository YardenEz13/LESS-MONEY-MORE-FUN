# Daily link check, run by Windows Task Scheduler.
#
# easy allows roughly 500 requests before it starts refusing, and that budget
# refills with time rather than with patience inside a run. So the way to full
# coverage is one modest pass per day, not a long burst: settled links are
# skipped, so each day proves another slice and the number climbs on its own.
#
# Deliberately separate from the weekly refresh. That one re-crawls and can
# take an hour; this is a few minutes and needs to happen more often.
#
# Log: data/generated/link-check.log (git-ignored, appended, newest last).

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$log = Join-Path $repo 'data\generated\link-check.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

"" | Add-Content -Path $log -Encoding utf8
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" | Add-Content -Path $log -Encoding utf8

node scripts/validate-easy.mjs 2>&1 | ForEach-Object { $_ | Add-Content -Path $log -Encoding utf8 }

# A rate-limited pass exits non-zero, which is normal here and not a failure
# worth alerting on — it simply means today's budget ran out. The COVERAGE line
# in the log is the number to watch.
exit 0
