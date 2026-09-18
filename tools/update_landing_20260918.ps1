$ErrorActionPreference='Stop'
$date='2026-09-18'
$endpoint='https://korea-autoparts-listing-work.vercel.app/api/listing-work'
$response=Invoke-RestMethod "$endpoint`?date=$date"
if(-not$response.found){throw 'Landing batch not found'}
$resultRoot=Join-Path (Split-Path $PSScriptRoot -Parent) '작업중\등록결과\2026-09-18'
$parts=@{
 '013e8dcc-7ed8-428d-86c9-323f53872439'='83650-4H150_83660-4H150'
 'e79fdc95-a2e6-4d87-8945-7872da088466'='55130-4D000'
 'db235697-02cd-4560-9592-122d138bf58c'='86576-3M500'
 '5c4c87aa-56c9-4c2d-9677-783627f4bb32'='54610-C1000'
}
$now=[DateTime]::UtcNow.ToString('o')
foreach($group in $response.batch.groups){
 foreach($item in $group.items){
  if(-not$parts.ContainsKey([string]$item.id)){continue}
  $part=$parts[[string]$item.id]
  $us=Get-Content -Raw (Join-Path $resultRoot "$part-US.json")|ConvertFrom-Json
  $au=Get-Content -Raw (Join-Path $resultRoot "$part-AU.json")|ConvertFrom-Json
  $photos=@(Get-ChildItem -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) "완성본\$part") -File -Filter '*.png').Count
  $fields=@{
   preparationStatus='completed';partNumber=$part;photoCount=$photos;statusUpdatedAt=$now
   usResult=[pscustomobject]@{status='completed';listingId=[string]$us.listingId;listingUrl=[string]$us.url;checkedAt=$now}
   auResult=[pscustomobject]@{status='completed';listingId=[string]$au.listingId;listingUrl=[string]$au.url;checkedAt=$now}
  }
  foreach($field in $fields.GetEnumerator()){$item|Add-Member -NotePropertyName $field.Key -NotePropertyValue $field.Value -Force}
 }
}
$response.batch|Add-Member -NotePropertyName automationStatus -NotePropertyValue 'completed' -Force
$body=$response.batch|ConvertTo-Json -Depth 50 -Compress
$saved=Invoke-RestMethod $endpoint -Method Put -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body))
$check=Invoke-RestMethod "$endpoint`?date=$date"
$done=@($check.batch.groups.items|Where-Object{$_.itemNumber -and $_.preparationStatus-eq'completed'}).Count
if($done-ne4-or$check.batch.automationStatus-ne'completed'){throw 'Landing completion verification failed'}
[pscustomobject]@{saved=$saved.saved;completed=$done;automationStatus=$check.batch.automationStatus}|ConvertTo-Json
