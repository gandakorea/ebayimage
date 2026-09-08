param(
    [Parameter(Mandatory = $true)]
    [string]$VerifyRequestPath,

    [Parameter(Mandatory = $true)]
    [string]$TaskId,

    [string]$EnvironmentFile = ".env.ebay.local"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

Get-Content -LiteralPath $EnvironmentFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable(
            $matches[1].Trim(),
            $matches[2].Trim().Trim('"')
        )
    }
}

$accessToken = $env:EBAY_AU_USER_TOKEN
if ([string]::IsNullOrWhiteSpace($accessToken)) {
    throw "EBAY_AU_USER_TOKEN is missing from $EnvironmentFile"
}

[xml]$request = Get-Content -LiteralPath $VerifyRequestPath -Raw
$namespace = New-Object System.Xml.XmlNamespaceManager($request.NameTable)
$namespace.AddNamespace("e", "urn:ebay:apis:eBLBaseComponents")
$item = $request.SelectSingleNode("//e:Item", $namespace)
if ($null -eq $item) {
    throw "The verify request does not contain an Item node."
}

$outputDirectory = Split-Path -Parent (Resolve-Path -LiteralPath $VerifyRequestPath)
$csvPath = Join-Path $outputDirectory "draft-upload.csv"
$pictureUrls = @($item.PictureDetails.PictureURL | ForEach-Object { $_.InnerText }) -join "|"

$actionHeader = "Action(SiteID=Australia|Country=AU|Currency=AUD|Version=1193|CC=UTF-8)"
$row = [ordered]@{
    $actionHeader          = "Draft"
    "Custom label (SKU)" = $item.SKU
    "Category ID"        = $item.PrimaryCategory.CategoryID
    "Title"              = $item.Title
    "UPC"                = "Does not apply"
    "Price"              = $item.StartPrice.InnerText
    "Quantity"           = $item.Quantity
    "Item photo URL"     = $pictureUrls
    "Condition ID"       = "NEW"
    "Description"        = $item.Description.InnerText
    "Format"             = "FixedPrice"
}

$infoRows = @(
    '#INFO,Version=0.0.2,Template= eBay-draft-listings-template_AU,,,,,,,,,',
    '#INFO Action and Category ID are required fields.,,,,,,,,,,',
    '#INFO,,,,,,,,,,'
)
$csvRows = @([pscustomobject]$row | ConvertTo-Csv -NoTypeInformation)
[System.IO.File]::WriteAllLines(
    $csvPath,
    @($infoRows + $csvRows),
    (New-Object System.Text.UTF8Encoding($false))
)

$handler = New-Object System.Net.Http.HttpClientHandler
$client = New-Object System.Net.Http.HttpClient($handler)
$client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $accessToken)
$client.DefaultRequestHeaders.Add("X-EBAY-C-MARKETPLACE-ID", "EBAY_AU")

$multipart = New-Object System.Net.Http.MultipartFormDataContent
$stream = [System.IO.File]::OpenRead($csvPath)
$fileContent = New-Object System.Net.Http.StreamContent($stream)
$fileContent.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue("text/csv")
$multipart.Add($fileContent, "file", [System.IO.Path]::GetFileName($csvPath))

try {
    $uri = "https://api.ebay.com/sell/feed/v1/task/$TaskId/upload_file"
    $response = $client.PostAsync($uri, $multipart).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
        throw "Upload failed with HTTP $([int]$response.StatusCode): $body"
    }
    [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        TaskId = $TaskId
        CsvPath = $csvPath
    } | ConvertTo-Json -Compress
}
finally {
    $stream.Dispose()
    $multipart.Dispose()
    $client.Dispose()
    $handler.Dispose()
}
