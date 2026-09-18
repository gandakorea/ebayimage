$ErrorActionPreference='Stop'
$source=Get-Content -Raw (Join-Path $PSScriptRoot 'publish_prepared_20260918.ps1')
$helper=$source.Substring($source.IndexOf('$ErrorActionPreference'),$source.IndexOf('$envs =')-$source.IndexOf('$ErrorActionPreference'))
$helper=$helper.Replace('$projectRoot = Split-Path $PSScriptRoot -Parent', '$projectRoot = (Get-Location).Path')
Invoke-Expression $helper
$envs=Read-Env (Join-Path $projectRoot '.env.ebay.local')
$token=$envs['EBAY_US_ACCESS_TOKEN']
$identity=Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $token"}
if($identity.username -ne 'gandakorea'){throw 'US seller mismatch'}
$path=Join-Path $packageRoot '013e8dcc-7ed8-428d-86c9-323f53872439.json'
$p=Get-Content -Raw $path | ConvertFrom-Json
$p.us.itemSpecifics.'Manufacturer Part Number'=@('836504H150, 836604H150')
$p.us.itemSpecifics.'OE/OEM Part Number'=@('836504H150, 836604H150')
$p.descriptionHtml=$p.descriptionHtml.Replace('This genuine rear sliding door outside handle left and right pair fits the vehicles listed in the compatibility table. Please verify the part number by VIN before purchase.','Genuine rear sliding door outside handle left and right pair for Hyundai H1 2007-2015. Please verify both OEM part numbers 836504H150 and 836604H150 by VIN before purchase.')
$before=Get-PublicItem $token '100' '336799835478'
if($before.GetItemResponse.Item.Seller.UserID -ne 'gandakorea'){throw 'Listing seller mismatch'}
$body='<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item><ItemID>336799835478</ItemID><ItemSpecifics>'+(Specifics-Xml $p.us.itemSpecifics)+'</ItemSpecifics><Description>'+(Xml $p.descriptionHtml)+'</Description></Item></ReviseFixedPriceItemRequest>'
$body='<?xml version="1.0" encoding="utf-8"?>'+$body
[xml]$checkedXml=$body
$result=Invoke-Trading $token 'ReviseFixedPriceItem' '100' $body
Assert-Trading $result 'Revise handle specifics'
$after=Get-PublicItem $token '100' '336799835478'
$spec=$after.GetItemResponse.Item.ItemSpecifics.NameValueList
foreach($name in @('Manufacturer Part Number','OE/OEM Part Number')){
 $value=($spec | Where-Object Name -eq $name).Value -join ', '
 if($value -notmatch '836504H150' -or $value -notmatch '836604H150'){throw "Missing pair: $name"}
}
$placement=($spec | Where-Object Name -eq 'Placement on Vehicle').Value -join ', '
if($placement -notmatch 'Left' -or $placement -notmatch 'Right'){throw 'Missing placement'}
Write-Json $path $p
$after.Save((Join-Path $resultRoot '83650-4H150_83660-4H150-US.xml'))
[pscustomobject]@{listing='336799835478';seller=$identity.username;ack=[string]$result.DocumentElement.Ack;placement=$placement;verified=$true}|ConvertTo-Json
