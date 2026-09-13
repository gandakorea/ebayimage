$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent

$targets = @(
    [pscustomobject]@{ Part='31010-3X000'; UsListing='237065860966'; AuListing='267783936922'; AuSku='31010-3X000-AU-20260913-d5f2716d' },
    [pscustomobject]@{ Part='26510-26600'; UsListing='237065860699'; AuListing='267783936829'; AuSku='26510-26600-AU-20260913-ae3ea033' }
)

function Read-Env([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"') }
    }
    $values
}

function Xml([string]$Value) { [Security.SecurityElement]::Escape($Value) }

function Invoke-Trading([string]$Token, [string]$Call, [string]$SiteId, [string]$Body) {
    $headers = @{
        'X-EBAY-API-CALL-NAME' = $Call
        'X-EBAY-API-SITEID' = $SiteId
        'X-EBAY-API-COMPATIBILITY-LEVEL' = '1193'
        'X-EBAY-API-IAF-TOKEN' = $Token
    }
    $response = Invoke-WebRequest -Uri 'https://api.ebay.com/ws/api.dll' -Method Post -Headers $headers -ContentType 'text/xml; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($Body))
    [xml]$response.Content
}

function Assert-Trading([xml]$Response, [string]$Stage) {
    $ack = [string]$Response.DocumentElement.Ack
    if ($ack -notin @('Success','Warning')) {
        $messages = @($Response.DocumentElement.Errors | ForEach-Object { "[$($_.ErrorCode)] $($_.LongMessage)" }) -join '; '
        throw "$Stage failed: $messages"
    }
}

function Invoke-EbayJson([string]$Token, [string]$Uri, [string]$Method, $Body = $null) {
    $headers = @{ Authorization="Bearer $Token"; 'X-EBAY-C-MARKETPLACE-ID'='EBAY_AU'; 'Content-Language'='en-AU'; Accept='application/json' }
    $parameters = @{ Uri=$Uri; Method=$Method; Headers=$headers }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 80 -Compress))
    }
    Invoke-RestMethod @parameters
}

function Get-Images([string]$Part) {
    $directory = Join-Path $projectRoot "완성본\$Part"
    $escaped = [regex]::Escape($Part)
    @(Get-ChildItem -LiteralPath $directory -File -Filter '*.png' |
        Where-Object { $_.BaseName -match "^$escaped(?:_\d+)?$" } |
        Sort-Object @{Expression={ if ($_.BaseName -eq $Part) { 0 } else { [int]($_.BaseName.Split('_')[-1]) } }})
}

function Upload-Images([string]$Token, $Files) {
    @($Files | ForEach-Object {
        $response = Invoke-WebRequest -Uri 'https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file' -Method Post -Headers @{Authorization="Bearer $Token";Accept='application/json'} -Form @{image=$_}
        $payload = $response.Content | ConvertFrom-Json
        $url = [string]$payload.maxDimensionImageUrl
        if ([string]::IsNullOrWhiteSpace($url)) { $url = [string]$payload.imageUrl }
        if ([string]::IsNullOrWhiteSpace($url)) { throw "Image upload failed: $($_.Name)" }
        $url
    })
}

function Get-PublicPictures([string]$Token, [string]$SiteId, [string]$ListingId) {
    $body = '<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>'+(Xml $ListingId)+'</ItemID><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>'
    $response = Invoke-Trading $Token 'GetItem' $SiteId $body
    Assert-Trading $response "GetItem $ListingId"
    @($response.GetItemResponse.Item.PictureDetails.PictureURL)
}

$envs = Read-Env (Join-Path $projectRoot '.env.ebay.local')
$usToken = $envs['EBAY_US_ACCESS_TOKEN']
$auToken = $envs['EBAY_AU_USER_TOKEN']
$usIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $usToken"}
$auIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $auToken"}
if ($usIdentity.username -ne 'gandakorea' -or $usIdentity.registrationMarketplaceId -ne 'EBAY_US') { throw 'US account mismatch.' }
if ($auIdentity.username -ne 'sihooshop' -or $auIdentity.registrationMarketplaceId -ne 'EBAY_AU') { throw 'AU account mismatch.' }

$results = @()

# Finish the full US correction batch before changing AU.
foreach ($target in $targets) {
    $files = Get-Images $target.Part
    $urls = Upload-Images $usToken $files
    $pictures = @($urls | ForEach-Object { '<PictureURL>'+(Xml $_)+'</PictureURL>' }) -join ''
    $body = '<?xml version="1.0" encoding="utf-8"?><ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel><Item><ItemID>'+$target.UsListing+'</ItemID><PictureDetails>'+$pictures+'</PictureDetails></Item></ReviseFixedPriceItemRequest>'
    $response = Invoke-Trading $usToken 'ReviseFixedPriceItem' '100' $body
    Assert-Trading $response "US image update $($target.Part)"
    $publicUrls = Get-PublicPictures $usToken '100' $target.UsListing
    if ($publicUrls.Count -ne $files.Count) { throw "US image verification failed: $($target.Part)" }
    $results += [pscustomobject]@{Part=$target.Part; Marketplace='US'; Seller='gandakorea'; ListingId=$target.UsListing; Images=$publicUrls.Count}
}

foreach ($target in $targets) {
    $files = Get-Images $target.Part
    $urls = Upload-Images $auToken $files
    $inventoryUrl = 'https://api.ebay.com/sell/inventory/v1/inventory_item/'+[uri]::EscapeDataString($target.AuSku)
    $current = Invoke-EbayJson $auToken $inventoryUrl 'GET'
    $product = [ordered]@{ title=$current.product.title; imageUrls=@($urls); aspects=$current.product.aspects }
    foreach ($name in 'description','brand','mpn','ean','upc') {
        if ($null -ne $current.product.$name -and -not [string]::IsNullOrWhiteSpace([string]$current.product.$name)) { $product[$name] = $current.product.$name }
    }
    $payload = [ordered]@{ availability=$current.availability; condition=$current.condition; product=$product }
    if ($null -ne $current.packageWeightAndSize) { $payload['packageWeightAndSize'] = $current.packageWeightAndSize }
    if ($null -ne $current.conditionDescription) { $payload['conditionDescription'] = $current.conditionDescription }
    if ($null -ne $current.conditionDescriptors) { $payload['conditionDescriptors'] = $current.conditionDescriptors }
    Invoke-EbayJson $auToken $inventoryUrl 'PUT' $payload | Out-Null
    $saved = Invoke-EbayJson $auToken $inventoryUrl 'GET'
    if (@($saved.product.imageUrls).Count -ne $files.Count) { throw "AU inventory image verification failed: $($target.Part)" }
    Start-Sleep -Seconds 2
    $publicUrls = Get-PublicPictures $auToken '15' $target.AuListing
    if ($publicUrls.Count -ne $files.Count) { throw "AU public image verification failed: $($target.Part)" }
    $results += [pscustomobject]@{Part=$target.Part; Marketplace='AU'; Seller='sihooshop'; ListingId=$target.AuListing; Images=$publicUrls.Count}
}

$results | ConvertTo-Json -Depth 5
