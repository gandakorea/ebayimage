param(
    [string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'),
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$batchRoot = Join-Path $projectRoot '작업중\batch-20260909-us\publish'
$sourceRoot = Join-Path $projectRoot '작업중\batch-20260909-us'
$ns = 'urn:ebay:apis:eBLBaseComponents'

function Read-EnvironmentFile([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
    }
    $values
}

function Add-TextElement([xml]$Document, [System.Xml.XmlElement]$Parent, [string]$Name, [string]$Value) {
    $node = $Document.CreateElement($Name, $ns)
    $node.InnerText = $Value
    [void]$Parent.AppendChild($node)
    $node
}

function Invoke-TradingApi([string]$CallName, [xml]$Request) {
    $headers = @{
        'X-EBAY-API-CALL-NAME' = $CallName
        'X-EBAY-API-SITEID' = '100'
        'X-EBAY-API-COMPATIBILITY-LEVEL' = '1193'
        'X-EBAY-API-IAF-TOKEN' = $script:accessToken
    }
    $payload = '<?xml version="1.0" encoding="utf-8"?>' + $Request.OuterXml.Replace('⭐', '&#x2B50;').Replace([string][char]0x2019, '&#x2019;')
    $client = [Net.Http.HttpClient]::new()
    try {
        $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, 'https://api.ebay.com/ws/api.dll')
        foreach ($entry in $headers.GetEnumerator()) { [void]$message.Headers.TryAddWithoutValidation($entry.Key, [string]$entry.Value) }
        $message.Content = [Net.Http.ByteArrayContent]::new([Text.Encoding]::UTF8.GetBytes($payload))
        $message.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/xml; charset=utf-8')
        $response = $client.SendAsync($message).GetAwaiter().GetResult()
        [xml]$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } finally {
        if ($null -ne $message) { $message.Dispose() }
        $client.Dispose()
    }
}

function Assert-Success([xml]$Response, [string]$Stage) {
    $ack = [string]$Response.DocumentElement.Ack
    if ($ack -notin @('Success','Warning')) {
        $messages = @($Response.DocumentElement.Errors | ForEach-Object { "[$($_.ErrorCode)] $($_.LongMessage)" }) -join '; '
        throw "$Stage failed: $messages"
    }
}

function Upload-EbayImage([string]$Path) {
    $headers = @{ Authorization = "Bearer $script:accessToken"; Accept = 'application/json' }
    $response = Invoke-WebRequest -Uri 'https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file' -Method Post -Headers $headers -Form @{ image = Get-Item -LiteralPath $Path }
    $payload = $response.Content | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$payload.maxDimensionImageUrl)) { throw "Image upload failed: $Path" }
    [pscustomobject]@{
        sourceFile = (Resolve-Path -LiteralPath $Path).Path
        imageResource = [string]$response.Headers.Location
        maxDimensionImageUrl = [string]$payload.maxDimensionImageUrl
        expirationDate = [string]$payload.expirationDate
    }
}

function Add-NameValue([xml]$Document, [System.Xml.XmlElement]$Parent, [string]$Name, [string[]]$Values) {
    $nvl = $Document.CreateElement('NameValueList', $ns)
    [void]$Parent.AppendChild($nvl)
    [void](Add-TextElement $Document $nvl 'Name' $Name)
    foreach ($value in $Values) {
        if (-not [string]::IsNullOrWhiteSpace($value)) { [void](Add-TextElement $Document $nvl 'Value' $value) }
    }
}

function New-Description([string]$Template, [string]$TemplateTitle, $Product) {
    $value = $Template.Replace($TemplateTitle, $Product.title)
    foreach ($old in @('437112M1009P','43711-2M1009P','43711 2M1009P')) { $value = $value.Replace($old, $Product.part.Replace('-','')) }
    $value = $value.Replace('leather 6 speed MT gear shift knob lever', $Product.partWords)
    $value = $value.Replace('This part fits Hyundai Genesis Coupe 2009-2017.', 'This part fits the vehicles listed in the compatibility table.')
    $value
}

$settings = Read-EnvironmentFile $EnvironmentFile
$script:accessToken = $settings['EBAY_US_ACCESS_TOKEN']
if ([string]::IsNullOrWhiteSpace($script:accessToken)) { throw 'EBAY_US_ACCESS_TOKEN is missing.' }
$identity = Invoke-RestMethod -Uri 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{ Authorization = "Bearer $script:accessToken" }
if ($identity.username -ne 'gandakorea') { throw "Wrong US identity: $($identity.username)" }

$products = @(
    [pscustomobject]@{ reference='137539031972'; part='24321-2E000'; price='140.00'; shipping='normal'; title='⭐Genuine 243212E000 Timing Chain For Hyundai Elantra Kia Forte Soul 2011-2016'; partWords='timing chain'; store1='13146860012'; store2='13012894012'; countryOrigin=$null },
    [pscustomobject]@{ reference='336703193734'; part='24350-2G750'; price='187.06'; shipping='normal'; title='⭐Genuine Cvvt Intake Camshaft Gear For Kia Sportage Optima Sorento 2011-2016'; partWords='CVVT intake camshaft gear'; store1='13180807012'; store2='13146861012'; countryOrigin='Korea, Republic of' },
    [pscustomobject]@{ reference='266048860192'; part='24355-3C200'; price='115.29'; shipping='normal'; title='⭐Genuine Intake Oil Control Valve Right For Hyundai Genesis Kia Sorento 06-12'; partWords='intake oil control valve'; store1='13250678012'; store2='13179345012'; countryOrigin='Korea, Republic of' },
    [pscustomobject]@{ reference='234867561092'; part='24470-25050'; price='81.18'; shipping='normal'; title='⭐Genuine Chain Tensioner For Hyundai Sonata Tucson Kia Optima Sportage 2006-2016'; partWords='chain tensioner'; store1='12974034012'; store2='13180602012'; countryOrigin='Korea, Republic of' }
)

$existingBySku = @{}
if ($Publish) {
    [xml]$recentRequest = New-Object System.Xml.XmlDocument
    $recentRoot = $recentRequest.CreateElement('GetSellerListRequest', $ns)
    [void]$recentRequest.AppendChild($recentRoot)
    [void](Add-TextElement $recentRequest $recentRoot 'StartTimeFrom' ([DateTime]::UtcNow.AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')))
    [void](Add-TextElement $recentRequest $recentRoot 'StartTimeTo' ([DateTime]::UtcNow.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')))
    [void](Add-TextElement $recentRequest $recentRoot 'DetailLevel' 'ReturnAll')
    $pagination = $recentRequest.CreateElement('Pagination', $ns)
    [void]$recentRoot.AppendChild($pagination)
    [void](Add-TextElement $recentRequest $pagination 'EntriesPerPage' '200')
    [void](Add-TextElement $recentRequest $pagination 'PageNumber' '1')
    $recent = Invoke-TradingApi 'GetSellerList' $recentRequest
    Assert-Success $recent 'Duplicate preflight'
    foreach ($existing in @($recent.GetSellerListResponse.ItemArray.Item)) {
        $existingSku = [string]$existing.SKU
        if (-not [string]::IsNullOrWhiteSpace($existingSku) -and [string]$existing.SellingStatus.ListingStatus -eq 'Active') {
            $existingBySku[$existingSku] = [string]$existing.ItemID
        }
    }
}

[xml]$templateXml = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'source-336779935333.xml')
$templateTitle = [string]$templateXml.GetItemResponse.Item.Title
$templateDescription = [string]$templateXml.GetItemResponse.Item.Description
$results = @()
New-Item -ItemType Directory -Force -Path $batchRoot | Out-Null

foreach ($product in $products) {
    if ($product.title.Length -gt 80 -or -not $product.title.StartsWith('⭐Genuine ')) { throw "Invalid title for $($product.part): $($product.title)" }
    $dir = Join-Path $batchRoot $product.part
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [xml]$source = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot ('source-' + $product.reference + '.xml'))
    $sourceItem = $source.GetItemResponse.Item
    $compatibilities = @($sourceItem.ItemCompatibilityList.Compatibility)
    if ($compatibilities.Count -eq 0) { throw "No compatibility rows: $($product.part)" }

    $imageFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot ('완성본\' + $product.part)) -Filter '*.png' -File | Sort-Object @{Expression={ if ($_.BaseName -eq $product.part) { 0 } else { [int]($_.BaseName.Split('_')[-1]) + 1 } }})
    if ($imageFiles.Count -lt 3 -or $imageFiles.Count -gt 4) { throw "Expected 3-4 final images for $($product.part), got $($imageFiles.Count)" }
    $uploadPath = Join-Path $dir 'image-uploads.json'
    if (Test-Path -LiteralPath $uploadPath) { $uploads = @(Get-Content -Raw -LiteralPath $uploadPath | ConvertFrom-Json) }
    else {
        $uploads = @(foreach ($imageFile in $imageFiles) { Upload-EbayImage -Path $imageFile.FullName })
        $uploads | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $uploadPath -Encoding utf8NoBOM
    }
    if ($uploads.Count -ne $imageFiles.Count) { throw "Image upload count mismatch: $($product.part)" }

    $description = New-Description -Template $templateDescription -TemplateTitle $templateTitle -Product $product
    Set-Content -LiteralPath (Join-Path $dir 'listing-description.html') -Value $description -Encoding utf8NoBOM
    [xml]$request = New-Object System.Xml.XmlDocument
    $root = $request.CreateElement('AddFixedPriceItemRequest', $ns)
    [void]$request.AppendChild($root)
    [void](Add-TextElement $request $root 'ErrorLanguage' 'en_US')
    [void](Add-TextElement $request $root 'WarningLevel' 'High')
    $item = $request.CreateElement('Item', $ns)
    [void]$root.AppendChild($item)
    [void](Add-TextElement $request $item 'Title' $product.title)
    $descriptionNode = $request.CreateElement('Description', $ns)
    $descriptionNode.InnerText = $description
    [void]$item.AppendChild($descriptionNode)
    $category = $request.CreateElement('PrimaryCategory', $ns)
    [void]$item.AppendChild($category)
    [void](Add-TextElement $request $category 'CategoryID' ([string]$sourceItem.PrimaryCategory.CategoryID))
    $price = Add-TextElement $request $item 'StartPrice' $product.price
    [void]$price.SetAttribute('currencyID','USD')
    [void](Add-TextElement $request $item 'ConditionID' '1000')
    [void](Add-TextElement $request $item 'Country' 'KR')
    [void](Add-TextElement $request $item 'Currency' 'USD')
    [void](Add-TextElement $request $item 'ListingDuration' 'GTC')
    [void](Add-TextElement $request $item 'ListingType' 'FixedPriceItem')
    [void](Add-TextElement $request $item 'Location' 'Seoul')
    [void](Add-TextElement $request $item 'Quantity' '5')
    $sku = $product.part + '-US-20260909'
    [void](Add-TextElement $request $item 'SKU' $sku)
    [void](Add-TextElement $request $item 'Site' 'eBayMotors')

    $pictures = $request.CreateElement('PictureDetails', $ns)
    [void]$item.AppendChild($pictures)
    foreach ($upload in $uploads) { [void](Add-TextElement $request $pictures 'PictureURL' ([string]$upload.maxDimensionImageUrl)) }

    $profiles = $request.CreateElement('SellerProfiles', $ns)
    [void]$item.AppendChild($profiles)
    foreach ($profile in @(
        @{ Element='SellerPaymentProfile'; IdElement='PaymentProfileID'; Id='234717937016' },
        @{ Element='SellerReturnProfile'; IdElement='ReturnProfileID'; Id='38921318016' },
        @{ Element='SellerShippingProfile'; IdElement='ShippingProfileID'; Id= $(if ($product.shipping -eq 'fast') { '268260144016' } else { '268260114016' }) }
    )) {
        $node = $request.CreateElement($profile.Element, $ns)
        [void]$profiles.AppendChild($node)
        [void](Add-TextElement $request $node $profile.IdElement $profile.Id)
    }

    $storefront = $request.CreateElement('Storefront', $ns)
    [void]$item.AppendChild($storefront)
    [void](Add-TextElement $request $storefront 'StoreCategoryID' $product.store1)
    [void](Add-TextElement $request $storefront 'StoreCategory2ID' $product.store2)

    $specifics = $request.CreateElement('ItemSpecifics', $ns)
    [void]$item.AppendChild($specifics)
    foreach ($entry in @($sourceItem.ItemSpecifics.NameValueList)) {
        $name = [string]$entry.Name
        if ([string]::IsNullOrWhiteSpace($name) -or $name -in @('Brand','California Prop 65 Warning','Manufacturer Part Number','OE/OEM Part Number','Interchange Part Number','Country of Origin')) { continue }
        Add-NameValue $request $specifics $name @($entry.Value | ForEach-Object { [string]$_ })
    }
    Add-NameValue $request $specifics 'Brand' @('Genuine Hyundai Mobis')
    Add-NameValue $request $specifics 'Manufacturer Part Number' @($product.part)
    Add-NameValue $request $specifics 'OE/OEM Part Number' @($product.part,$product.part.Replace('-',''),$product.part.Replace('-',' '))
    Add-NameValue $request $specifics 'Interchange Part Number' @($product.part,$product.part.Replace('-',''),$product.part.Replace('-',' '))
    if (-not [string]::IsNullOrWhiteSpace([string]$product.countryOrigin)) { Add-NameValue $request $specifics 'Country of Origin' @($product.countryOrigin) }

    $compatibilityList = $request.CreateElement('ItemCompatibilityList', $ns)
    [void]$item.AppendChild($compatibilityList)
    foreach ($compatibility in $compatibilities) {
        $compatibilityNode = $request.CreateElement('Compatibility', $ns)
        [void]$compatibilityList.AppendChild($compatibilityNode)
        foreach ($entry in @($compatibility.NameValueList)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$entry.Name) -and -not [string]::IsNullOrWhiteSpace([string]$entry.Value)) {
                Add-NameValue $request $compatibilityNode ([string]$entry.Name) @([string]$entry.Value)
            }
        }
    }
    $request.Save((Join-Path $dir 'add-fixed-price-request.xml'))

    [xml]$verifyRequest = $request.OuterXml
    $oldRoot = $verifyRequest.DocumentElement
    $newRoot = $verifyRequest.CreateElement('VerifyAddFixedPriceItemRequest', $ns)
    while ($oldRoot.HasChildNodes) { [void]$newRoot.AppendChild($oldRoot.FirstChild) }
    [void]$verifyRequest.ReplaceChild($newRoot,$oldRoot)
    $verify = Invoke-TradingApi 'VerifyAddFixedPriceItem' $verifyRequest
    $verify.Save((Join-Path $dir 'verify-response.xml'))
    Assert-Success $verify "Verify $($product.part)"

    $listingId = $null
    if ($Publish) {
        $resultPath = Join-Path $dir 'published-result.json'
        if ($existingBySku.ContainsKey($sku)) { $listingId = [string]$existingBySku[$sku] }
        if (Test-Path -LiteralPath $resultPath) {
            $old = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
            if ([string]::IsNullOrWhiteSpace($listingId) -and -not [string]::IsNullOrWhiteSpace([string]$old.listingId)) { $listingId = [string]$old.listingId }
        }
        if ([string]::IsNullOrWhiteSpace($listingId)) {
            $add = Invoke-TradingApi 'AddFixedPriceItem' $request
            $add.Save((Join-Path $dir 'publish-response.xml'))
            Assert-Success $add "Publish $($product.part)"
            $listingId = [string]$add.AddFixedPriceItemResponse.ItemID
        }
        if ([string]::IsNullOrWhiteSpace($listingId)) { throw "No listing ID: $($product.part)" }
        [xml]$get = New-Object System.Xml.XmlDocument
        $getRoot = $get.CreateElement('GetItemRequest',$ns)
        [void]$get.AppendChild($getRoot)
        [void](Add-TextElement $get $getRoot 'ItemID' $listingId)
        [void](Add-TextElement $get $getRoot 'IncludeItemSpecifics' 'true')
        [void](Add-TextElement $get $getRoot 'IncludeItemCompatibilityList' 'true')
        [void](Add-TextElement $get $getRoot 'DetailLevel' 'ReturnAll')
        $published = Invoke-TradingApi 'GetItem' $get
        $published.Save((Join-Path $dir 'published-item.xml'))
        Assert-Success $published "Audit $($product.part)"
        $pi = $published.GetItemResponse.Item
        $brand = @($pi.ItemSpecifics.NameValueList | Where-Object { $_.Name -eq 'Brand' } | ForEach-Object { [string]$_.Value })
        $prop65 = @($pi.ItemSpecifics.NameValueList | Where-Object { $_.Name -eq 'California Prop 65 Warning' })
        if ($pi.Seller.UserID -ne 'gandakorea' -or [string]$pi.Currency -ne 'USD' -or [int]$pi.Quantity -ne 5 -or @($pi.PictureDetails.PictureURL).Count -ne $uploads.Count -or @($pi.ItemCompatibilityList.Compatibility).Count -ne $compatibilities.Count -or $brand -notcontains 'Genuine Hyundai Mobis' -or $prop65.Count -ne 0) {
            throw "Published audit mismatch: $($product.part)"
        }
    }
    $row = [pscustomobject]@{ account='gandakorea'; marketplace='eBayMotors'; part=$product.part; reference=$product.reference; title=$product.title; price=$product.price; currency='USD'; quantity=5; shipping=$product.shipping; categoryId=[string]$sourceItem.PrimaryCategory.CategoryID; imageCount=$uploads.Count; compatibilityCount=$compatibilities.Count; listingId=$listingId; url=$(if($listingId){"https://www.ebay.com/itm/$listingId"}else{$null}); status=$(if($Publish){'ACTIVE'}else{'VERIFIED'}) }
    $row | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dir 'published-result.json') -Encoding utf8NoBOM
    $results += $row
}
$results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $batchRoot 'batch-result.json') -Encoding utf8NoBOM
$results | ConvertTo-Json -Depth 8
