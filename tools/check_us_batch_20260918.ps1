$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$source=Get-Content -Raw (Join-Path $PSScriptRoot 'publish_prepared_evening_20260917.ps1')
Invoke-Expression $source.Substring($source.IndexOf('function Read-Env'),$source.IndexOf('$envs = Read-Env')-$source.IndexOf('function Read-Env'))
$envs=Read-Env (Join-Path $root '.env.ebay.local'); $token=$envs['EBAY_US_ACCESS_TOKEN']
$who=Invoke-RestMethod 'https://apiz.ebay.com/commerce/identity/v1/user/' -Headers @{Authorization="Bearer $token"}
if($who.username-ne'gandakorea'){throw 'US identity mismatch'}
$all=@();$page=1
do {
 $body='<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>'+$page+'</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>'
 $response=Invoke-Trading $token 'GetMyeBaySelling' '100' $body;Assert-Trading $response 'US active inventory'
 $all+=@($response.GetMyeBaySellingResponse.ActiveList.ItemArray.Item)
 $pages=[int]$response.GetMyeBaySellingResponse.ActiveList.PaginationResult.TotalNumberOfPages;$page++
} while($page-le$pages)
$all|Where-Object{($_.OuterXml -replace '[- ]','')-match '836504H150|836604H150|551304D000|865763M500|54610C1000'}|ForEach-Object{[pscustomobject]@{id=[string]$_.ItemID;title=[string]$_.Title;sku=[string]$_.SKU}}|ConvertTo-Json
Write-Host "Checked seller $($who.username), $($all.Count) active listings across $pages pages"
