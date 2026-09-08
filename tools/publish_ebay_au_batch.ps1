param(
    [string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'),
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$batchRoot = Join-Path $projectRoot '작업중\australia\batch-20260908'
$templatePath = Join-Path $projectRoot '작업중\australia\98850-1H000\offer-request.json'

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
        $rows = @(Get-AuCatalogRows -CategoryId $Product.categoryId -Make $target.make -Model $target.model)
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

function New-Description([string]$Title, [string]$Part, [string]$PartWords) {
    $base = (Get-Content -Raw -LiteralPath $templatePath | ConvertFrom-Json).listingDescription
    $base = $base.Replace('⭐Genuine 988501H000 Rear Wiper Blade For Hyundai Tucson 2.0L 2.4L 2010-2017', $Title)
    $base = $base.Replace('988501H000', $Part.Replace('-',''))
    $base = $base.Replace('98850-1H000', $Part)
    $base = $base.Replace('rear wiper blade', $PartWords)
    $base = $base.Replace('This part fits Hyundai Tucson 2010-2017.', 'This part fits the vehicles listed in the compatibility table.')
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
        part='98850-3W000'; sku='98850-3W000-AU-20260908'; categoryId='179852'; price='97.24'; usd='70.15'; shipping='normal';
        title='⭐Genuine Rear Wiper Blade For Hyundai Elantra Tucson Kia Sportage 2009-2016'; type='Wiper Blade'; partWords='rear wiper blade';
        stores=@('/Hyundai/Tucson','/Kia/Sportage');
        compatibilityTargets=@(
            @{make='Kia';model='Sportage';minYear=2011;maxYear=2016;enginePattern=$null},
            @{make='Hyundai';model='Tucson';minYear=2011;maxYear=2015;enginePattern=$null},
            @{make='Hyundai';model='Elantra';minYear=2009;maxYear=2012;enginePattern=$null}
        )
    },
    [pscustomobject]@{
        part='21950-C1100'; sku='21950-C1100-AU-20260908'; categoryId='50454'; price='244.03'; usd='176.04'; shipping='fast';
        title='⭐Genuine 21950C1100 Torque Strut Mount For Hyundai Sonata 2.4L 2015-2017'; type='Engine Mount'; partWords='torque strut mount';
        stores=@('/Hyundai/Sonata');
        compatibilityTargets=@(
            @{make='Hyundai';model='Sonata';minYear=2015;maxYear=2017;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'}
        )
    },
    [pscustomobject]@{
        part='22311-2G700'; sku='22311-2G700-AU-20260908'; categoryId='33665'; price='146.17'; usd='105.45'; shipping='fast';
        title='⭐Genuine Cylinder Head Gasket For Hyundai Sonata Kia Optima Sorento Tucson 2.4L'; type='Cylinder Head Gasket'; partWords='cylinder head gasket';
        stores=@('/Hyundai/Sonata','/Kia/Optima');
        compatibilityTargets=@(
            @{make='Hyundai';model='Santa Fe';minYear=2013;maxYear=2016;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Optima';minYear=2011;maxYear=2016;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Sportage';minYear=2014;maxYear=2016;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Hyundai';model='Tucson';minYear=2010;maxYear=2015;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Kia';model='Sorento';minYear=2011;maxYear=2015;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'},
            @{make='Hyundai';model='Sonata';minYear=2011;maxYear=2014;enginePattern='(?i)(2\.4L|2359cc|2400cc).*Petrol'}
        )
    },
    [pscustomobject]@{
        part='22311-2GTB0'; sku='22311-2GTB0-AU-20260908'; categoryId='33665'; price='146.17'; usd='105.45'; shipping='fast';
        title='⭐Genuine Cylinder Head Gasket For Kia Optima Sorento Sportage Stinger 2.0L 16-21'; type='Cylinder Head Gasket'; partWords='cylinder head gasket';
        stores=@('/Kia/Optima','/Kia/Sportage');
        compatibilityTargets=@(
            @{make='Genesis';model='G70';minYear=2019;maxYear=2022;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'},
            @{make='Hyundai';model='Veloster';minYear=2019;maxYear=2022;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'},
            @{make='Kia';model='Sportage';minYear=2017;maxYear=2021;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'},
            @{make='Kia';model='Stinger';minYear=2018;maxYear=2021;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'},
            @{make='Hyundai';model='Santa Fe';minYear=2016;maxYear=2020;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'},
            @{make='Kia';model='Optima';minYear=2016;maxYear=2020;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'},
            @{make='Hyundai';model='Sonata';minYear=2016;maxYear=2019;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'},
            @{make='Kia';model='Sorento';minYear=2016;maxYear=2018;enginePattern='(?i)(2\.0L|1998cc|1999cc|2000cc).*Petrol'}
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

    $imageFiles = @(
        (Join-Path $projectRoot "완성본\$($product.part)\$($product.part).png"),
        (Join-Path $projectRoot "완성본\$($product.part)\$($product.part)_1.png"),
        (Join-Path $projectRoot "완성본\$($product.part)\$($product.part)_2.png")
    )
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
    if ($uploads.Count -ne 3) { throw "Image upload verification failed for $($product.part)" }

    $listingDescription = New-Description -Title $product.title -Part $product.part -PartWords $product.partWords

    $inventory = @{
        availability = @{ shipToLocationAvailability = @{ quantity = 5 } }
        condition = 'NEW'
        product = @{
            title = $product.title
            brand = 'Genuine Hyundai Mobis'
            mpn = $product.part
            imageUrls = @($uploads.maxDimensionImageUrl)
            aspects = @{
                Brand = @('Genuine Hyundai Mobis')
                Type = @($product.type)
                'Manufacturer Part Number' = @($product.part)
                'OE/OEM Part Number' = @($product.part.Replace('-',''))
                'Interchange Part Number' = @($product.part + ' ' + $product.part.Replace('-',' '))
                'Country of Origin' = @('Korea, Republic of')
            }
        }
    }
    Write-JsonFile (Join-Path $dir 'inventory-request.json') $inventory
    Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/inventory_item/' + [uri]::EscapeDataString($product.sku)) -Method PUT -Body $inventory | Out-Null
    $inventoryAudit = Invoke-EbayJson -Uri ('https://api.ebay.com/sell/inventory/v1/inventory_item/' + [uri]::EscapeDataString($product.sku)) -Method GET
    Write-JsonFile (Join-Path $dir 'inventory-audit.json') $inventoryAudit
    if (@($inventoryAudit.product.imageUrls).Count -ne 3 -or $inventoryAudit.availability.shipToLocationAvailability.quantity -ne 5) {
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
        if ($null -eq $item -or $item.Seller.UserID -ne 'sihooshop' -or [string]$item.Currency -ne 'AUD' -or @($item.PictureDetails.PictureURL).Count -ne 3) {
            throw "Published listing verification failed for $($product.part)"
        }
    }

    $result = [pscustomobject]@{
        account = 'sihooshop'
        marketplace = 'EBAY_AU'
        part = $product.part
        sku = $product.sku
        sourcePriceUsd = $product.usd
        exchangeRateUsdAud = '1.3862'
        priceAud = $product.price
        quantity = 5
        shipping = $product.shipping
        categoryId = $product.categoryId
        imageCount = 3
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
