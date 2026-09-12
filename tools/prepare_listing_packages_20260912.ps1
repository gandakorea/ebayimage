param(
    [string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$packageRoot = Join-Path $projectRoot '작업중\패키지\2026-09-12'

function Read-EnvironmentFile([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
    }
    $values
}

function Write-JsonFile([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 60
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Get-ItemSpecifics($Item) {
    $result = [ordered]@{}
    foreach ($entry in @($Item.ItemSpecifics.NameValueList)) {
        $name = [string]$entry.Name
        if ([string]::IsNullOrWhiteSpace($name) -or $name -match '(?i)California Prop') { continue }
        $values = @($entry.Value | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($values.Count) { $result[$name] = $values }
    }
    $result['Brand'] = @('Genuine Hyundai Mobis')
    $result['Country of Origin'] = @('Korea, Republic of')
    $result
}

function Get-UsCompatibility($Item) {
    $rows = @()
    foreach ($compatibility in @($Item.ItemCompatibilityList.Compatibility)) {
        $row = [ordered]@{}
        foreach ($entry in @($compatibility.NameValueList)) {
            $name = [string]$entry.Name
            $value = [string]$entry.Value
            if (-not [string]::IsNullOrWhiteSpace($name) -and -not [string]::IsNullOrWhiteSpace($value)) { $row[$name] = $value }
        }
        if ($row.Count) { $rows += [pscustomobject]$row }
    }
    @($rows)
}

function Invoke-AuJson([string]$Uri, [string]$Method, $Body = $null) {
    $headers = @{
        Authorization = "Bearer $script:auToken"
        'X-EBAY-C-MARKETPLACE-ID' = 'EBAY_AU'
        'Content-Language' = 'en-AU'
        Accept = 'application/json'
    }
    $parameters = @{ Uri=$Uri; Method=$Method; Headers=$headers }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 30 -Compress))
    }
    Invoke-RestMethod @parameters
}

function Get-AuCatalogRows([string]$CategoryId, [string]$Make, [string]$Model) {
    $body = @{
        categoryId = $CategoryId
        propertyFilters = @(
            @{ propertyName='Make'; propertyValue=$Make },
            @{ propertyName='Model'; propertyValue=$Model }
        )
        propertyNames = @('Year','Make','Model','Submodel','Variant','Engine')
    }
    $response = Invoke-AuJson 'https://api.ebay.com/sell/metadata/v1/compatibilities/get_multi_compatibility_property_values' 'POST' $body
    $rows = @()
    foreach ($compatibility in @($response.compatibilities)) {
        $row = [ordered]@{}
        foreach ($detail in @($compatibility.compatibilityDetails)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$detail.propertyValue)) { $row[[string]$detail.propertyName] = [string]$detail.propertyValue }
        }
        if ($row.Count) { $rows += [pscustomobject]$row }
    }
    @($rows)
}

function Select-AuCompatibility($Product) {
    $selected = @()
    $audit = @()
    foreach ($target in $Product.auTargets) {
        try {
            $rows = @(Get-AuCatalogRows $Product.categoryId $target.make $target.model)
        } catch {
            $audit += [pscustomobject]@{ make=$target.make; model=$target.model; catalog=0; selected=0; error=$_.Exception.Message }
            continue
        }
        $matched = @($rows | Where-Object {
            $year = 0
            $yearOk = [int]::TryParse([string]$_.Year, [ref]$year) -and $year -ge $target.minYear -and $year -le $target.maxYear
            $engine = "$($_.Variant) $($_.Engine)"
            $engineOk = [string]::IsNullOrWhiteSpace([string]$target.enginePattern) -or $engine -match $target.enginePattern
            $yearOk -and $engineOk
        })
        $selected += $matched
        $audit += [pscustomobject]@{ make=$target.make; model=$target.model; catalog=$rows.Count; selected=$matched.Count }
    }
    $deduped = @($selected | Sort-Object Year,Make,Model,Submodel,Variant,Engine -Unique)
    [pscustomobject]@{ rows=$deduped; audit=$audit }
}

function New-Description([string]$Template, [string]$TemplateTitle, $Product) {
    $value = $Template.Replace($TemplateTitle, $Product.title)
    $bodyTitle = [regex]'⭐Genuine[^<]+'
    if (-not $bodyTitle.IsMatch($value)) { throw "Description title line not found: $($Product.part)" }
    $value = $bodyTitle.Replace($value, $Product.title, 1)
    foreach ($old in @('437112M1009P','43711-2M1009P','43711 2M1009P')) { $value = $value.Replace($old, $Product.compactPart) }
    $value = $value.Replace('leather 6 speed MT gear shift knob lever', $Product.partWords)
    $value = $value.Replace('Leather 6 Speed MT Gear Shift Knob Lever', $Product.partWords)
    $value = $value.Replace('This part fits Hyundai Genesis Coupe 2009-2017.', 'This part fits the vehicles listed in the compatibility table.')
    if ($value -match '(?i)43711[- ]?2M1009P|leather 6 speed|gear shift knob') { throw "Old template product text remains: $($Product.part)" }
    if (-not $value.Contains($Product.title)) { throw "Current title missing from description: $($Product.part)" }
    $value
}

$settings = Read-EnvironmentFile $EnvironmentFile
$script:auToken = $settings['EBAY_AU_USER_TOKEN']
$usToken = $settings['EBAY_US_ACCESS_TOKEN']
if ([string]::IsNullOrWhiteSpace($script:auToken) -or [string]::IsNullOrWhiteSpace($usToken)) { throw 'eBay access token is missing.' }
$usIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{ Authorization="Bearer $usToken" }
$auIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{ Authorization="Bearer $script:auToken" }
if ($usIdentity.username -ne 'gandakorea' -or $usIdentity.registrationMarketplaceId -ne 'EBAY_US') { throw "Wrong US identity: $($usIdentity.username) / $($usIdentity.registrationMarketplaceId)" }
if ($auIdentity.username -ne 'sihooshop' -or $auIdentity.registrationMarketplaceId -ne 'EBAY_AU') { throw "Wrong AU identity: $($auIdentity.username) / $($auIdentity.registrationMarketplaceId)" }

$petrolHybridPattern = '(?i)(?=.*(?:1591cc|1600cc|1998cc|1999cc|2000cc|2359cc|2400cc|3342cc|1\.6L|2\.0L|2\.4L|3\.3L|Hydrogen|Fuel Cell))(?=.*(?:Petrol|Hybrid|Hydrogen|Fuel|Electric))'
$genesisPattern = '(?i)(?=.*(?:3778cc|3800cc|4627cc|4600cc|5038cc|5000cc|3\.8L|4\.6L|5\.0L))(?=.*Petrol)'
$products = @(
    [pscustomobject]@{
        itemId='e21462be-39be-4470-b775-ff0c1e3ddc19'; reference='235576053789'; part='51750-C1000'; compactPart='51750C1000'; categoryId='170141'; usd='558.82'; shipping='7day fast';
        title='⭐Genuine 51750C1000 Front Wheel Hub & Bearing 2EA For Hyundai Kia 2015-2023'; type='Wheel Hub & Bearing Assembly'; partWords='front wheel hub and bearing assembly set';
        stores=@('/Hyundai/Sonata','/Kia/Sportage');
        auTargets=@(
            @{make='Hyundai';model='Nexo';minYear=2019;maxYear=2023;enginePattern='(?i)(Hydrogen|Fuel Cell|Electric)'},
            @{make='Hyundai';model='Sonata';minYear=2015;maxYear=2019;enginePattern=$petrolHybridPattern},
            @{make='Hyundai';model='Tucson';minYear=2016;maxYear=2021;enginePattern=$petrolHybridPattern},
            @{make='Hyundai';model='Veloster';minYear=2019;maxYear=2022;enginePattern='(?i)(1998cc|1999cc|2000cc|2\.0L).*Petrol'},
            @{make='Kia';model='Cadenza';minYear=2017;maxYear=2020;enginePattern='(?i)(3342cc|3300cc|3\.3L).*Petrol'},
            @{make='Kia';model='Optima';minYear=2016;maxYear=2020;enginePattern=$petrolHybridPattern},
            @{make='Kia';model='Sportage';minYear=2017;maxYear=2022;enginePattern=$petrolHybridPattern}
        )
    },
    [pscustomobject]@{
        itemId='350a3d64-51f3-456d-aada-9241ed3fa255'; reference='335913695538'; part='86576-3M500'; compactPart='865763M500'; categoryId='33640'; usd='136.47'; shipping='7day fast';
        title='⭐Genuine Front Bumper Lower Molding Right For Hyundai Genesis 2012-2014'; type='Bumper'; partWords='front bumper lower molding right';
        stores=@('/Hyundai/Genesis');
        auTargets=@(@{make='Hyundai';model='Genesis';minYear=2012;maxYear=2014;enginePattern=$genesisPattern})
    }
)

[xml]$templateXml = Get-Content -Raw -LiteralPath (Join-Path $projectRoot '작업중\ebay-336779935333\item.xml')
$templateItem = $templateXml.GetItemResponse.Item
$templateTitle = [string]$templateItem.Title
$templateDescription = [string]$templateItem.Description
New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
$summary = @()

foreach ($product in $products) {
    [xml]$sourceXml = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "작업중\ebay-$($product.reference)\item.xml")
    $source = $sourceXml.GetItemResponse.Item
    if ([string]$source.Seller.UserID -ne 'gandakorea') { throw "Reference seller mismatch: $($product.reference)" }
    if (-not $product.title.StartsWith('⭐Genuine ') -or $product.title.Length -gt 80) { throw "Invalid title: $($product.title)" }
    $usCompatibility = @(Get-UsCompatibility $source)
    if (-not $usCompatibility.Count) { throw "No US compatibility: $($product.part)" }
    $auSelection = Select-AuCompatibility $product
    if (-not $auSelection.rows.Count) { throw "No AU compatibility: $($product.part)" }
    $specifics = Get-ItemSpecifics $source
    $specifics['Manufacturer Part Number'] = @($product.compactPart)
    $description = New-Description $templateDescription $templateTitle $product
    $storeIds = @([string]$source.Storefront.StoreCategoryID, [string]$source.Storefront.StoreCategory2ID | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne '0' })
    $manifest = [ordered]@{
        version=1; date='2026-09-12'; itemId=$product.itemId; referenceItemNumber=$product.reference; partNumber=$product.part;
        usdPrice=$product.usd; shippingPolicy=$product.shipping; title=$product.title; descriptionHtml=$description; type=$product.type; images=@(); preparedAt='';
        us=[ordered]@{ categoryId=[string]$source.PrimaryCategory.CategoryID; storeCategoryIds=@($storeIds); itemSpecifics=$specifics; compatibility=$usCompatibility };
        au=[ordered]@{ categoryId=[string]$source.PrimaryCategory.CategoryID; storeCategoryNames=@($product.stores); itemSpecifics=$specifics; compatibility=@($auSelection.rows) }
    }
    $path = Join-Path $packageRoot "$($product.itemId).json"
    Write-JsonFile $path $manifest
    Write-JsonFile (Join-Path $packageRoot "$($product.itemId)-au-audit.json") $auSelection.audit
    $summary += [pscustomobject]@{ part=$product.part; manifest=$path; usCompatibility=$usCompatibility.Count; auCompatibility=$auSelection.rows.Count; titleLength=$product.title.Length }
}

[pscustomobject]@{ usIdentity=$usIdentity.username; auIdentity=$auIdentity.username; packages=$summary } | ConvertTo-Json -Depth 8
