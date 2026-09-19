$ErrorActionPreference='Stop'
$date='2026-09-19'
$endpoint='https://korea-autoparts-listing-work.vercel.app/api/listing-work'
$response=Invoke-RestMethod "$endpoint`?date=$date"
if(-not$response.found){throw 'Landing batch not found'}
$root=Split-Path $PSScriptRoot -Parent
$resultRoot=Join-Path $root '작업중\등록결과\2026-09-19'
$parts=@{
 '4c757e5e-51d9-4f8b-a318-ca87f971967e'='86190-C5000'
 'ea9e48a7-6abf-4f15-91f3-560114f71cad'='86350-2K050'
 '187cceea-38af-48d5-b6f7-97bbb86f574f'='86350-2P000'
 '6d839441-3cbf-4b0e-bb5d-a9d06a957df6'='86350-S1000'
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
$completedIds=@($check.batch.groups|ForEach-Object{$_.items}|Where-Object{$_.preparationStatus-eq'completed'}|ForEach-Object{[string]$_.id})
$done=@($parts.Keys|Where-Object{$completedIds -contains [string]$_}).Count
if($done-ne4-or$check.batch.automationStatus-ne'completed'){throw "Landing completion verification failed: $done"}
[pscustomobject]@{saved=$saved.saved;completed=$done;automationStatus=$check.batch.automationStatus}|ConvertTo-Json
