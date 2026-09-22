$ErrorActionPreference='Stop'
$date='2026-09-22'
$endpoint='https://korea-autoparts-listing-work.vercel.app/api/listing-work'
$response=Invoke-RestMethod "$endpoint`?date=$date&t=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" -Headers @{'Cache-Control'='no-cache'}
if(-not$response.found){throw 'Landing batch not found'}
$root=Split-Path $PSScriptRoot -Parent
$resultRoot=Join-Path $root '작업중\등록결과\2026-09-22'
$parts=@{
 'fb6e4da6-ab60-4e66-9223-53ede0156572'='28140-C1510'
 '6894f612-a3e1-4bc8-a07b-e41661571e99'='81320-4H020'
 '93d2d2d0-aed8-440f-a36a-b5524b6e47a7'='86514-2T500'
 'c8c8fc63-662e-4778-80b8-e1c0c0546990'='87721-B8500GAL'
 '26f2fecb-6169-4a46-8f6c-468fc519cd58'='81260-3K001'
 'db2930f2-ec55-4825-8dc1-d256269c5b0f'='86310-A7000'
 'f5b6ea89-b245-44ff-a349-4ccdbe8b360b'='28113-L1000'
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
$done=0
for($attempt=1;$attempt-le5;$attempt++){
 $check=Invoke-RestMethod "$endpoint`?date=$date&t=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" -Headers @{'Cache-Control'='no-cache'}
 $completedIds=@($check.batch.groups|ForEach-Object{@($_.items)}|Where-Object{$_.preparationStatus-eq'completed'}|ForEach-Object{[string]$_.id})
 $done=@($parts.GetEnumerator()|Where-Object{$completedIds -contains [string]$_.Key}).Count
 if($done-eq7-and$check.batch.automationStatus-eq'completed'){break}
 Start-Sleep -Seconds 2
}
if($done-ne7-or$check.batch.automationStatus-ne'completed'){throw "Landing completion verification failed: $done"}
[pscustomobject]@{saved=$saved.saved;completed=$done;automationStatus=$check.batch.automationStatus}|ConvertTo-Json
