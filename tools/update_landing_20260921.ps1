$ErrorActionPreference='Stop'
$date='2026-09-21'
$endpoint='https://korea-autoparts-listing-work.vercel.app/api/listing-work'
$response=Invoke-RestMethod "$endpoint`?date=$date"
if(-not$response.found){throw 'Landing batch not found'}
$root=Split-Path $PSScriptRoot -Parent
$resultRoot=Join-Path $root '작업중\등록결과\2026-09-21'
$parts=@{
 '8f0b9767-c894-4a74-b823-721729b0d4b7'='86681-B2000'
 '5d91ceb0-7d74-4488-9767-01e96bafb3ac'='86682-B2000'
 '5729bdf5-d727-41e6-8c2a-f526f610a31d'='98630-YY000'
 '24772948-37ca-4b2f-8768-cd3020374c61'='92161-3K000'
 'db70222b-fd1e-46ba-a979-90f64f4405b1'='96985-2D700'
 'ad5ab372-6180-4dfc-96ed-e6dd34bce3f3'='98811-2K001'
 '188df84b-c988-48eb-81de-76f1395f14ed'='97235-3K100'
 'aa77b08c-8751-4a8e-a506-380c28b7d350'='97235-3SAA0'
 'be36f79f-9243-492c-899a-ee315357624b'='98811-3J000'
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
 $check=Invoke-RestMethod "$endpoint`?date=$date"
 $completedIds=@($check.batch.groups|ForEach-Object{@($_.items)}|Where-Object{$_.preparationStatus-eq'completed'}|ForEach-Object{[string]$_.id})
 $done=@($parts.GetEnumerator()|Where-Object{$completedIds -contains [string]$_.Key}).Count
 if($done-eq9-and$check.batch.automationStatus-eq'completed'){break}
 Start-Sleep -Seconds 2
}
if($done-ne9-or$check.batch.automationStatus-ne'completed'){throw "Landing completion verification failed: $done"}
[pscustomobject]@{saved=$saved.saved;completed=$done;automationStatus=$check.batch.automationStatus}|ConvertTo-Json
