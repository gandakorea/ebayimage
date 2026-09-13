param([string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'))

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$date = '2026-09-13'
$itemId = '4897760a-7812-4269-a947-d49aba83cb25'
$reference = '334915457651'
$part = '97154-2Y000'
$compactPart = '971542Y000'
$title = '⭐Genuine HVAC Blend Door Actuator For Hyundai Santa Fe Kia Sorento Sedona 13-18'
$packageRoot = Join-Path $projectRoot "작업중\패키지\$date"

function Read-Env([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
    }
    $values
}

function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 80), [Text.UTF8Encoding]::new($false))
}

function Invoke-Au([string]$Token, [string]$Make, [string]$Model) {
    $body = @{
        categoryId = '33545'
        propertyFilters = @(
            @{ propertyName='Make'; propertyValue=$Make },
            @{ propertyName='Model'; propertyValue=$Model }
        )
        propertyNames = @('Year','Make','Model','Submodel','Variant','Engine')
    }
    $headers = @{ Authorization="Bearer $Token"; 'X-EBAY-C-MARKETPLACE-ID'='EBAY_AU'; 'Content-Language'='en-AU'; Accept='application/json' }
    $response = Invoke-RestMethod 'https://api.ebay.com/sell/metadata/v1/compatibilities/get_multi_compatibility_property_values' -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10 -Compress)))
    @($response.compatibilities | ForEach-Object {
        $row = [ordered]@{}
        foreach ($detail in $_.compatibilityDetails) { $row[[string]$detail.propertyName] = [string]$detail.propertyValue }
        [pscustomobject]$row
    })
}

function Get-Compatibility($Item) {
    @($Item.ItemCompatibilityList.Compatibility | ForEach-Object {
        $row = [ordered]@{}
        foreach ($entry in $_.NameValueList) {
            $name = [string]$entry.Name
            if (-not [string]::IsNullOrWhiteSpace($name)) { $row[$name] = [string]$entry.Value }
        }
        [pscustomobject]$row
    })
}

function Get-Specifics($Item) {
    $result = [ordered]@{}
    foreach ($entry in @($Item.ItemSpecifics.NameValueList)) {
        if ([string]$entry.Name -match '(?i)California Prop') { continue }
        $result[[string]$entry.Name] = @($entry.Value | ForEach-Object { [string]$_ })
    }
    $result['Brand'] = @('Genuine Hyundai Mobis')
    $result['Manufacturer Part Number'] = @($compactPart)
    $result['Country of Origin'] = @('Korea, Republic of')
    $result
}

$envs = Read-Env $EnvironmentFile
$usIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $($envs['EBAY_US_ACCESS_TOKEN'])"}
$auIdentity = Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $($envs['EBAY_AU_USER_TOKEN'])"}
if ($usIdentity.username -ne 'gandakorea' -or $usIdentity.registrationMarketplaceId -ne 'EBAY_US') { throw 'US account mismatch.' }
if ($auIdentity.username -ne 'sihooshop' -or $auIdentity.registrationMarketplaceId -ne 'EBAY_AU') { throw 'AU account mismatch.' }
if ($title.Length -gt 80 -or -not $title.StartsWith('⭐Genuine ')) { throw "Title rule failed: $($title.Length)" }

[xml]$sourceXml = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "작업중\ebay-$reference\item.xml")
[xml]$templateXml = Get-Content -Raw -LiteralPath (Join-Path $projectRoot '작업중\ebay-336779935333\item.xml')
$source = $sourceXml.GetItemResponse.Item
$template = $templateXml.GetItemResponse.Item
if ([string]$source.Seller.UserID -ne 'gandakorea') { throw 'Reference seller mismatch.' }
if ([string]$source.PrimaryCategory.CategoryID -ne '33545') { throw 'Reference category mismatch.' }

$description = ([string]$template.Description).Replace([string]$template.Title, $title)
$description = ([regex]'⭐Genuine[^<]+').Replace($description, $title, 1)
foreach ($old in @('437112M1009P','43711-2M1009P','43711 2M1009P')) { $description = $description.Replace($old, $compactPart) }
$description = [regex]::Replace($description, '(?i)leather 6 speed MT gear shift knob lever', 'HVAC blend door actuator')
$description = $description.Replace('This part fits Hyundai Genesis Coupe 2009-2017.', 'This part fits the vehicles listed in the compatibility table.')
if ($description -match '(?i)43711[- ]?2M1009P|leather 6 speed|gear shift knob|Genesis Coupe') { throw 'Old product text remains in description.' }
if (-not $description.Contains($title)) { throw 'Current title missing from description.' }

$santaFe = @(Invoke-Au $envs['EBAY_AU_USER_TOKEN'] 'Hyundai' 'Santa Fe' | Where-Object {
    [int]$_.Year -ge 2013 -and [int]$_.Year -le 2018 -and $_.Engine -match '^(2359cc|3342cc).*\(Petrol\)$'
})
$sorento = @(Invoke-Au $envs['EBAY_AU_USER_TOKEN'] 'Kia' 'Sorento' | Where-Object {
    [int]$_.Year -ge 2015 -and [int]$_.Year -le 2018 -and $_.Engine -match '^(2359cc|3342cc).*\(Petrol\)$'
})
$carnival = @(Invoke-Au $envs['EBAY_AU_USER_TOKEN'] 'Kia' 'Carnival' | Where-Object {
    [int]$_.Year -ge 2015 -and [int]$_.Year -le 2018 -and $_.Engine -match '^3342cc.*\(Petrol\)$'
})
$auCompatibility = @($santaFe + $sorento + $carnival | Sort-Object Year,Make,Model,Submodel,Variant,Engine -Unique)
$usCompatibility = @(Get-Compatibility $source)
if ($usCompatibility.Count -ne 116) { throw "Unexpected US compatibility count: $($usCompatibility.Count)" }
if (-not $auCompatibility.Count) { throw 'No AU compatibility rows.' }

$specifics = Get-Specifics $source
$manifest = [ordered]@{
    version=1; date=$date; itemId=$itemId; referenceItemNumber=$reference; partNumber=$part
    usdPrice='69.41'; shippingPolicy='7day normal'; title=$title; descriptionHtml=$description
    type='HVAC Blend Door Actuator'; images=@(); preparedAt=''
    us=[ordered]@{
        categoryId='33545'
        storeCategoryIds=@([string]$source.Storefront.StoreCategoryID, [string]$source.Storefront.StoreCategory2ID)
        itemSpecifics=$specifics
        compatibility=$usCompatibility
    }
    au=[ordered]@{
        categoryId='33545'
        storeCategoryNames=@('/Hyundai/Santa Fe','/Kia/Sorento','/Kia/Carnival')
        itemSpecifics=$specifics
        compatibility=$auCompatibility
    }
}

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
$manifestPath = Join-Path $packageRoot "$itemId.json"
Write-Json $manifestPath $manifest
Write-Json (Join-Path $packageRoot "$itemId-au-audit.json") ([pscustomobject]@{SantaFe=$santaFe.Count;Sorento=$sorento.Count;Carnival=$carnival.Count;Total=$auCompatibility.Count})
[pscustomobject]@{US=$usIdentity.username;AU=$auIdentity.username;Part=$part;Title=$title;TitleLength=$title.Length;Images=8;USCompatibility=$usCompatibility.Count;AUCompatibility=$auCompatibility.Count;Manifest=$manifestPath} | ConvertTo-Json -Depth 4
