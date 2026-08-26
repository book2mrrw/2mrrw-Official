param(
  [Parameter(Mandatory = $true)][string]$SourceRef,
  [Parameter(Mandatory = $true)][string]$CloneRef
)

$ErrorActionPreference = "Stop"

function Get-ProjectKeys([string]$ProjectRef) {
  $json = cmd /c npx.cmd supabase projects api-keys --project-ref $ProjectRef --output json
  if ($LASTEXITCODE -ne 0) { throw "Unable to retrieve API-key metadata for $ProjectRef" }
  $keys = $json | ConvertFrom-Json
  $admin = $keys | Where-Object { $_.name -in @("secret", "service_role") } | Select-Object -First 1
  $public = $keys | Where-Object { $_.name -in @("publishable", "anon") } | Select-Object -First 1
  if (-not $admin -or -not $public) { throw "Required API-key classes are unavailable for $ProjectRef" }
  return @{ Admin = $admin.api_key; Public = $public.api_key }
}

function Invoke-Api([string]$ProjectRef, [string]$ApiKey, [string]$Path, [string]$Method = "GET", [hashtable]$ExtraHeaders = @{}) {
  $headers = @{ apikey = $ApiKey; Authorization = "Bearer $ApiKey" }
  foreach ($name in $ExtraHeaders.Keys) { $headers[$name] = $ExtraHeaders[$name] }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri "https://${ProjectRef}.supabase.co/rest/v1/$Path" -Headers $headers
    return @{ Status = [int]$response.StatusCode; Headers = $response.Headers; Content = $response.Content }
  } catch {
    if ($_.Exception.Response) {
      return @{ Status = [int]$_.Exception.Response.StatusCode; Headers = $_.Exception.Response.Headers; Content = "" }
    }
    throw
  }
}

function Get-OpenApiFingerprint([string]$ProjectRef, [string]$ApiKey) {
  $result = Invoke-Api $ProjectRef $ApiKey "" "GET" @{ Accept = "application/openapi+json" }
  if ($result.Status -ne 200) { throw "OpenAPI request failed for $ProjectRef with $($result.Status)" }
  $json = if ($result.Content -is [byte[]]) {
    [Text.Encoding]::UTF8.GetString($result.Content)
  } else {
    [string]$result.Content
  }
  $document = $json | ConvertFrom-Json
  $paths = @($document.paths.PSObject.Properties.Name | Sort-Object)
  $schemaContainer = if ($document.definitions) { $document.definitions } else { $document.components.schemas }
  $schemas = @($schemaContainer.PSObject.Properties.Name | Sort-Object)
  if ($paths.Count -eq 0 -or $schemas.Count -eq 0) {
    throw "OpenAPI document for $ProjectRef contained no paths or schemas"
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($paths -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  $digest = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
  return @{ PathCount = $paths.Count; SchemaCount = $schemas.Count; PathDigest = $digest; Paths = $paths }
}

function Get-ExactCount([string]$ProjectRef, [string]$ApiKey, [string]$Table) {
  $result = Invoke-Api $ProjectRef $ApiKey "${Table}?select=*&limit=0" "HEAD" @{ Prefer = "count=exact" }
  $range = [string]$result.Headers["Content-Range"]
  $count = if ($range -match "/(\d+)$") { [int64]$Matches[1] } else { $null }
  return @{ Status = $result.Status; Count = $count }
}

$sourceKeys = Get-ProjectKeys $SourceRef
$cloneKeys = Get-ProjectKeys $CloneRef
$sourceApi = Get-OpenApiFingerprint $SourceRef $sourceKeys.Admin
$cloneApi = Get-OpenApiFingerprint $CloneRef $cloneKeys.Admin

$sourceOnly = @($sourceApi.Paths | Where-Object { $_ -notin $cloneApi.Paths })
$cloneOnly = @($cloneApi.Paths | Where-Object { $_ -notin $sourceApi.Paths })

$tables = @(
  "releases", "catalog_tracks", "products", "admin_principals",
  "processed_stripe_events", "account_lifecycle_requests",
  "mfa_authority_generations", "mfa_authority_sessions", "mfa_authority_events"
)
$appendOnlyOrEphemeral = @("processed_stripe_events", "mfa_authority_sessions", "mfa_authority_events")
$countResults = foreach ($table in $tables) {
  $source = Get-ExactCount $SourceRef $sourceKeys.Admin $table
  $clone = Get-ExactCount $CloneRef $cloneKeys.Admin $table
  $countsPresent = $null -ne $source.Count -and $null -ne $clone.Count
  $countMatch = if ($table -in $appendOnlyOrEphemeral) {
    $countsPresent -and $clone.Count -le $source.Count
  } else {
    $countsPresent -and $clone.Count -eq $source.Count
  }
  [pscustomobject]@{
    Table = $table
    Mode = if ($table -in $appendOnlyOrEphemeral) { "snapshot<=source" } else { "exact" }
    SourceStatus = $source.Status
    CloneStatus = $clone.Status
    SourceCount = $source.Count
    CloneCount = $clone.Count
    Match = ($source.Status -in @(200, 206) -and $clone.Status -in @(200, 206) -and $countMatch)
  }
}

$protected = @(
  "admin_principals", "mfa_authority_generations", "mfa_authority_sessions",
  "mfa_authority_events", "account_lifecycle_requests"
)
$anonResults = foreach ($table in $protected) {
  $probe = Invoke-Api $CloneRef $cloneKeys.Public "${table}?select=*&limit=1"
  [pscustomobject]@{ Table = $table; Status = $probe.Status; Denied = $probe.Status -in @(401, 403, 404) }
}

[pscustomobject]@{
  SourceRef = $SourceRef
  CloneRef = $CloneRef
  SourcePathCount = $sourceApi.PathCount
  ClonePathCount = $cloneApi.PathCount
  SourceSchemaCount = $sourceApi.SchemaCount
  CloneSchemaCount = $cloneApi.SchemaCount
  SourcePathDigest = $sourceApi.PathDigest
  ClonePathDigest = $cloneApi.PathDigest
  SourceOnlyPaths = $sourceOnly.Count
  CloneOnlyPaths = $cloneOnly.Count
  OpenApiMatch = ($sourceOnly.Count -eq 0 -and $cloneOnly.Count -eq 0)
} | Format-List

$countResults | Format-Table -AutoSize
$anonResults | Format-Table -AutoSize

$failed = @($countResults | Where-Object { -not $_.Match }).Count -gt 0 -or
          @($anonResults | Where-Object { -not $_.Denied }).Count -gt 0 -or
          $sourceOnly.Count -gt 0 -or $cloneOnly.Count -gt 0

if ($failed) {
  Write-Error "SUPABASE PHYSICAL CLONE CERTIFICATION: FAIL"
  exit 1
}

Write-Output "SUPABASE PHYSICAL CLONE CERTIFICATION: PASS"
