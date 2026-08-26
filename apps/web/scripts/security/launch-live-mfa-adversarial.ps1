$ErrorActionPreference = "Stop"
$webRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $webRoot
Write-Host "2MRRW E1-M LIVE ADVERSARIAL SESSION CERTIFICATION" -ForegroundColor Cyan
Write-Host "Credentials and OTP stay inside this window and are never printed." -ForegroundColor Yellow
Write-Host ""
node scripts/security/certify-live-mfa-adversarial.mjs
$exitCode = $LASTEXITCODE
Write-Host ""
Write-Host "Certification exit code: $exitCode" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })
Read-Host "Press Enter to close this window"
