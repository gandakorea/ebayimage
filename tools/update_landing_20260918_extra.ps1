$ErrorActionPreference='Stop'
$date='2026-09-18'
$endpoint='https://korea-autoparts-listing-work.vercel.app/api/listing-work'
$response=Invoke-RestMethod "$endpoint`?date=$date"
if(-not$response.found){throw 'Landing batch not found'}
$root=Split-Path $PSScriptRoot -Parent
$resultRoot=Join-Path $root '작업중\등록결과\2026-09-18-extra'
$parts=@{
 '724dfa04-fa93-4937-82f5-0eef732565d3'='83450-2S000'
 '7885227e-b998-41c4-9302-40fbed1ba2fd'='86190-C1000'
}
$now=[DateTime]::UtcNow.ToString('o')
foreach($group in $response.batch.groups){
 foreach($item in $group.items){
  if(-not$parts.ContainsKey([string]$item.id)){continue}
  $part=$parts[[string]$item.id]
  $us=Get-Content -Raw (Join-Path $resultRoot "$part-US.json")|ConvertFrom-Json
  $au=Get-Content -Raw (Join-Path $resultRoot "$part-AU.json")|ConvertFrom-Json
  $photos=@(Get-ChildItem -LiteralPath (Join-Path $root "완성본\$part") -File -Filter '*.png').Count
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
$done=@($check.batch.groups|ForEach-Object{$_.items}|Where-Object{$_.itemNumber -and $_.preparationStatus-eq'completed'}).Count
if($done-lt6-or$check.batch.automationStatus-ne'completed'){throw "Landing completion verification failed: $done"}
[pscustomobject]@{saved=$saved.saved;completed=$done;automationStatus=$check.batch.automationStatus}|ConvertTo-Json
