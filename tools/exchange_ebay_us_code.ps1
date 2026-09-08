param(
    [Parameter(Mandatory = $true)]
    [string]$Code
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env.ebay.local'

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Missing $envPath"
}

$lines = [System.Collections.Generic.List[string]]::new()
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    $lines.Add($line)
    if ($line -match '^([^#=]+)=(.*)$') {
        $settings[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$required = 'EBAY_AU_CLIENT_ID', 'EBAY_AU_CLIENT_SECRET', 'EBAY_AU_RU_NAME'
foreach ($key in $required) {
    if (-not $settings.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($settings[$key])) {
        throw "Missing required setting: $key"
    }
}

$credential = $settings['EBAY_AU_CLIENT_ID'] + ':' + $settings['EBAY_AU_CLIENT_SECRET']
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($credential))
$token = Invoke-RestMethod `
    -Method Post `
    -Uri 'https://api.ebay.com/identity/v1/oauth2/token' `
    -Headers @{ Authorization = "Basic $basic" } `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{
        grant_type   = 'authorization_code'
        code         = $Code
        redirect_uri = $settings['EBAY_AU_RU_NAME']
    }

$identity = Invoke-RestMethod `
    -Method Get `
    -Uri 'https://apiz.ebay.com/commerce/identity/v1/user/' `
    -Headers @{ Authorization = "Bearer $($token.access_token)" }

if ($identity.username -ne 'gandakorea') {
    throw "Refusing to save US token: authenticated seller is '$($identity.username)', expected 'gandakorea'."
}

function Set-EnvValue([string]$Name, [string]$Value) {
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match "^$([regex]::Escape($Name))=") {
            $lines[$index] = "$Name=$Value"
            return
        }
    }
    $lines.Add("$Name=$Value")
}

$expiresAt = [DateTimeOffset]::UtcNow.AddSeconds([int]$token.expires_in).ToString('o')
Set-EnvValue 'EBAY_ACCESS_TOKEN' $token.access_token
Set-EnvValue 'EBAY_US_ACCESS_TOKEN' $token.access_token
Set-EnvValue 'EBAY_US_REFRESH_TOKEN' $token.refresh_token
Set-EnvValue 'EBAY_US_TOKEN_EXPIRES_AT' $expiresAt
Set-EnvValue 'EBAY_US_REFRESH_TOKEN_EXPIRES_IN' ([string]$token.refresh_token_expires_in)
Set-EnvValue 'EBAY_US_CLIENT_ID' $settings['EBAY_AU_CLIENT_ID']
Set-EnvValue 'EBAY_US_CLIENT_SECRET' $settings['EBAY_AU_CLIENT_SECRET']
Set-EnvValue 'EBAY_US_RU_NAME' $settings['EBAY_AU_RU_NAME']
Set-EnvValue 'EBAY_US_MARKETPLACE_ID' 'EBAY_US'

[IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))
Write-Output "Authenticated seller: $($identity.username)"
Write-Output "US access token expires at: $expiresAt"
