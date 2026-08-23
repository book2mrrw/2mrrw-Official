<#
  Runs the E0 end-to-end escalation check.

  Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY straight from
  apps/web/.env.production.pulled, so neither value has to be typed or pasted
  anywhere. Both are public-by-design (they ship in the client bundle).

  The service-role key is never read by this script, and e0-http-check.mjs
  refuses one outright — running the check with elevated credentials would
  produce a meaningless pass.

  USAGE — supply ONE of:

    .\run-e0-http-check.ps1 -Email eellianmorrow@gmail.com -Password '...'
    .\run-e0-http-check.ps1 -AccessToken 'eyJ...'

  The account must be NON-admin. The check refuses an admin account.
#>

param(
  [string]$Email,
  [string]$Password,
  [string]$AccessToken,
  [string]$Url     = "https://qvfbgkbgczyqrglvgyqr.supabase.co",
  [string]$AnonKey,
  [string]$EnvFile = "$PSScriptRoot\..\..\.env.production.pulled"
)

function Get-EnvValue([string]$name) {
  if (-not (Test-Path $EnvFile)) { return $null }
  $line = Select-String -Path $EnvFile -Pattern "^\s*$name\s*=" | Select-Object -First 1
  if (-not $line) { return $null }
  $v = ($line.Line -split '=', 2)[1].Trim()
  # strip surrounding single or double quotes
  if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) {
    $v = $v.Substring(1, $v.Length - 2)
  }
  if ([string]::IsNullOrWhiteSpace($v)) { return $null }
  return $v
}

# Parameter wins, then the env file. `vercel env pull` writes NAMES with empty
# values for encrypted vars, so the file is frequently useless — hence -AnonKey.
$url  = if ($Url)     { $Url }     else { Get-EnvValue 'NEXT_PUBLIC_SUPABASE_URL' }
$anon = if ($AnonKey) { $AnonKey } else { Get-EnvValue 'NEXT_PUBLIC_SUPABASE_ANON_KEY' }

if ([string]::IsNullOrWhiteSpace($url)) {
  Write-Host "ABORT: no Supabase URL. Pass -Url https://<project>.supabase.co" -ForegroundColor Red
  exit 2
}
if ([string]::IsNullOrWhiteSpace($anon)) {
  Write-Host "ABORT: no anon key. Pass -AnonKey '<public anon key>'." -ForegroundColor Red
  Write-Host "       Supabase dashboard -> Project Settings -> API -> anon / public" -ForegroundColor DarkGray
  Write-Host "       ($EnvFile has the name but an empty value)" -ForegroundColor DarkGray
  exit 2
}

# Refuse a service-role key outright — running this check with elevated
# credentials would produce a meaningless pass.
try {
  $payload = $anon.Split('.')[1]
  $pad = '=' * ((4 - ($payload.Length % 4)) % 4)
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($payload -replace '-','+' -replace '_','/') + $pad))
  if ($json -match 'service_role') {
    Write-Host "ABORT: that is the SERVICE ROLE key. Use the PUBLIC anon key." -ForegroundColor Red
    exit 2
  }
} catch { }

# Show only enough to confirm the right project, never the key itself.
Write-Host ""
Write-Host "  project : $url"
Write-Host "  anon key: loaded ($($anon.Length) chars)"
Write-Host ""

$env:SUPABASE_URL      = $url
$env:SUPABASE_ANON_KEY = $anon

if ($AccessToken) {
  $env:TEST_ACCESS_TOKEN = $AccessToken
  Remove-Item Env:\TEST_EMAIL    -ErrorAction SilentlyContinue
  Remove-Item Env:\TEST_PASSWORD -ErrorAction SilentlyContinue
} elseif ($Email -and $Password) {
  $env:TEST_EMAIL    = $Email
  $env:TEST_PASSWORD = $Password
  Remove-Item Env:\TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
} else {
  Write-Host "ABORT: supply -Email and -Password, or -AccessToken" -ForegroundColor Red
  exit 2
}

node "$PSScriptRoot\e0-http-check.mjs"
$code = $LASTEXITCODE

# Do not leave credentials in the shell session.
Remove-Item Env:\TEST_PASSWORD     -ErrorAction SilentlyContinue
Remove-Item Env:\TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue

exit $code
