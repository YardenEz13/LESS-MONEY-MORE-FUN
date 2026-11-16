# Start Chrome for scripts/gemini-chrome-verify.mjs: a dedicated profile with a
# debugging port. Log in to your Google account in this window once; the login is
# kept in the profile folder. Chrome refuses a debugging port on your everyday
# profile, which is why this one is separate.
param([int]$Port = 9222)

$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error 'Chrome not found'; exit 1 }

$profile = Join-Path $env:LOCALAPPDATA 'lmmf-gemini-chrome'
Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$profile",
    '--no-first-run',
    'https://gemini.google.com/app'
)
Write-Output "Chrome started on port $Port. Log in to Gemini if asked, then run:"
Write-Output '  node scripts/gemini-chrome-verify.mjs --probe'
