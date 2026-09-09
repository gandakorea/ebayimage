param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$ImageDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$script = Join-Path $projectRoot 'vercel-listing-work\scripts\upload-listing-package.mjs'
$bundledNode = 'C:\Users\USER\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
& $node $script (Resolve-Path -LiteralPath $Manifest).Path (Resolve-Path -LiteralPath $ImageDirectory).Path
if ($LASTEXITCODE -ne 0) { throw "등록 패키지 업로드 실패: exit $LASTEXITCODE" }
