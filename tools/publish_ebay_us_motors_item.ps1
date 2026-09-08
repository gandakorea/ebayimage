param(
    [string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'),
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$workDir = Join-Path $projectRoot '작업중/us/23510-2G450'
$sourcePath = Join-Path $projectRoot '작업중/ebay-335323492639/item.xml'
$descriptionPath = Join-Path $workDir 'listing-description.html'
$uploadsPath = Join-Path $workDir 'image-uploads.json'
$title = '⭐Genuine 235102G450 Connecting Rod For Hyundai Kia Genesis 2.0L 2016-2023'
$sku = '23510-2G450-US-20260909-TR'
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
    # PowerShell's string request path can undercount UTF-8 bytes for non-ASCII
    # characters. Numeric XML references keep the payload byte count exact.
    $payload = '<?xml version="1.0" encoding="utf-8"?>' + $Request.OuterXml.Replace('⭐', '&#x2B50;').Replace([string][char]0x2019, '&#x2019;')
    $client = [Net.Http.HttpClient]::new()
    try {
        $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, 'https://api.ebay.com/ws/api.dll')
        foreach ($entry in $headers.GetEnumerator()) { [void]$message.Headers.TryAddWithoutValidation($entry.Key, [string]$entry.Value) }
        $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
        $message.Content = [Net.Http.ByteArrayContent]::new($bytes)
        $message.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/xml; charset=utf-8')
        $response = $client.SendAsync($message).GetAwaiter().GetResult()
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        [xml]$content
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

$settings = Read-EnvironmentFile $EnvironmentFile
$script:accessToken = $settings['EBAY_US_ACCESS_TOKEN']
if ([string]::IsNullOrWhiteSpace($script:accessToken)) { $script:accessToken = $settings['EBAY_ACCESS_TOKEN'] }
if ([string]::IsNullOrWhiteSpace($script:accessToken)) { throw 'US eBay access token is missing.' }

$identity = Invoke-RestMethod -Uri 'https://apiz.ebay.com/commerce/identity/v1/user/' -Method Get -Headers @{ Authorization = "Bearer $script:accessToken" }
if ($identity.username -ne 'gandakorea') { throw "Wrong eBay identity: $($identity.username)" }

[xml]$source = Get-Content -Raw -LiteralPath $sourcePath
$sourceItem = $source.GetItemResponse.Item
$compatibilities = @($sourceItem.ItemCompatibilityList.Compatibility)
if ($compatibilities.Count -ne 66) { throw "Expected 66 compatibility rows, found $($compatibilities.Count)." }
$uploads = @(Get-Content -Raw -LiteralPath $uploadsPath | ConvertFrom-Json)
if ($uploads.Count -ne 6) { throw "Expected 6 uploaded images, found $($uploads.Count)." }
$description = Get-Content -Raw -LiteralPath $descriptionPath

[xml]$request = New-Object System.Xml.XmlDocument
$root = $request.CreateElement('AddFixedPriceItemRequest', $ns)
[void]$request.AppendChild($root)
[void](Add-TextElement $request $root 'ErrorLanguage' 'en_US')
[void](Add-TextElement $request $root 'WarningLevel' 'High')
$item = $request.CreateElement('Item', $ns)
[void]$root.AppendChild($item)
[void](Add-TextElement $request $item 'Title' $title)
$descriptionNode = $request.CreateElement('Description', $ns)
$descriptionNode.InnerText = $description
[void]$item.AppendChild($descriptionNode)
$category = $request.CreateElement('PrimaryCategory', $ns)
[void]$item.AppendChild($category)
[void](Add-TextElement $request $category 'CategoryID' '262124')
$startPrice = Add-TextElement $request $item 'StartPrice' '183.53'
[void]$startPrice.SetAttribute('currencyID', 'USD')
[void](Add-TextElement $request $item 'ConditionID' '1000')
[void](Add-TextElement $request $item 'Country' 'KR')
[void](Add-TextElement $request $item 'Currency' 'USD')
[void](Add-TextElement $request $item 'ListingDuration' 'GTC')
[void](Add-TextElement $request $item 'ListingType' 'FixedPriceItem')
[void](Add-TextElement $request $item 'Location' 'Seoul')
[void](Add-TextElement $request $item 'Quantity' '5')
[void](Add-TextElement $request $item 'SKU' $sku)
[void](Add-TextElement $request $item 'Site' 'eBayMotors')

$pictures = $request.CreateElement('PictureDetails', $ns)
[void]$item.AppendChild($pictures)
foreach ($upload in $uploads) { [void](Add-TextElement $request $pictures 'PictureURL' ([string]$upload.maxDimensionImageUrl)) }

$profiles = $request.CreateElement('SellerProfiles', $ns)
[void]$item.AppendChild($profiles)
$payment = $request.CreateElement('SellerPaymentProfile', $ns)
[void]$profiles.AppendChild($payment)
[void](Add-TextElement $request $payment 'PaymentProfileID' '234717937016')
$return = $request.CreateElement('SellerReturnProfile', $ns)
[void]$profiles.AppendChild($return)
[void](Add-TextElement $request $return 'ReturnProfileID' '38921318016')
$shipping = $request.CreateElement('SellerShippingProfile', $ns)
[void]$profiles.AppendChild($shipping)
[void](Add-TextElement $request $shipping 'ShippingProfileID' '268260144016')

$specifics = $request.CreateElement('ItemSpecifics', $ns)
[void]$item.AppendChild($specifics)
foreach ($entry in @($sourceItem.ItemSpecifics.NameValueList)) {
    $name = [string]$entry.Name
    if ([string]::IsNullOrWhiteSpace($name) -or $name -in @('Brand','California Prop 65 Warning','Manufacturer Part Number','OE/OEM Part Number')) { continue }
    $nvl = $request.CreateElement('NameValueList', $ns)
    [void]$specifics.AppendChild($nvl)
    [void](Add-TextElement $request $nvl 'Name' $name)
    foreach ($value in @($entry.Value)) { if (-not [string]::IsNullOrWhiteSpace([string]$value)) { [void](Add-TextElement $request $nvl 'Value' ([string]$value)) } }
}
foreach ($aspect in @(
    @{ Name='Brand'; Values=@('Genuine Hyundai Mobis') },
    @{ Name='Manufacturer Part Number'; Values=@('23510-2G450') },
    @{ Name='OE/OEM Part Number'; Values=@('235102G450','235102G441') }
)) {
    $nvl = $request.CreateElement('NameValueList', $ns)
    [void]$specifics.AppendChild($nvl)
    [void](Add-TextElement $request $nvl 'Name' $aspect.Name)
    foreach ($value in $aspect.Values) { [void](Add-TextElement $request $nvl 'Value' $value) }
}

$compatibilityList = $request.CreateElement('ItemCompatibilityList', $ns)
[void]$item.AppendChild($compatibilityList)
foreach ($compatibility in $compatibilities) {
    $compatibilityNode = $request.CreateElement('Compatibility', $ns)
    [void]$compatibilityList.AppendChild($compatibilityNode)
    foreach ($entry in @($compatibility.NameValueList)) {
        if ([string]::IsNullOrWhiteSpace([string]$entry.Name) -or [string]::IsNullOrWhiteSpace([string]$entry.Value)) { continue }
        $nvl = $request.CreateElement('NameValueList', $ns)
        [void]$compatibilityNode.AppendChild($nvl)
        [void](Add-TextElement $request $nvl 'Name' ([string]$entry.Name))
        [void](Add-TextElement $request $nvl 'Value' ([string]$entry.Value))
    }
}

$request.Save((Join-Path $workDir 'add-fixed-price-request.xml'))

$verifyRequest = [xml]$request.OuterXml
$verifyRoot = $verifyRequest.DocumentElement
$verifyRoot.LocalName | Out-Null
$renamed = $verifyRequest.CreateElement('VerifyAddFixedPriceItemRequest', $ns)
foreach ($attribute in @($verifyRoot.Attributes)) { [void]$renamed.SetAttribute($attribute.Name, $attribute.Value) }
while ($verifyRoot.HasChildNodes) { [void]$renamed.AppendChild($verifyRoot.FirstChild) }
[void]$verifyRequest.ReplaceChild($renamed, $verifyRoot)
$verifyRequest.Save((Join-Path $workDir 'verify-add-fixed-price-request.xml'))
if (-not $Publish) {
    [pscustomobject]@{
        account = 'gandakorea'
        marketplace = 'eBayMotors'
        sku = $sku
        status = 'READY_NOT_PUBLISHED'
        requestPath = (Join-Path $workDir 'add-fixed-price-request.xml')
    } | ConvertTo-Json -Depth 5
    exit 0
}

$publishedResultPath = Join-Path $workDir 'published-result.json'
if (Test-Path -LiteralPath $publishedResultPath) {
    $existingResult = Get-Content -Raw -LiteralPath $publishedResultPath | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace([string]$existingResult.listingId)) {
        [xml]$existingGetRequest = New-Object System.Xml.XmlDocument
        $existingGetRoot = $existingGetRequest.CreateElement('GetItemRequest', $ns)
        [void]$existingGetRequest.AppendChild($existingGetRoot)
        [void](Add-TextElement $existingGetRequest $existingGetRoot 'ItemID' ([string]$existingResult.listingId))
        [void](Add-TextElement $existingGetRequest $existingGetRoot 'DetailLevel' 'ReturnAll')
        $existingListing = Invoke-TradingApi -CallName 'GetItem' -Request $existingGetRequest
        if ([string]$existingListing.GetItemResponse.Item.SellingStatus.ListingStatus -eq 'Active') {
            $existingResult | ConvertTo-Json -Depth 8
            exit 0
        }
    }
}

$add = Invoke-TradingApi -CallName 'AddFixedPriceItem' -Request $request
$add.Save((Join-Path $workDir 'add-fixed-price-response.xml'))
Assert-Success -Response $add -Stage 'Publish'
$listingId = [string]$add.AddFixedPriceItemResponse.ItemID
if ([string]::IsNullOrWhiteSpace($listingId)) { throw 'Publish did not return a listing ID.' }

[xml]$getRequest = New-Object System.Xml.XmlDocument
$getRoot = $getRequest.CreateElement('GetItemRequest', $ns)
[void]$getRequest.AppendChild($getRoot)
[void](Add-TextElement $getRequest $getRoot 'ItemID' $listingId)
[void](Add-TextElement $getRequest $getRoot 'IncludeItemSpecifics' 'true')
[void](Add-TextElement $getRequest $getRoot 'IncludeItemCompatibilityList' 'true')
[void](Add-TextElement $getRequest $getRoot 'DetailLevel' 'ReturnAll')
$published = Invoke-TradingApi -CallName 'GetItem' -Request $getRequest
$published.Save((Join-Path $workDir 'published-item.xml'))
Assert-Success -Response $published -Stage 'Published listing verification'
$publishedItem = $published.GetItemResponse.Item
if ($publishedItem.Seller.UserID -ne 'gandakorea' -or [string]$publishedItem.Currency -ne 'USD' -or @($publishedItem.PictureDetails.PictureURL).Count -ne 6 -or @($publishedItem.ItemCompatibilityList.Compatibility).Count -ne 66 -or [int]$publishedItem.Quantity -ne 5) {
    throw 'Published listing data verification failed.'
}

$result = [pscustomobject]@{
    account = 'gandakorea'
    marketplace = 'eBayMotors'
    listingId = $listingId
    url = "https://www.ebay.com/itm/$listingId"
    title = [string]$publishedItem.Title
    price = [string]$publishedItem.StartPrice.InnerText
    currency = [string]$publishedItem.Currency
    quantity = [int]$publishedItem.Quantity
    imageCount = @($publishedItem.PictureDetails.PictureURL).Count
    compatibilityCount = @($publishedItem.ItemCompatibilityList.Compatibility).Count
    listingStatus = [string]$publishedItem.SellingStatus.ListingStatus
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $workDir 'published-result.json') -Encoding utf8NoBOM
$result | ConvertTo-Json -Depth 8
