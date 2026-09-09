param(
    [string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'),
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$batchRoot = Join-Path $projectRoot '작업중\australia\batch-20260909'
$usDescriptionRoot = Join-Path $projectRoot '작업중\batch-20260909-us\publish'

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
        part='24321-2E000'; sku='24321-2E000-AU-20260909'; categoryId='262135'; price='193.76'; usd='140.00'; exchangeRate='1.384'; shipping='normal';
        title='⭐Genuine 243212E000 Timing Chain For Hyundai Elantra Kia Cerato Soul 2011-2016'; usTitle='⭐Genuine 243212E000 Timing Chain For Hyundai Elantra Kia Forte Soul 2011-2016'; type='Timing Chain'; partWords='timing chain'; countryOrigin=$null;
        stores=@('/Hyundai/Elantra','/Kia/Cerato');
        compatibilityTargets=@(
            @{make='Hyundai';model='Elantra';minYear=2011;maxYear=2013;enginePattern='(?i)(1\.8L|1797cc).*Petrol'},
            @{make='Kia';model='Cerato';minYear=2014;maxYear=2016;enginePattern='(?i)(1\.8L|1797cc).*Petrol'},
            @{make='Kia';model='Soul';minYear=2012;maxYear=2013;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'}
        )
    },
    [pscustomobject]@{
        part='24350-2G750'; sku='24350-2G750-AU-20260909'; categoryId='61304'; price='258.89'; usd='187.06'; exchangeRate='1.384'; shipping='normal';
        title='⭐Genuine Cvvt Intake Camshaft Gear For Kia Sportage Optima Sorento 2011-2016'; usTitle='⭐Genuine Cvvt Intake Camshaft Gear For Kia Sportage Optima Sorento 2011-2016'; type='Timing Gear'; partWords='CVVT intake camshaft gear'; countryOrigin='Korea, Republic of';
        stores=@('/Kia/Sportage','/Kia/Optima');
        compatibilityTargets=@(
            @{make='Hyundai';model='Santa Fe';minYear=2013;maxYear=2016;enginePattern='(?i)(2\.0L|2\.4L|1998cc|1999cc|2359cc|2400cc).*Petrol'},
            @{make='Hyundai';model='Sonata';minYear=2011;maxYear=2014;enginePattern='(?i)(2\.0L|2\.4L|1998cc|1999cc|2359cc|2400cc).*Petrol'},
            @{make='Hyundai';model='Tucson';minYear=2014;maxYear=2015;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Optima';minYear=2011;maxYear=2015;enginePattern='(?i)(2\.0L|2\.4L|1998cc|1999cc|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Sorento';minYear=2012;maxYear=2015;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Sportage';minYear=2011;maxYear=2016;enginePattern='(?i)(2\.0L|2\.4L|1998cc|1999cc|2359cc|2400cc).*Petrol'}
        )
    },
    [pscustomobject]@{
        part='24355-3C200'; sku='24355-3C200-AU-20260909'; categoryId='61304'; price='159.56'; usd='115.29'; exchangeRate='1.384'; shipping='normal';
        title='⭐Genuine Intake Oil Control Valve Right For Hyundai Genesis Kia Sorento 06-12'; usTitle='⭐Genuine Intake Oil Control Valve Right For Hyundai Genesis Kia Sorento 06-12'; type='Oil Control Valve'; partWords='intake oil control valve'; countryOrigin='Korea, Republic of';
        stores=@('/Hyundai/Genesis','/Kia/Sorento');
        compatibilityTargets=@(
            @{make='Hyundai';model='Grandeur';minYear=2006;maxYear=2011;enginePattern='(?i)(3\.3L|3\.8L|3342cc|3778cc|3800cc).*Petrol'},
            @{make='Hyundai';model='Genesis';minYear=2009;maxYear=2011;enginePattern='(?i)(3\.8L|3778cc|3800cc).*Petrol'},
            @{make='Hyundai';model='Genesis Coupe';minYear=2010;maxYear=2012;enginePattern='(?i)(3\.8L|3778cc|3800cc).*Petrol'},
            @{make='Hyundai';model='Santa Fe';minYear=2007;maxYear=2009;enginePattern='(?i)(3\.3L|3342cc).*Petrol'},
            @{make='Hyundai';model='Sonata';minYear=2006;maxYear=2010;enginePattern='(?i)(3\.3L|3342cc).*Petrol'},
            @{make='Hyundai';model='ix55';minYear=2007;maxYear=2012;enginePattern='(?i)(3\.8L|3778cc|3800cc).*Petrol'},
            @{make='Kia';model='Carnival';minYear=2006;maxYear=2010;enginePattern='(?i)(3\.8L|3778cc|3800cc).*Petrol'},
            @{make='Kia';model='Sorento';minYear=2007;maxYear=2009;enginePattern='(?i)(3\.3L|3\.8L|3342cc|3778cc|3800cc).*Petrol'},
            @{make='Kia';model='Mohave';minYear=2009;maxYear=2009;enginePattern='(?i)(3\.8L|3778cc|3800cc).*Petrol'}
        )
    },
    [pscustomobject]@{
        part='24470-25050'; sku='24470-25050-AU-20260909'; categoryId='61304'; price='112.35'; usd='81.18'; exchangeRate='1.384'; shipping='normal';
        title='⭐Genuine Chain Tensioner For Hyundai Sonata Ix35 Kia Optima Sportage 06-16'; usTitle='⭐Genuine Chain Tensioner For Hyundai Sonata Tucson Kia Optima Sportage 2006-2016'; type='Chain Tensioner'; partWords='chain tensioner'; countryOrigin='Korea, Republic of';
        stores=@('/Hyundai/Sonata','/Kia/Sportage');
        compatibilityTargets=@(
            @{make='Hyundai';model='Sonata';minYear=2006;maxYear=2015;enginePattern='(?i)(2\.4L|2351cc|2359cc|2400cc).*Petrol'},
            @{make='Hyundai';model='ix35';minYear=2010;maxYear=2013;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Cerato';minYear=2010;maxYear=2013;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Optima';minYear=2006;maxYear=2016;enginePattern='(?i)(2\.4L|2351cc|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Sportage';minYear=2011;maxYear=2015;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'}
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
            $publicCompatibilityCount -ne $selection.rows.Count -or $publicProp65 -ne 0) {
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
