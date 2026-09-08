param([string]$ItemId = '236877675342')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$token = ((Get-Content -LiteralPath (Join-Path $root '.env.ebay.local') | Where-Object { $_ -match '^EBAY_ACCESS_TOKEN=' } | Select-Object -First 1) -replace '^EBAY_ACCESS_TOKEN=', '').Trim()
$headers = @{
 'X-EBAY-API-CALL-NAME' = 'GetItem'
 'X-EBAY-API-SITEID' = '0'
 'X-EBAY-API-COMPATIBILITY-LEVEL' = '1193'
 'X-EBAY-API-IAF-TOKEN' = $token
}
$body = '<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>' + $ItemId + '</ItemID><OutputSelector>Item.Title</OutputSelector><OutputSelector>Item.PictureDetails</OutputSelector><OutputSelector>Item.ItemSpecifics</OutputSelector></GetItemRequest>'
try {
 [xml]$result = Invoke-RestMethod -Uri 'https://api.ebay.com/ws/api.dll' -Method Post -Headers $headers -ContentType 'text/xml; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
 $dir = Join-Path $root "작업중/ebay-$ItemId"
 New-Item -ItemType Directory -Path $dir -Force | Out-Null
 $result.Save((Join-Path $dir 'item.xml'))
 $result.OuterXml
} catch { Write-Output ('Request failed: ' + $_.Exception.Message); exit 1 }
