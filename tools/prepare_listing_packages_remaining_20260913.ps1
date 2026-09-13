param([string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$date = '2026-09-13'
$packageRoot = Join-Path $root "작업중\패키지\$date"

function Read-Env($path) { $v=@{}; gc -LiteralPath $path | % { if($_ -match '^([^#=]+)=(.*)$'){$v[$matches[1].Trim()]=$matches[2].Trim()} }; $v }
function Write-Json($path,$value) { [IO.File]::WriteAllText($path,($value|ConvertTo-Json -Depth 80),[Text.UTF8Encoding]::new($false)) }
function Get-UsRows($item) { @($item.ItemCompatibilityList.Compatibility | % { $row=[ordered]@{}; foreach($e in $_.NameValueList){$n=[string]$e.Name;if($n){$row[$n]=[string]$e.Value}};[pscustomobject]$row }) }
function Get-Specifics($item,$compact) { $r=[ordered]@{};foreach($e in @($item.ItemSpecifics.NameValueList)){$n=[string]$e.Name;if($n -and $n -notmatch '(?i)California Prop'){$r[$n]=@($e.Value|%{[string]$_})}};$r['Brand']=@('Genuine Hyundai Mobis');$r['Manufacturer Part Number']=@($compact);$r['Country of Origin']=@('Korea, Republic of');$r }
function Get-AuRows($token,$target,$category) {
  $body=@{categoryId=$category;propertyFilters=@(@{propertyName='Make';propertyValue=$target.make},@{propertyName='Model';propertyValue=$target.model});propertyNames=@('Year','Make','Model','Submodel','Variant','Engine')}
  $headers=@{Authorization="Bearer $token";'X-EBAY-C-MARKETPLACE-ID'='EBAY_AU';'Content-Language'='en-AU';Accept='application/json'}
  try{$response=irm 'https://api.ebay.com/sell/metadata/v1/compatibilities/get_multi_compatibility_property_values' -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($body|ConvertTo-Json -Depth 10 -Compress)))}catch{return @()}
  @($response.compatibilities|%{$row=[ordered]@{};foreach($d in $_.compatibilityDetails){$row[[string]$d.propertyName]=[string]$d.propertyValue};[pscustomobject]$row}|?{[int]$_.Year-ge$target.minYear-and[int]$_.Year-le$target.maxYear-and(-not$target.engine-or$_.Engine-match$target.engine)})
}

$products=@(
 [pscustomobject]@{id='db37ee36-51fb-49ad-946c-a21f497dee3b';reference='236566809399';part='26350-3C701';compact='263503C701';usd='49.41';category='14769';title='⭐Genuine 263503C701 Oil Filter Cap For Hyundai Genesis Coupe 3.8L 2010-2016';type='Oil Filter Cap';stores=@('14073369012');auStores=@('/Hyundai/Genesis Coupe');targets=@()},
 [pscustomobject]@{id='ae3ea033-b27c-4c80-bbd6-8ffa4e1a50a0';reference='334287677322';part='26510-26600';compact='2651026600';usd='35.25';category='33661';title='⭐Genuine Oil Filter Cap For Hyundai Accent Elantra Sonata Tiburon 99-08';type='Engine Oil Filler Cap';stores=@('13135350012','13146860012');auStores=@('/Hyundai/Accent','/Hyundai/Elantra');targets=@(
   @{make='Hyundai';model='Accent';minYear=1999;maxYear=2006;engine='(?i)Petrol'},@{make='Hyundai';model='Elantra';minYear=2000;maxYear=2006;engine='(?i)Petrol'},@{make='Hyundai';model='Sonata';minYear=2006;maxYear=2006;engine='(?i)Petrol'},@{make='Hyundai';model='Tiburon';minYear=2001;maxYear=2008;engine='(?i)Petrol'},@{make='Kia';model='Cerato';minYear=2004;maxYear=2009;engine='(?i)Petrol'})},
 [pscustomobject]@{id='d5f2716d-c183-42ca-abcf-ccc62edeeacb';reference='333879262740';part='31010-3X000';compact='310103X000';usd='41.47';category='262072';title='⭐Genuine Fuel Filler Cap For Hyundai Elantra Veloster Kia Forte Sportage 10-19';type='Fuel Filler Cap';stores=@('13146860012','13180807012');auStores=@('/Hyundai/Elantra','/Kia/Sportage');targets=@(
   @{make='Hyundai';model='Accent';minYear=2012;maxYear=2018;engine='(?i)Petrol'},@{make='Hyundai';model='Elantra';minYear=2011;maxYear=2019;engine='(?i)Petrol'},@{make='Hyundai';model='ix35';minYear=2015;maxYear=2015;engine='(?i)Petrol'},@{make='Hyundai';model='Veloster';minYear=2012;maxYear=2019;engine='(?i)Petrol'},@{make='Kia';model='Cerato';minYear=2010;maxYear=2019;engine='(?i)Petrol'},@{make='Kia';model='Rio';minYear=2012;maxYear=2018;engine='(?i)Petrol'},@{make='Kia';model='Sportage';minYear=2010;maxYear=2018;engine='(?i)Petrol'})},
 [pscustomobject]@{id='0fc596fe-a757-4fed-a386-63babf92a267';reference='236956871194';part='31111-1G500';compact='311111G500';usd='162.35';category='33555';title='⭐Genuine 311111G500 Fuel Pump For Hyundai Accent Elantra Santa Fe Tucson 01-14';type='Electric Fuel Pump';stores=@('13135350012','13146860012');auStores=@('/Hyundai/Accent','/Hyundai/Elantra');targets=@(
   @{make='Hyundai';model='Accent';minYear=2003;maxYear=2014;engine='(?i)Petrol'},@{make='Hyundai';model='Elantra';minYear=2001;maxYear=2006;engine='(?i)Petrol'},@{make='Hyundai';model='Santa Fe';minYear=2001;maxYear=2006;engine='(?i)Petrol'},@{make='Hyundai';model='Tiburon';minYear=2003;maxYear=2008;engine='(?i)Petrol'},@{make='Hyundai';model='Tucson';minYear=2005;maxYear=2009;engine='(?i)Petrol'},@{make='Kia';model='Magentis';minYear=2001;maxYear=2011;engine='(?i)Petrol'},@{make='Kia';model='Rio';minYear=2006;maxYear=2011;engine='(?i)Petrol'},@{make='Kia';model='Cerato';minYear=2004;maxYear=2006;engine='(?i)Petrol'},@{make='Kia';model='Sportage';minYear=2005;maxYear=2010;engine='(?i)Petrol'})}
)

$envs=Read-Env $EnvironmentFile
$usIdentity=irm 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $($envs['EBAY_US_ACCESS_TOKEN'])"}
$auIdentity=irm 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $($envs['EBAY_AU_USER_TOKEN'])"}
if($usIdentity.username-ne'gandakorea'-or$usIdentity.registrationMarketplaceId-ne'EBAY_US'){throw'US account mismatch'}
if($auIdentity.username-ne'sihooshop'-or$auIdentity.registrationMarketplaceId-ne'EBAY_AU'){throw'AU account mismatch'}
[xml]$templateXml=gc -Raw -LiteralPath (Join-Path $root '작업중\ebay-336779935333\item.xml');$template=$templateXml.GetItemResponse.Item
New-Item -ItemType Directory -Force -Path $packageRoot|Out-Null
$summary=@()
foreach($p in $products){
 [xml]$sourceXml=gc -Raw -LiteralPath (Join-Path $root "작업중\ebay-$($p.reference)\item.xml");$source=$sourceXml.GetItemResponse.Item
 if($p.title.Length-gt80-or-not$p.title.StartsWith('⭐Genuine ')){throw"Title invalid: $($p.part)"}
 $oe=@($source.ItemSpecifics.NameValueList | Where-Object Name -eq 'OE/OEM Part Number' | ForEach-Object { $_.Value }) -join ' '
 if($oe.Replace('-','')-notmatch[regex]::Escape($p.compact)){throw"Part mismatch: $($p.part) / $oe"}
 $description=([string]$template.Description).Replace([string]$template.Title,$p.title)
 $description=([regex]'⭐Genuine[^<]+').Replace($description,$p.title,1)
 foreach($old in @('437112M1009P','43711-2M1009P','43711 2M1009P')){$description=$description.Replace($old,$p.compact)}
 $description=[regex]::Replace($description,'(?i)leather 6 speed MT gear shift knob lever',[string]$p.type)
 $description=$description.Replace('This part fits Hyundai Genesis Coupe 2009-2017.','This part fits the vehicles listed in the compatibility table.')
 if($description-match'(?i)43711[- ]?2M1009P|leather 6 speed|gear shift knob'){throw"Old text remains: $($p.part)"}
 $usRows=@(Get-UsRows $source);$auRows=@();foreach($target in $p.targets){$auRows+=@(Get-AuRows $envs['EBAY_AU_USER_TOKEN'] $target $p.category)};$auRows=@($auRows|Sort-Object Year,Make,Model,Submodel,Variant,Engine -Unique)
 $manifest=[ordered]@{version=1;date=$date;itemId=$p.id;referenceItemNumber=$p.reference;partNumber=$p.part;usdPrice=$p.usd;shippingPolicy='7day normal';title=$p.title;descriptionHtml=$description;type=$p.type;images=@();preparedAt='';us=[ordered]@{categoryId=$p.category;storeCategoryIds=@($p.stores);itemSpecifics=(Get-Specifics $source $p.compact);compatibility=$usRows};au=[ordered]@{categoryId=$p.category;storeCategoryNames=@($p.auStores);itemSpecifics=(Get-Specifics $source $p.compact);compatibility=$auRows}}
 Write-Json (Join-Path $packageRoot "$($p.id).json") $manifest
 $summary+=[pscustomobject]@{part=$p.part;titleLength=$p.title.Length;US=$usRows.Count;AU=$auRows.Count;images=@(gci -LiteralPath (Join-Path $root "완성본\$($p.part)") -Filter '*.png').Count}
}
$summary|ConvertTo-Json -Depth 5
