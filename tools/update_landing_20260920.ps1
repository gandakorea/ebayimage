$ErrorActionPreference='Stop'
$date='2026-09-20'
$endpoint='https://korea-autoparts-listing-work.vercel.app/api/listing-work'
$response=Invoke-RestMethod "$endpoint`?date=$date"
if(-not$response.found){throw 'Landing batch not found'}
$root=Split-Path $PSScriptRoot -Parent
$resultRoot=Join-Path $root '작업중\등록결과\2026-09-20'
$parts=@{
 '7de01e36-5fb8-417f-aece-dc898ebd7017'='86351-3M500'
 '44ec7d82-ee62-437c-ae9c-753c10bd90f3'='86370-Q5010'
 '54234f08-bcd6-4c4e-9dc5-0138dfa26c50'='86560-2V000'
 '0e62b923-d684-499a-88c9-8cd8ed86a88f'='86564-F2AA0'
 'cf703b48-9ff5-4447-9f01-20e333fb8a05'='86588-2T500'
 '4bc2090a-7ba4-40a5-9cb9-589932ab18cd'='87772-D4000'
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
$done=@($parts.GetEnumerator()|Where-Object{$completedIds -contains [string]$_.Key}).Count
if($done-ne6-or$check.batch.automationStatus-ne'completed'){throw "Landing completion verification failed: $done"}
[pscustomobject]@{saved=$saved.saved;completed=$done;automationStatus=$check.batch.automationStatus}|ConvertTo-Json
