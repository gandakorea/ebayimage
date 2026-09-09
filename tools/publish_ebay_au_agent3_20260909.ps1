param(
    [string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'),
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$batchRoot = Join-Path $projectRoot '작업중\australia\batch-20260909-agent3'
$usDescriptionRoot = Join-Path $projectRoot '작업중\batch-20260909-agent3\us-publish'

function Read-EnvironmentFile([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([^#=]+)=(.*)$') {
            $values[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    $values
}

function Write-JsonFile([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 40
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Invoke-EbayJson {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][ValidateSet('GET','POST','PUT')][string]$Method,
        $Body = $null
    )
    $headers = @{
        Authorization = "Bearer $script:accessToken"
        'X-EBAY-C-MARKETPLACE-ID' = 'EBAY_AU'
        'Content-Language' = 'en-AU'
        Accept = 'application/json'
    }
    $params = @{ Uri = $Uri; Method = $Method; Headers = $headers }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json'
        $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 40 -Compress))
    } elseif ($Method -in @('POST','PUT')) {
        $params.ContentType = 'application/json'
        $params.Body = [Text.Encoding]::UTF8.GetBytes('{}')
    }
    Invoke-RestMethod @params
}

function Get-AuCatalogRows {
    param([string]$CategoryId, [string]$Make, [string]$Model)
    $request = @{
        categoryId = $CategoryId
        propertyFilters = @(
            @{ propertyName = 'Make'; propertyValue = $Make }
            @{ propertyName = 'Model'; propertyValue = $Model }
        )
        propertyNames = @('Year','Make','Model','Submodel','Variant','Engine')
    }
    $response = Invoke-EbayJson -Uri 'https://api.ebay.com/sell/metadata/v1/compatibilities/get_multi_compatibility_property_values' -Method POST -Body $request
    $rows = @()
    foreach ($compatibility in @($response.compatibilities)) {
        $row = [ordered]@{}
        foreach ($detail in @($compatibility.compatibilityDetails)) {
            $row[$detail.propertyName] = $detail.propertyValue
        }
        if ($row.Count -gt 0) { $rows += [pscustomobject]$row }
    }
    $rows
}

function Select-AuRows {
    param($Product)
    $selected = @()
    $catalogAudit = @()
    foreach ($target in $Product.compatibilityTargets) {
        $catalogError = $null
        try {
            $rows = @(Get-AuCatalogRows -CategoryId $Product.categoryId -Make $target.make -Model $target.model)
        } catch {
            $rows = @()
            $catalogError = $_.Exception.Message
        }
        $matched = @($rows | Where-Object {
            $year = [int]$_.Year
            $yearOk = $year -ge $target.minYear -and $year -le $target.maxYear
            $engineText = "$($_.Variant) $($_.Engine)"
            $engineOk = $true
            if ($target.enginePattern) { $engineOk = $engineText -match $target.enginePattern }
            $yearOk -and $engineOk
        })
        $catalogAudit += [pscustomobject]@{
            make = $target.make
            model = $target.model
            yearRange = "$($target.minYear)-$($target.maxYear)"
            enginePattern = $target.enginePattern
            catalogCount = $rows.Count
            selectedCount = $matched.Count
            error = $catalogError
        }
        $selected += $matched
    }
    if ($selected.Count -eq 0) { throw "No AU compatibility rows selected for $($Product.part)" }
    $deduped = @($selected | Sort-Object Year,Make,Model,Submodel,Variant,Engine -Unique)
    [pscustomobject]@{ rows = $deduped; audit = $catalogAudit }
}

function ConvertTo-CompatibilityRequest($Rows) {
    $compatibleProducts = foreach ($row in $Rows) {
        $properties = foreach ($name in 'Year','Make','Model','Submodel','Variant','Engine') {
            if (-not [string]::IsNullOrWhiteSpace([string]$row.$name)) {
                @{ name = $name; value = [string]$row.$name }
            }
        }
        @{ compatibilityProperties = @($properties) }
    }
    @{ compatibleProducts = @($compatibleProducts) }
}

function Upload-EbayImage([string]$Path) {
    $headers = @{ Authorization = "Bearer $script:accessToken"; Accept = 'application/json' }
    $response = Invoke-WebRequest -Uri 'https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file' -Method Post -Headers $headers -Form @{ image = Get-Item -LiteralPath $Path }
    $payload = $response.Content | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($payload.maxDimensionImageUrl)) {
        throw "eBay did not return maxDimensionImageUrl for $Path"
    }
    [pscustomobject]@{
        sourceFile = (Resolve-Path -LiteralPath $Path).Path
        imageResource = [string]$response.Headers.Location
        imageUrl = $payload.imageUrl
        maxDimensionImageUrl = $payload.maxDimensionImageUrl
        expirationDate = $payload.expirationDate
    }
}

function New-Description($Product) {
    $base = Get-Content -Raw -LiteralPath (Join-Path $usDescriptionRoot ($Product.part + '\listing-description.html'))
    $base = $base.Replace($Product.usTitle, $Product.title)
    $bodyTitle = [regex]'⭐Genuine[^<]+'
    if ($bodyTitle.IsMatch($base)) {
        $base = $bodyTitle.Replace($base, $Product.title, 1)
    } else {
        throw "Description title line was not found for $($Product.part)"
    }
    $base
}

function Get-TradingItem([string]$ListingId) {
    $headers = @{
        'X-EBAY-API-CALL-NAME' = 'GetItem'
        'X-EBAY-API-SITEID' = '15'
        'X-EBAY-API-COMPATIBILITY-LEVEL' = '1193'
        'X-EBAY-API-IAF-TOKEN' = $script:accessToken
    }
    $body = '<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>' + $ListingId + '</ItemID><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>'
    Invoke-RestMethod -Uri 'https://api.ebay.com/ws/api.dll' -Method Post -Headers $headers -ContentType 'text/xml; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
}

$settings = Read-EnvironmentFile $EnvironmentFile
$script:accessToken = $settings['EBAY_AU_USER_TOKEN']
if ([string]::IsNullOrWhiteSpace($script:accessToken)) { throw 'EBAY_AU_USER_TOKEN is missing.' }

$identity = Invoke-RestMethod -Uri 'https://apiz.ebay.com/commerce/identity/v1/user/' -Method Get -Headers @{ Authorization = "Bearer $script:accessToken" }
if ($identity.username -ne 'sihooshop' -or $identity.registrationMarketplaceId -ne 'EBAY_AU') {
    throw "Wrong AU identity: $($identity.username) / $($identity.registrationMarketplaceId)"
}

$products = @(
    [pscustomobject]@{
        part='92101-F2400'; sku='92101-F2400-AU-20260909'; categoryId='33710'; price='2074.37'; usd='1498.82'; exchangeRate='1.384'; shipping='fast';
        title='⭐Genuine 92101F2400 Hid Drl Headlight Left Driver For Hyundai Elantra Sport 2018'; usTitle='⭐Genuine 92101F2400 Hid Drl Headlight Left Driver For Hyundai Elantra Sport 2018'; type='Headlight Assembly'; partWords='HID DRL headlight left driver'; countryOrigin='Korea, Republic of';
        stores=@('/Hyundai/Elantra');
        compatibilityTargets=@(
            @{make='Hyundai';model='Elantra';minYear=2018;maxYear=2018;enginePattern='(?i)(1\.6L|1591cc).*Petrol'}
        )
    }
)
$results = @()
foreach ($product in $products) {
    $dir = Join-Path $batchRoot $product.part
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    $selection = Select-AuRows -Product $product
    Write-JsonFile (Join-Path $dir 'compatibility-selection-audit.json') ([pscustomobject]@{ targets=$selection.audit; selected=$selection.rows })
    $compatibilityRequest = ConvertTo-CompatibilityRequest -Rows $selection.rows
    Write-JsonFile (Join-Path $dir 'compatibility-request.json') $compatibilityRequest

    $finalImageDir = Join-Path $projectRoot "완성본\$($product.part)"
    $imageFiles = @(Get-ChildItem -LiteralPath $finalImageDir -File -Filter '*.png' |
        Where-Object { $_.BaseName -match ('^' + [regex]::Escape($product.part) + '(_\d+)?$') } |
        Sort-Object @{ Expression = { if ($_.BaseName -eq $product.part) { 0 } else { [int](($_.BaseName -split '_')[-1]) + 1 } } } |
        ForEach-Object FullName)
    if ($imageFiles.Count -lt 3 -or $imageFiles.Count -gt 4) {
        throw "Expected 3 or 4 final images for $($product.part), found $($imageFiles.Count)"
    }
    foreach ($imageFile in $imageFiles) {
        if (-not (Test-Path -LiteralPath $imageFile)) { throw "Missing final image: $imageFile" }
    }
    $uploadAuditPath = Join-Path $dir 'image-uploads.json'
    if (Test-Path -LiteralPath $uploadAuditPath) {
        $uploads = @(Get-Content -Raw -LiteralPath $uploadAuditPath | ConvertFrom-Json)
    } else {
        $uploads = @(foreach ($imageFile in $imageFiles) { Upload-EbayImage -Path $imageFile })
        Write-JsonFile $uploadAuditPath $uploads
    }
    if ($uploads.Count -ne $imageFiles.Count) { throw "Image upload verification failed for $($product.part)" }

    $listingDescription = New-Description -Product $product

    $aspects = @{
        Brand = @('Genuine Hyundai Mobis')
        Type = @($product.type)
        'Manufacturer Part Number' = @($product.part)
        'OE/OEM Part Number' = @($product.part.Replace('-',''))
        'Interchange Part Number' = @($product.part + ' ' + $product.part.Replace('-',' '))
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$product.countryOrigin)) {
        $aspects['Country of Origin'] = @($product.countryOrigin)
    }

    $inventory = @{
        availability = @{ shipToLocationAvailability = @{ quantity = 5 } }
        condition = 'NEW'
        product = @{
            title = $product.title
            brand = 'Genuine Hyundai Mobis'
            mpn = $product.part
            imageUrls = @($uploads.maxDimensionImageUrl)
            aspects = $aspects
        }
    }
    Write-JsonFile (Join-Path $dir 'inventory-request.json') $inventory
    Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/inventory_item/' + [uri]::EscapeDataString($product.sku)) -Method PUT -Body $inventory | Out-Null
    $inventoryAudit = Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/inventory_item/' + [uri]::EscapeDataString($product.sku)) -Method GET
    Write-JsonFile (Join-Path $dir 'inventory-audit.json') $inventoryAudit
    if (@($inventoryAudit.product.imageUrls).Count -ne $uploads.Count -or $inventoryAudit.availability.shipToLocationAvailability.quantity -ne 5) {
        throw "Inventory verification failed for $($product.part)"
    }

    Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/inventory_item/' + [uri]::EscapeDataString($product.sku) + '/product_compatibility') -Method PUT -Body $compatibilityRequest | Out-Null
    $compatibilityAudit = Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/inventory_item/' + [uri]::EscapeDataString($product.sku) + '/product_compatibility') -Method GET
    Write-JsonFile (Join-Path $dir 'compatibility-audit.json') $compatibilityAudit
    if (@($compatibilityAudit.compatibleProducts).Count -ne $selection.rows.Count) {
        throw "Compatibility verification failed for $($product.part)"
    }

    $fulfillmentPolicyId = if ($product.shipping -eq 'fast') { '257425043024' } else { '257576069024' }
    $offer = @{
        sku = $product.sku
        marketplaceId = 'EBAY_AU'
        format = 'FIXED_PRICE'
        availableQuantity = 5
        categoryId = $product.categoryId
        merchantLocationKey = 'sihooshop-korea'
        listingDescription = $listingDescription
        listingPolicies = @{
            paymentPolicyId = '178186266024'
            returnPolicyId = '110686678024'
            fulfillmentPolicyId = $fulfillmentPolicyId
        }
        pricingSummary = @{ price = @{ value = $product.price; currency = 'AUD' } }
        storeCategoryNames = @($product.stores)
        listingDuration = 'GTC'
        includeCatalogProductDetails = $true
    }
    Write-JsonFile (Join-Path $dir 'offer-request.json') $offer
    $offerCreatePath = Join-Path $dir 'offer-create-response.json'
    if (Test-Path -LiteralPath $offerCreatePath) {
        $offerCreate = Get-Content -Raw -LiteralPath $offerCreatePath | ConvertFrom-Json
    } else {
        $offerCreate = Invoke-EbayJson -Uri 'https://api.ebay.com/sell/inventory/v1/offer' -Method POST -Body $offer
        Write-JsonFile $offerCreatePath $offerCreate
    }
    Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/offer/' + $offerCreate.offerId) -Method PUT -Body $offer | Out-Null
    $offerAudit = Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/offer/' + $offerCreate.offerId) -Method GET
    Write-JsonFile (Join-Path $dir 'offer-audit-prepublish.json') $offerAudit
    if ($offerAudit.marketplaceId -ne 'EBAY_AU' -or $offerAudit.pricingSummary.price.currency -ne 'AUD' -or $offerAudit.pricingSummary.price.value -ne $product.price) {
        throw "Offer verification failed for $($product.part)"
    }

    $listingId = $null
    if ($Publish) {
        if ($offerAudit.status -eq 'PUBLISHED' -and $offerAudit.listing.listingStatus -eq 'ACTIVE') {
            $listingId = [string]$offerAudit.listing.listingId
            $published = [pscustomobject]@{ listingId=$listingId; resumedFromPublishedOffer=$true }
        } else {
            $published = Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/offer/' + $offerCreate.offerId + '/publish') -Method POST
            $listingId = [string]$published.listingId
        }
        Write-JsonFile (Join-Path $dir 'publish-response.json') $published
        if ([string]::IsNullOrWhiteSpace($listingId)) { throw "Publish did not return a listingId for $($product.part)" }
        [xml]$publicItem = Get-TradingItem -ListingId $listingId
        $publicItem.Save((Join-Path $dir 'published-item.xml'))
        $ns = New-Object System.Xml.XmlNamespaceManager($publicItem.NameTable)
        $ns.AddNamespace('e','urn:ebay:apis:eBLBaseComponents')
        $item = $publicItem.SelectSingleNode('//e:Item',$ns)
        $publicCompatibilityCount = @($item.ItemCompatibilityList.Compatibility).Count
        $publicProp65 = @($item.ItemSpecifics.NameValueList | Where-Object { $_.Name -eq 'California Prop 65 Warning' }).Count
        if ($null -eq $item -or $item.Seller.UserID -ne 'sihooshop' -or [string]$item.Currency -ne 'AUD' -or
            [int]$item.Quantity -ne 5 -or @($item.PictureDetails.PictureURL).Count -ne $uploads.Count -or
            $publicCompatibilityCount -ne $selection.rows.Count -or $publicProp65 -ne 0 -or
            -not ([string]$item.Description).Contains($product.title)) {
            throw "Published listing verification failed for $($product.part)"
        }
    }

    $result = [pscustomobject]@{
        account = 'sihooshop'
        marketplace = 'EBAY_AU'
        part = $product.part
        sku = $product.sku
        sourcePriceUsd = $product.usd
        exchangeRateUsdAud = $product.exchangeRate
        priceAud = $product.price
        quantity = 5
        shipping = $product.shipping
        categoryId = $product.categoryId
        imageCount = $uploads.Count
        compatibilityCount = $selection.rows.Count
        offerId = [string]$offerCreate.offerId
        listingId = $listingId
        status = if ($Publish) { 'ACTIVE' } else { 'READY' }
        url = if ($listingId) { "https://www.ebay.com.au/itm/$listingId" } else { $null }
    }
    Write-JsonFile (Join-Path $dir 'result.json') $result
    $results += $result
}

Write-JsonFile (Join-Path $batchRoot 'batch-result.json') $results
$results | ConvertTo-Json -Depth 8

