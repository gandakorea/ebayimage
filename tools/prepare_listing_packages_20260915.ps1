param([string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'))

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$date = '2026-09-15'
$packageRoot = Join-Path $projectRoot "작업중\패키지\$date"

function Read-EnvironmentFile([string]$Path) { $v=@{}; Get-Content -LiteralPath $Path | ForEach-Object { if($_ -match '^([^#=]+)=(.*)$'){$v[$matches[1].Trim()]=$matches[2].Trim().Trim('"')} }; $v }
function Write-JsonFile([string]$Path,$Value) { [IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 80),[Text.UTF8Encoding]::new($false)) }
function Get-ItemSpecifics($Item,$Product) {
  $r=[ordered]@{}
  foreach($e in @($Item.ItemSpecifics.NameValueList)) { $n=[string]$e.Name; if($n -and $n -notmatch '(?i)California Prop|Country.*(Origin|Manufacture)'){$r[$n]=@($e.Value|ForEach-Object{[string]$_}|Where-Object{$_})} }
  $r['Brand']=@('Genuine Hyundai Mobis'); $r['Manufacturer Part Number']=@($Product.compactPart); $r['OE/OEM Part Number']=@($Product.compactPart)
  if(-not [string]::IsNullOrWhiteSpace([string]$Product.countryOrigin)){$r['Country of Origin']=@([string]$Product.countryOrigin)}
  $r
}
function Get-UsCompatibility($Item) { @($Item.ItemCompatibilityList.Compatibility | ForEach-Object { $o=[ordered]@{}; foreach($e in $_.NameValueList){$n=[string]$e.Name;$v=[string]$e.Value;if($n -and $v){$o[$n]=$v}}; if($o.Count){[pscustomobject]$o} }) }
function Invoke-AuJson([string]$Uri,[string]$Method,$Body=$null) { $h=@{Authorization="Bearer $script:auToken";'X-EBAY-C-MARKETPLACE-ID'='EBAY_AU';'Content-Language'='en-AU';Accept='application/json'}; $p=@{Uri=$Uri;Method=$Method;Headers=$h}; if($null-ne$Body){$p.ContentType='application/json';$p.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 30 -Compress))}; Invoke-RestMethod @p }
function Get-AuCatalogRows([string]$CategoryId,[string]$Make,[string]$Model) { $b=@{categoryId=$CategoryId;propertyFilters=@(@{propertyName='Make';propertyValue=$Make},@{propertyName='Model';propertyValue=$Model});propertyNames=@('Year','Make','Model','Submodel','Variant','Engine')}; $z=Invoke-AuJson 'https://api.ebay.com/sell/metadata/v1/compatibilities/get_multi_compatibility_property_values' 'POST' $b; @($z.compatibilities|ForEach-Object{$o=[ordered]@{};foreach($d in $_.compatibilityDetails){if($d.propertyValue){$o[[string]$d.propertyName]=[string]$d.propertyValue}};if($o.Count){[pscustomobject]$o}}) }
function Select-AuCompatibility($Product) { $all=@();$audit=@();foreach($t in $Product.auTargets){try{$rows=@(Get-AuCatalogRows $Product.categoryId $t.make $t.model)}catch{$audit+=[pscustomobject]@{make=$t.make;model=$t.model;catalog=0;selected=0;error=$_.Exception.Message};continue};$m=@($rows|Where-Object{$y=0;$ok=[int]::TryParse([string]$_.Year,[ref]$y)-and$y-ge$t.minYear-and$y-le$t.maxYear;$txt="$($_.Variant) $($_.Engine)";$ok-and([string]::IsNullOrWhiteSpace([string]$t.enginePattern)-or$txt-match$t.enginePattern)});$all+=$m;$audit+=[pscustomobject]@{make=$t.make;model=$t.model;catalog=$rows.Count;selected=$m.Count}};[pscustomobject]@{rows=@($all|Sort-Object Year,Make,Model,Submodel,Variant,Engine -Unique);audit=$audit} }
function New-Description([string]$Template,[string]$TemplateTitle,$Product) {
  $v=$Template.Replace($TemplateTitle,$Product.title)
  $v=[regex]::Replace($v,'(?is)<p style="font-family: Arial;"><font face="Arial">Your vehicle deserves.*?</p>','<p style="font-family: Arial;"><font face="Arial">This genuine '+$Product.partWords+' fits the vehicles listed in the compatibility table. Please verify the part number by VIN before purchase.</font></p>',1)
  foreach($old in @('437112M1009P','43711-2M1009P','43711 2M1009P')){$v=$v.Replace($old,$Product.compactPart)}
  $v=$v.Replace('leather 6 speed MT gear shift knob lever',$Product.partWords).Replace('Leather 6 Speed MT Gear Shift Knob Lever',$Product.partWords)
  if(-not $v.Contains([string]$Product.title)){throw "Description title missing: $($Product.part)"}
  if($v.Contains($TemplateTitle)-or$v-match'(?i)43711[- ]?2M1009P|leather 6 speed|gear shift knob|935703s000ry|This part fits Hyundai Sonata'){throw "Old template text remains: $($Product.part)"}
  $v
}

$settings=Read-EnvironmentFile $EnvironmentFile; $script:auToken=$settings['EBAY_AU_USER_TOKEN'];$usToken=$settings['EBAY_US_ACCESS_TOKEN']
$usIdentity=Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $usToken"};$auIdentity=Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $script:auToken"}
if($usIdentity.username-ne'gandakorea'-or$usIdentity.registrationMarketplaceId-ne'EBAY_US'){throw'US identity mismatch'};if($auIdentity.username-ne'sihooshop'-or$auIdentity.registrationMarketplaceId-ne'EBAY_AU'){throw'AU identity mismatch'}

$petrol='(?i)(Petrol|Gas)'; $petrolHybrid='(?i)(Petrol|Gas|Hybrid|Electric|EV|Fuel Cell)'
$products=@(
 [pscustomobject]@{itemId='6a408d73-0acb-43c2-8f29-af7258449994';reference='331019795346';part='51750-3A003';compactPart='517503A003';categoryId='170141';usd='187.06';shipping='7day fast';title='⭐Genuine 517503A003 Front Wheel Hub For Hyundai Santa Fe Tucson 2001-2009';partWords='front wheel hub';countryOrigin='Korea, Republic of';usStores=@('13010908012','13180602012');auStores=@('/Hyundai/Santa Fe','/Hyundai/Tucson');auTargets=@(
   @{make='Hyundai';model='Santa Fe';minYear=2001;maxYear=2006;enginePattern=$petrol},@{make='Hyundai';model='Tucson';minYear=2005;maxYear=2009;enginePattern=$petrol},@{make='Kia';model='Sportage';minYear=2005;maxYear=2009;enginePattern=$petrol})},
 [pscustomobject]@{itemId='da88c466-d4a6-41e0-9c47-ce25dfc26204';reference='327018883351';part='52750-C5000';compactPart='52750C5000';categoryId='170141';usd='315.29';shipping='7day fast';title='⭐Genuine 52750C5000 Rear Wheel Hub Bearing For Kia Sorento FWD 2016-2020';partWords='rear wheel hub and bearing';countryOrigin='Korea, Republic of';usStores=@('13179345012');auStores=@('/Kia/Sorento');auTargets=@(
   @{make='Kia';model='Sorento';minYear=2016;maxYear=2020;enginePattern='(?i)(Petrol|Diesel).*(2WD|FWD)|(2WD|FWD).*(Petrol|Diesel)'})},
 [pscustomobject]@{itemId='3b09542f-9e18-4a14-bcf3-d9898bad9da4';reference='333334811517';part='52933-C1100';compactPart='52933C1100';categoryId='179696';usd='78.82';shipping='7day normal';title='⭐Genuine 52933C1100 TPMS Sensor For Hyundai Santa Fe Tucson 2015-2024';partWords='tire pressure monitoring sensor';countryOrigin='';usStores=@('13010908012','13180602012');auStores=@('/Hyundai/Santa Fe','/Hyundai/Tucson');auTargets=@(
   @{make='Hyundai';model='Nexo';minYear=2019;maxYear=2024;enginePattern=''},@{make='Hyundai';model='Palisade';minYear=2020;maxYear=2024;enginePattern=''},@{make='Hyundai';model='Santa Fe';minYear=2019;maxYear=2023;enginePattern=''},@{make='Hyundai';model='Sonata';minYear=2015;maxYear=2019;enginePattern=''},@{make='Hyundai';model='Tucson';minYear=2016;maxYear=2021;enginePattern=''},@{make='Kia';model='Carnival';minYear=2019;maxYear=2021;enginePattern=''})},
 [pscustomobject]@{itemId='9fa5108c-d486-47c9-893f-c04fe4b01416';reference='324749614448';part='52960-B8200';compactPart='52960B8200';categoryId='43961';usd='40.61';shipping='7day normal';title='⭐Genuine 52960B8200 Wheel Hub Center Cap Gray For Hyundai Santa Fe XL 2017-2019';partWords='wheel hub center cap';countryOrigin='Korea, Republic of';usStores=@('13010908012','45562724012');auStores=@('/Hyundai/Santa Fe','/Hyundai/Santa Fe XL');auTargets=@(
   @{make='Hyundai';model='Santa Fe';minYear=2017;maxYear=2019;enginePattern='(?i)(3342cc|3.3L).*Petrol'})}
)

$templatePage=[IO.File]::ReadAllText((Join-Path $projectRoot '작업중\template-description.html'),[Text.UTF8Encoding]::new($false))
$descriptionStart=$templatePage.IndexOf('<p style="font-size: large; font-family: Arial;">')
$hydrationStart=$templatePage.IndexOf('<script nonce',$descriptionStart)
$descriptionEnd=$templatePage.LastIndexOf('</div>',$hydrationStart)
if($descriptionStart-lt0-or$descriptionEnd-le$descriptionStart){throw 'Seller description extraction failed.'}
$template=[pscustomobject]@{Title='⭐Genuine 437112M1009P Leather 6 Speed MT Gear Shift Knob Lever For Hyundai Genesis Coupe 09-17';Description=$templatePage.Substring($descriptionStart,$descriptionEnd-$descriptionStart)}
New-Item -ItemType Directory -Force -Path $packageRoot|Out-Null;$summary=@()
foreach($p in $products){
 [xml]$sx=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "작업중\ebay-$($p.reference)\item.xml");$source=$sx.GetItemResponse.Item
 if(-not$p.title.StartsWith('⭐Genuine ')-or$p.title.Length-gt80){throw "Invalid title: $($p.title)"}
 $us=@(Get-UsCompatibility $source);if(-not$us.Count){throw "No US compatibility: $($p.part)"};$au=Select-AuCompatibility $p;if(-not$au.rows.Count){throw "No AU compatibility: $($p.part)"}
 $specifics=Get-ItemSpecifics $source $p;$desc=New-Description ([string]$template.Description) ([string]$template.Title) $p
 $m=[ordered]@{version=1;date=$date;itemId=$p.itemId;referenceItemNumber=$p.reference;partNumber=$p.part;usdPrice=$p.usd;shippingPolicy=$p.shipping;title=$p.title;descriptionHtml=$desc;type=$p.partWords;images=@();preparedAt=[DateTime]::UtcNow.ToString('o');us=[ordered]@{categoryId=$p.categoryId;storeCategoryIds=@($p.usStores);itemSpecifics=$specifics;compatibility=$us};au=[ordered]@{categoryId=$p.categoryId;storeCategoryNames=@($p.auStores);itemSpecifics=$specifics;compatibility=@($au.rows)}}
 Write-JsonFile (Join-Path $packageRoot "$($p.itemId).json") $m;Write-JsonFile (Join-Path $packageRoot "$($p.itemId)-au-audit.json") $au.audit
 $summary+=[pscustomobject]@{part=$p.part;titleLength=$p.title.Length;US=$us.Count;AU=@($au.rows).Count;images=@(Get-ChildItem -LiteralPath (Join-Path $projectRoot "완성본\$($p.part)") -Filter '*.png').Count;shipping=$p.shipping}
}
[pscustomobject]@{usIdentity=$usIdentity.username;auIdentity=$auIdentity.username;packages=$summary}|ConvertTo-Json -Depth 8
