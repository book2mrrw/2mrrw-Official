$ErrorActionPreference = "Stop"
$webRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $webRoot

Write-Host "2MRRW E1-M RAW PASSWORD CERTIFICATION" -ForegroundColor Cyan
Write-Host "Enter credentials only in this window. Do not enter an OTP." -ForegroundColor Yellow
Write-Host ""

node --env-file=.env.local scripts/security/certify-live-raw-password-mfa.mjs
$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
  Write-Host "Certification command completed successfully." -ForegroundColor Green
} else {
  Write-Host "Certification command stopped with exit code $exitCode." -ForegroundColor Red
}
Read-Host "Press Enter to close this window"
