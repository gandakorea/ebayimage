param(
    [string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local')
)

$ErrorActionPreference = 'Stop'

function Read-EnvironmentFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Environment file not found: $Path"
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([^#=]+)=(.*)$') {
            $values[$matches[1].Trim()] = $matches[2]
        }
    }
    return $values
}

function Set-EnvironmentValue([System.Collections.Generic.List[string]]$Lines, [string]$Name, [string]$Value) {
    for ($index = 0; $index -lt $Lines.Count; $index++) {
        if ($Lines[$index] -match ('^' + [regex]::Escape($Name) + '=')) {
            $Lines[$index] = "$Name=$Value"
            return
        }
    }
    $Lines.Add("$Name=$Value")
}

$settings = Read-EnvironmentFile $EnvironmentFile
$required = 'EBAY_AU_CLIENT_ID', 'EBAY_AU_CLIENT_SECRET', 'EBAY_AU_REFRESH_TOKEN'
foreach ($name in $required) {
    if ([string]::IsNullOrWhiteSpace($settings[$name])) {
        throw "Missing $name in $EnvironmentFile"
    }
}

$scopes = @(
    'https://api.ebay.com/oauth/api_scope'
    'https://api.ebay.com/oauth/api_scope/sell.inventory'
    'https://api.ebay.com/oauth/api_scope/sell.account'
    'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'
    'https://api.ebay.com/oauth/api_scope/sell.stores'
    'https://api.ebay.com/oauth/api_scope/sell.listing'
) -join ' '

$credential = $settings['EBAY_AU_CLIENT_ID'] + ':' + $settings['EBAY_AU_CLIENT_SECRET']
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($credential))
$token = Invoke-RestMethod `
    -Uri 'https://api.ebay.com/identity/v1/oauth2/token' `
    -Method Post `
    -Headers @{ Authorization = "Basic $basic" } `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{
        grant_type    = 'refresh_token'
        refresh_token = $settings['EBAY_AU_REFRESH_TOKEN']
        scope          = $scopes
    }

if ([string]::IsNullOrWhiteSpace($token.access_token)) {
    throw 'eBay did not return an access token.'
}

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    $lines.Add([string]$line)
}

$expiresAt = (Get-Date).ToUniversalTime().AddSeconds([int]$token.expires_in).ToString('o')
Set-EnvironmentValue $lines 'EBAY_AU_USER_TOKEN' $token.access_token
Set-EnvironmentValue $lines 'EBAY_AU_TOKEN_EXPIRES_AT' $expiresAt
[IO.File]::WriteAllLines($EnvironmentFile, $lines, [Text.UTF8Encoding]::new($false))

Write-Output "eBay AU access token refreshed; expires at $expiresAt"
