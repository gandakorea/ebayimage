param([switch]$PrepareAu,[string]$EnvironmentFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.ebay.local'))

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$date = '2026-09-17'
$packageRoot = Join-Path $projectRoot "작업중\패키지\2026-09-17-evening"

function Read-EnvironmentFile([string]$Path) { $v=@{}; Get-Content -LiteralPath $Path | ForEach-Object { if($_ -match '^([^#=]+)=(.*)$'){$v[$matches[1].Trim()]=$matches[2].Trim().Trim('"')} }; $v }
function Write-JsonFile([string]$Path,$Value) { [IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 80),[Text.UTF8Encoding]::new($false)) }
function Get-ItemSpecifics($Item,$Product) {
  $r=[ordered]@{}
  foreach($e in @($Item.ItemSpecifics.NameValueList)) { $n=[string]$e.Name; if($n -and $n -notmatch '(?i)California Prop|Country.*(Origin|Manufacture)'){$r[$n]=@($e.Value|ForEach-Object{[string]$_}|Where-Object{$_})} }
  $r['Brand']=@('Genuine Hyundai Mobis'); $r['Manufacturer Part Number']=@($Product.compactPart); $r['OE/OEM Part Number']=@($Product.compactPart)
  $r['Country of Origin']=@('Korea, Republic of')
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
$usIdentity=Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $usToken"}
if($usIdentity.username-ne'gandakorea'){throw 'US identity mismatch'}
if($PrepareAu){$auIdentity=Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $script:auToken"};if($auIdentity.username-ne'sihooshop'){throw 'AU identity mismatch'}}
$products=@(
 [pscustomobject]@{itemId='de5593cb-65c0-43a4-8484-0fd4866cc1e8';reference='336603888477';part='81230-1H000';compactPart='812301H000';categoryId='33648';usd='81.18';shipping='7day normal';title='⭐Genuine 812301H000 Trunk Tailgate Lock Latch For Kia Sorento 2011-2013';partWords='trunk tailgate lock latch';usStores=@('13179345012');auStores=@('/Kia/Sorento');auTargets=@(@{make='Kia';model='Sorento';minYear=2011;maxYear=2013;enginePattern='(?i)(2\.4L|3\.5L|2359cc|3470cc).*Petrol'})},
 [pscustomobject]@{itemId='ad11c91c-f9f1-45c4-b906-beac9a13709d';reference='324716951233';part='81310-3L021';compactPart='813103L021';categoryId='33648';usd='175.29';shipping='7day fast';title='⭐Genuine Door Lock Actuator Front Left For Hyundai Azera 2006-2011 Lhd';partWords='front left door lock actuator for left-hand-drive vehicles only';usStores=@('12974090012');auStores=@('/Hyundai/Azera');auTargets=@()}
)

[xml]$tx=Get-Content -Raw -LiteralPath (Join-Path $projectRoot '작업중\ebay-336779935333\item.xml')
$template=[pscustomobject]@{Title='⭐Genuine 437112M1009P Leather 6 Speed MT Gear Shift Knob Lever For Hyundai Genesis Coupe 09-17';Description=[string]$tx.GetItemResponse.Item.Description}
New-Item -ItemType Directory -Force -Path $packageRoot|Out-Null;$summary=@()
foreach($p in $products){
 [xml]$sx=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "작업중\ebay-$($p.reference)\item.xml");$source=$sx.GetItemResponse.Item
 if(-not$p.title.StartsWith('⭐Genuine ')-or$p.title.Length-gt80){throw "Invalid title: $($p.title)"}
 $us=@(Get-UsCompatibility $source);if(-not$us.Count){throw "No US compatibility: $($p.part)"};$au=[pscustomobject]@{rows=@();audit=@()};if($PrepareAu -and $p.auTargets.Count){$au=Select-AuCompatibility $p;if(-not$au.rows.Count){throw "No AU compatibility: $($p.part)"}};if($p.part-eq'81230-1H000'){$us=@($us|Where-Object{$_.Model-eq'Sorento'-and[int]$_.Year-ge2011-and[int]$_.Year-le2013})}
 $specifics=Get-ItemSpecifics $source $p;$desc=New-Description ([string]$template.Description) ([string]$template.Title) $p
 if($p.part-eq'81310-3L021'){$specifics['Placement on Vehicle']=@('Front','Left');$specifics['Drive Type']=@('Left Hand Drive');$desc='<p style="font-family:Arial;font-size:18px"><b>Left-hand-drive vehicles only. Front left door. Not for right-hand-drive vehicles. Verify 81310-3L021 by VIN before ordering.</b></p>'+$desc}

 $m=[ordered]@{version=1;date=$date;itemId=$p.itemId;referenceItemNumber=$p.reference;partNumber=$p.part;manufacturerPartNumber=$p.compactPart;usdPrice=$p.usd;shippingPolicy=$p.shipping;title=$p.title;descriptionHtml=$desc;type=$p.partWords;images=@();preparedAt=[DateTime]::UtcNow.ToString('o');us=[ordered]@{categoryId=$p.categoryId;storeCategoryIds=@($p.usStores);itemSpecifics=$specifics;compatibility=$us};au=[ordered]@{categoryId=$p.categoryId;storeCategoryNames=@($p.auStores);itemSpecifics=$specifics;compatibility=@($au.rows)}}
 Write-JsonFile (Join-Path $packageRoot "$($p.itemId).json") $m;Write-JsonFile (Join-Path $packageRoot "$($p.itemId)-au-audit.json") $au.audit
 $summary+=[pscustomobject]@{part=$p.part;title=$p.title;titleLength=$p.title.Length;US=$us.Count;AU=@($au.rows).Count;images=@(Get-ChildItem -LiteralPath (Join-Path $projectRoot "완성본\$($p.part)") -Filter '*.png').Count;shipping=$p.shipping}
}
[pscustomobject]@{usIdentity=$usIdentity.username;auIdentity=$auIdentity.username;packages=$summary}|ConvertTo-Json -Depth 8
