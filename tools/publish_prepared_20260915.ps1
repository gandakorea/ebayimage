param([switch]$Publish)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$date = '2026-09-15'
$packageRoot = Join-Path $projectRoot "작업중\패키지\$date"
$resultRoot = Join-Path $projectRoot "작업중\등록결과\$date"
$ns = 'urn:ebay:apis:eBLBaseComponents'

function Read-Env([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"') }
    }
    $values
}

function Write-Json([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 80
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Xml([string]$Value) { [Security.SecurityElement]::Escape($Value) }

function Assert-Trading([xml]$Response, [string]$Stage) {
    $ack = [string]$Response.DocumentElement.Ack
    if ($ack -notin @('Success','Warning')) {
        $messages = @($Response.DocumentElement.Errors | ForEach-Object { "[$($_.ErrorCode)] $($_.LongMessage)" }) -join '; '
        throw "$Stage failed: $messages"
    }
}

function Invoke-Trading([string]$Token, [string]$Call, [string]$SiteId, [string]$Body) {
    $headers = @{
        'X-EBAY-API-CALL-NAME' = $Call
        'X-EBAY-API-SITEID' = $SiteId
        'X-EBAY-API-COMPATIBILITY-LEVEL' = '1193'
        'X-EBAY-API-IAF-TOKEN' = $Token
    }
    $client = [Net.Http.HttpClient]::new()
    try {
        $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, 'https://api.ebay.com/ws/api.dll')
        foreach ($entry in $headers.GetEnumerator()) { [void]$message.Headers.TryAddWithoutValidation($entry.Key, [string]$entry.Value) }
        $message.Content = [Net.Http.ByteArrayContent]::new([Text.Encoding]::UTF8.GetBytes($Body))
        $message.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/xml; charset=utf-8')
        $response = $client.SendAsync($message).GetAwaiter().GetResult()
        [xml]$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } finally {
        if ($null -ne $message) { $message.Dispose() }
        $client.Dispose()
    }
}

function Invoke-EbayJson([string]$Token, [string]$Uri, [string]$Method, $Body = $null) {
    $headers = @{ Authorization="Bearer $Token"; 'X-EBAY-C-MARKETPLACE-ID'='EBAY_AU'; 'Content-Language'='en-AU'; Accept='application/json' }
    $parameters = @{ Uri=$Uri; Method=$Method; Headers=$headers }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 80 -Compress))
    } elseif ($Method -in @('POST','PUT')) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes('{}')
    }
    Invoke-RestMethod @parameters
}

function Get-Images([string]$Part) {
    $directory = Join-Path $projectRoot "완성본\$Part"
    $escaped = [regex]::Escape($Part)
    $files = @(Get-ChildItem -LiteralPath $directory -File -Filter '*.png' | Where-Object { $_.BaseName -match "^$escaped(?:_\d+)?$" } | Sort-Object @{Expression={ if ($_.BaseName -eq $Part) { 0 } else { [int]($_.BaseName.Split('_')[-1]) } }})
    if (-not $files.Count) { throw "No final images: $Part" }
    for ($i=0; $i -lt $files.Count; $i++) {
        $expected = if ($i -eq 0) { "$Part.png" } else { "${Part}_$i.png" }
        if ($files[$i].Name -ne $expected) { throw "Image sequence mismatch: $($files[$i].Name), expected $expected" }
    }
    @($files)
}

function Upload-Images([string]$Token, $Files) {
    $uploads = @()
    foreach ($file in $Files) {
        $response = Invoke-WebRequest -Uri 'https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file' -Method Post -Headers @{Authorization="Bearer $Token";Accept='application/json'} -Form @{image=$file}
        $payload = $response.Content | ConvertFrom-Json
        $url = [string]$payload.maxDimensionImageUrl
        if ([string]::IsNullOrWhiteSpace($url)) { $url = [string]$payload.imageUrl }
        if ([string]::IsNullOrWhiteSpace($url)) { throw "eBay image upload failed: $($file.Name)" }
        $uploads += [pscustomobject]@{ filename=$file.Name; url=$url }
    }
    @($uploads)
}

function Specifics-Xml($Specifics) {
    $parts = @()
    foreach ($property in $Specifics.PSObject.Properties) {
        if ($property.Name -match '(?i)California Prop') { continue }
        foreach ($value in @($property.Value)) { $parts += '<NameValueList><Name>'+(Xml $property.Name)+'</Name><Value>'+(Xml ([string]$value))+'</Value></NameValueList>' }
    }
    $parts -join ''
}

function Compatibility-Xml($Rows) {
    $parts = @()
    foreach ($row in @($Rows)) {
        $values = @()
        foreach ($property in $row.PSObject.Properties) { if (-not [string]::IsNullOrWhiteSpace([string]$property.Value)) { $values += '<NameValueList><Name>'+(Xml $property.Name)+'</Name><Value>'+(Xml ([string]$property.Value))+'</Value></NameValueList>' } }
        $parts += '<Compatibility>'+($values -join '')+'<CompatibilityNotes></CompatibilityNotes></Compatibility>'
    }
    $parts -join ''
}

function Get-PublicItem([string]$Token, [string]$SiteId, [string]$ListingId) {
    $body = '<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>'+(Xml $ListingId)+'</ItemID><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>'
    $response = Invoke-Trading $Token 'GetItem' $SiteId $body
    Assert-Trading $response "GetItem $ListingId"
    $response
}

function Find-ActiveUsSku([string]$Token, [string]$Sku) {
    $from = [DateTime]::UtcNow.AddDays(-7).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $to = [DateTime]::UtcNow.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $body = '<?xml version="1.0" encoding="utf-8"?><GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents"><StartTimeFrom>'+$from+'</StartTimeFrom><StartTimeTo>'+$to+'</StartTimeTo><DetailLevel>ReturnAll</DetailLevel><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerListRequest>'
    $response = Invoke-Trading $Token 'GetSellerList' '100' $body
    Assert-Trading $response 'US duplicate check'
    $match = @($response.GetSellerListResponse.ItemArray.Item | Where-Object { [string]$_.SKU -eq $Sku -and [string]$_.SellingStatus.ListingStatus -eq 'Active' } | Select-Object -First 1)
    if ($match.Count) { [string]$match[0].ItemID } else { $null }
}

function New-UsRequest($Package, $Uploads, [string]$Call) {
    $pictures = @($Uploads | ForEach-Object { '<PictureURL>'+(Xml $_.url)+'</PictureURL>' }) -join ''
    $stores = @($Package.us.storeCategoryIds)
    $storeXml = if ($stores.Count) { '<Storefront><StoreCategoryID>'+(Xml ([string]$stores[0]))+'</StoreCategoryID>' + $(if ($stores.Count -gt 1) {'<StoreCategory2ID>'+(Xml ([string]$stores[1]))+'</StoreCategory2ID>'}else{''}) + '</Storefront>' } else { '' }
    $compat = if (@($Package.us.compatibility).Count) { '<ItemCompatibilityList>'+(Compatibility-Xml $Package.us.compatibility)+'</ItemCompatibilityList>' } else { '' }
    $description = ([string]$Package.descriptionHtml).Replace(']]>',']]]]><![CDATA[>')
    $sku = "$($Package.partNumber)-US-20260915-$(([string]$Package.itemId).Substring(0,8))"
    $shippingProfileId = if ([string]$Package.shippingPolicy -eq '7day fast') { '268260144016' } else { '268260114016' }
    '<?xml version="1.0" encoding="utf-8"?><'+$Call+'Request xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel><Item><SKU>'+(Xml $sku)+'</SKU><Title>'+(Xml $Package.title)+'</Title><Description><![CDATA['+$description+']]></Description><PrimaryCategory><CategoryID>'+(Xml $Package.us.categoryId)+'</CategoryID></PrimaryCategory><StartPrice currencyID="USD">'+(Xml $Package.usdPrice)+'</StartPrice><CategoryMappingAllowed>true</CategoryMappingAllowed><ConditionID>1000</ConditionID><Country>KR</Country><Currency>USD</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><Quantity>5</Quantity><Location>Seoul</Location><PostalCode>16975</PostalCode><Site>eBayMotors</Site><PictureDetails>'+$pictures+'</PictureDetails><SellerProfiles><SellerPaymentProfile><PaymentProfileID>234717937016</PaymentProfileID></SellerPaymentProfile><SellerReturnProfile><ReturnProfileID>38921318016</ReturnProfileID></SellerReturnProfile><SellerShippingProfile><ShippingProfileID>'+(Xml $shippingProfileId)+'</ShippingProfileID></SellerShippingProfile></SellerProfiles><ItemSpecifics>'+(Specifics-Xml $Package.us.itemSpecifics)+'</ItemSpecifics>'+$compat+$storeXml+'</Item></'+$Call+'Request>'
}

function Assert-Public($Item, $Package, [string]$Seller, [string]$Currency, [int]$ImageCount, [int]$CompatibilityCount) {
    $public = $Item.GetItemResponse.Item
    $actualCompatibilityCount = @($public.ItemCompatibilityList.Compatibility | Where-Object {
        @($_.NameValueList | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.Name) }).Count -gt 0
    }).Count
    if ([string]$public.Seller.UserID -ne $Seller -or [string]$public.Currency -ne $Currency -or [int]$public.Quantity -ne 5) { throw "Published account/currency/quantity verification failed: $($Package.partNumber)" }
    if ([string]$public.Title -ne [string]$Package.title -or [string]$public.StartPrice.'#text' -ne [string]$Package.usdPrice -and $Currency -eq 'USD') { throw "Published title/price verification failed: $($Package.partNumber)" }
    if (@($public.PictureDetails.PictureURL).Count -ne $ImageCount) { throw "Published image count verification failed: $($Package.partNumber)" }
    if ($actualCompatibilityCount -ne $CompatibilityCount) { throw "Published compatibility count verification failed: $($Package.partNumber)" }
    if (-not ([string]$public.Description).Contains([string]$Package.title) -or ([string]$public.Description) -match '(?i)43711[- ]?2M1009P|leather 6 speed|gear shift knob') { throw "Published description verification failed: $($Package.partNumber)" }
    if (@($public.ItemSpecifics.NameValueList | Where-Object { [string]$_.Name -match '(?i)California Prop' }).Count) { throw "Prop 65 field found: $($Package.partNumber)" }
}

$envs = Read-Env (Join-Path $projectRoot '.env.ebay.local')
$usToken = $envs['EBAY_US_ACCESS_TOKEN']
$auToken = $envs['EBAY_AU_USER_TOKEN']
if ([string]::IsNullOrWhiteSpace($usToken) -or [string]::IsNullOrWhiteSpace($auToken)) { throw 'eBay token missing.' }
$usIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $usToken"}
$auIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $auToken"}
if ($usIdentity.username -ne 'gandakorea' -or $usIdentity.registrationMarketplaceId -ne 'EBAY_US') { throw 'US account mismatch.' }
if ($auIdentity.username -ne 'sihooshop' -or $auIdentity.registrationMarketplaceId -ne 'EBAY_AU') { throw 'AU account mismatch.' }

$packages = @(Get-ChildItem -LiteralPath $packageRoot -Filter '*.json' -File | Where-Object { $_.BaseName -notmatch '-au-audit$' } | Sort-Object Name | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json })
if ($packages.Count -ne 4) { throw "Expected four packages, got $($packages.Count)" }
New-Item -ItemType Directory -Force -Path $resultRoot | Out-Null
$results = @()

# Complete and verify the full US batch before any AU mutation.
foreach ($package in $packages) {
    $sku = "$($package.partNumber)-US-20260915-$(([string]$package.itemId).Substring(0,8))"
    $listingId = Find-ActiveUsSku $usToken $sku
    $files = Get-Images $package.partNumber
    if (-not $listingId) {
        $uploads = Upload-Images $usToken $files
        $verifyRequest = New-UsRequest $package $uploads 'VerifyAddFixedPriceItem'
        $verified = Invoke-Trading $usToken 'VerifyAddFixedPriceItem' '100' $verifyRequest
        Assert-Trading $verified "US verify $($package.partNumber)"
        if ($Publish) {
            $publishRequest = New-UsRequest $package $uploads 'AddFixedPriceItem'
            $published = Invoke-Trading $usToken 'AddFixedPriceItem' '100' $publishRequest
            Assert-Trading $published "US publish $($package.partNumber)"
            $listingId = [string]$published.AddFixedPriceItemResponse.ItemID
        }
    }
    if ($Publish) {
        if ([string]::IsNullOrWhiteSpace($listingId)) { throw "US listing ID missing: $($package.partNumber)" }
        $public = Get-PublicItem $usToken '100' $listingId
        Assert-Public $public $package 'gandakorea' 'USD' $files.Count @($package.us.compatibility).Count
        $public.Save((Join-Path $resultRoot "$($package.partNumber)-US.xml"))
    }
    $result = [pscustomobject]@{account='gandakorea';marketplace='EBAY_US';part=$package.partNumber;sku=$sku;price=$package.usdPrice;currency='USD';images=$files.Count;compatibility=@($package.us.compatibility).Count;listingId=$listingId;url=$(if($listingId){"https://www.ebay.com/itm/$listingId"}else{$null});status=$(if($Publish){'ACTIVE'}else{'VERIFIED'})}
    Write-Json (Join-Path $resultRoot "$($package.partNumber)-US.json") $result
    $results += $result
}

if ($Publish -and @($results | Where-Object {$_.marketplace -eq 'EBAY_US' -and $_.status -eq 'ACTIVE'}).Count -ne 4) { throw 'US batch did not complete; AU was not started.' }

$rateResponse = Invoke-RestMethod 'https://api.frankfurter.app/latest?from=USD&to=AUD'
$rate = [double]$rateResponse.rates.AUD
if ($rate -le 0) { throw 'USD/AUD rate unavailable.' }

foreach ($package in $packages) {
    $sku = "$($package.partNumber)-AU-20260915-$(([string]$package.itemId).Substring(0,8))"
    $files = Get-Images $package.partNumber
    $aud = [Math]::Round(([double]$package.usdPrice * $rate),2,[MidpointRounding]::AwayFromZero).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture)
    try {
        $offerList = Invoke-EbayJson $auToken ('https://api.ebay.com/sell/inventory/v1/offer?sku='+[uri]::EscapeDataString($sku)) 'GET'
    } catch {
        if ($_.ErrorDetails.Message -match '25713|This Offer is not available') { $offerList = [pscustomobject]@{ offers=@() } } else { throw }
    }
    $existing = @($offerList.offers | Select-Object -First 1)
    $listingId = if ($existing.Count -and $existing[0].status -eq 'PUBLISHED' -and $existing[0].listing.listingStatus -eq 'ACTIVE') { [string]$existing[0].listing.listingId } else { $null }
    if (-not $listingId) {
        $uploads = Upload-Images $auToken $files
        $aspects = [ordered]@{}
        foreach ($property in $package.au.itemSpecifics.PSObject.Properties) { if ($property.Name -notmatch '(?i)California Prop') { $aspects[$property.Name] = @($property.Value) } }
        $aspects['Brand'] = @('Genuine Hyundai Mobis')
        $aspects['Manufacturer Part Number'] = @($package.partNumber)
        if ($package.au.itemSpecifics.PSObject.Properties.Name -contains 'Country of Origin') {
            $aspects['Country of Origin'] = @($package.au.itemSpecifics.'Country of Origin')
        } else {
            [void]$aspects.Remove('Country of Origin')
        }
        $inventory = @{availability=@{shipToLocationAvailability=@{quantity=5}};condition='NEW';product=@{title=$package.title;brand='Genuine Hyundai Mobis';mpn=$package.partNumber;imageUrls=@($uploads.url);aspects=$aspects}}
        $inventoryUrl = 'https://api.ebay.com/sell/inventory/v1/inventory_item/'+[uri]::EscapeDataString($sku)
        Invoke-EbayJson $auToken $inventoryUrl 'PUT' $inventory | Out-Null
        $compatibility = @{compatibleProducts=@($package.au.compatibility | ForEach-Object { $row=$_; @{compatibilityProperties=@($row.PSObject.Properties | ForEach-Object {@{name=$_.Name;value=[string]$_.Value}})} })}
        if (@($package.au.compatibility).Count) {
            Invoke-EbayJson $auToken ($inventoryUrl+'/product_compatibility') 'PUT' $compatibility | Out-Null
        }
        $inventoryAudit = Invoke-EbayJson $auToken $inventoryUrl 'GET'
        $compatibilityCount = if (@($package.au.compatibility).Count) {
            @((Invoke-EbayJson $auToken ($inventoryUrl+'/product_compatibility') 'GET').compatibleProducts).Count
        } else { 0 }
        if (@($inventoryAudit.product.imageUrls).Count -ne $files.Count -or $compatibilityCount -ne @($package.au.compatibility).Count) { throw "AU inventory verification failed: $($package.partNumber)" }
        $fulfillmentPolicyId = if ([string]$package.shippingPolicy -eq '7day fast') { '257425043024' } else { '257576069024' }
        $offer = @{sku=$sku;marketplaceId='EBAY_AU';format='FIXED_PRICE';availableQuantity=5;categoryId=$package.au.categoryId;merchantLocationKey='sihooshop-korea';listingDescription=$package.descriptionHtml;listingPolicies=@{paymentPolicyId='178186266024';returnPolicyId='110686678024';fulfillmentPolicyId=$fulfillmentPolicyId};pricingSummary=@{price=@{value=$aud;currency='AUD'}};storeCategoryNames=@($package.au.storeCategoryNames);listingDuration='GTC';includeCatalogProductDetails=$true}
        if ($existing.Count) {
            $offerId = [string]$existing[0].offerId
            Invoke-EbayJson $auToken ('https://api.ebay.com/sell/inventory/v1/offer/'+$offerId) 'PUT' $offer | Out-Null
        } else {
            $created = Invoke-EbayJson $auToken 'https://api.ebay.com/sell/inventory/v1/offer' 'POST' $offer
            $offerId = [string]$created.offerId
        }
        if ($Publish) {
            $published = Invoke-EbayJson $auToken ('https://api.ebay.com/sell/inventory/v1/offer/'+$offerId+'/publish') 'POST' @{}
            $listingId = [string]$published.listingId
        }
    }
    if ($Publish) {
        if ([string]::IsNullOrWhiteSpace($listingId)) { throw "AU listing ID missing: $($package.partNumber)" }
        $public = Get-PublicItem $auToken '15' $listingId
        Assert-Public $public $package 'sihooshop' 'AUD' $files.Count @($package.au.compatibility).Count
        $public.Save((Join-Path $resultRoot "$($package.partNumber)-AU.xml"))
    }
    $result = [pscustomobject]@{account='sihooshop';marketplace='EBAY_AU';part=$package.partNumber;sku=$sku;sourceUsd=$package.usdPrice;exchangeRate=$rate;price=$aud;currency='AUD';images=$files.Count;compatibility=@($package.au.compatibility).Count;listingId=$listingId;url=$(if($listingId){"https://www.ebay.com.au/itm/$listingId"}else{$null});status=$(if($Publish){'ACTIVE'}else{'READY'})}
    Write-Json (Join-Path $resultRoot "$($package.partNumber)-AU.json") $result
    $results += $result
}

Write-Json (Join-Path $resultRoot 'batch-result.json') $results
$results | ConvertTo-Json -Depth 12
