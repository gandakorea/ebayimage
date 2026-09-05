[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Text,

    [ValidateSet('alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar')]
    [string]$Voice = 'shimmer',

    [string]$Instructions = 'Speak in natural standard Seoul Korean with no regional dialect. Use an unmistakably feminine young adult voice with an extremely high, light, sparkling and youthful register, crystal-clear resonance, lively rhythm, crisp pronunciation, and a friendly smile. Keep it smooth, pleasant, modern, natural, and clearly adult. Do not sound masculine, androgynous, mature, husky, low, dark, breathy, regional, formal, theatrical, piercing, squeaky, distorted, or like a child.',

    [string]$OutputPath = (Join-Path $PSScriptRoot '..\음성보고\latest.wav'),

    [switch]$NoPlay
)

$ErrorActionPreference = 'Stop'

if ($Text.Length -gt 1000) {
    throw '음성 보고는 1,000자 이하로 줄여서 실행해 주세요.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot 'korea-autoparts-studio\.env.local'
$apiKey = $env:OPENAI_API_KEY

if ([string]::IsNullOrWhiteSpace($apiKey) -and (Test-Path -LiteralPath $envPath)) {
    foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
        if ($line -match '^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$') {
            $apiKey = $matches[1].Trim().Trim('"').Trim("'")
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'OPENAI_API_KEY를 찾지 못했습니다. korea-autoparts-studio\.env.local을 확인해 주세요.'
}

$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputFullPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$payload = @{
    model = 'gpt-4o-mini-tts'
    voice = $Voice
    input = $Text
    instructions = $Instructions
    response_format = 'wav'
} | ConvertTo-Json -Compress

try {
    Invoke-WebRequest `
        -Uri 'https://api.openai.com/v1/audio/speech' `
        -Method Post `
        -Headers @{ Authorization = "Bearer $apiKey" } `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) `
        -OutFile $outputFullPath `
        -TimeoutSec 90
} catch {
    if (Test-Path -LiteralPath $outputFullPath) {
        Remove-Item -LiteralPath $outputFullPath -Force
    }
    throw "OpenAI 음성 API 호출에 실패했습니다: $($_.Exception.Message)"
}

# Streaming WAV responses can leave RIFF and data sizes as 0xFFFFFFFF.
# Normalize those fields so Windows SoundPlayer can open the saved file.
$audioBytes = [System.IO.File]::ReadAllBytes($outputFullPath)
if ($audioBytes.Length -ge 44 -and
    [System.Text.Encoding]::ASCII.GetString($audioBytes, 0, 4) -eq 'RIFF' -and
    [System.BitConverter]::ToUInt32($audioBytes, 4) -eq [uint32]::MaxValue) {
    [System.BitConverter]::GetBytes([uint32]($audioBytes.Length - 8)).CopyTo($audioBytes, 4)

    for ($index = 12; $index -le [Math]::Min($audioBytes.Length - 8, 256); $index++) {
        if ([System.Text.Encoding]::ASCII.GetString($audioBytes, $index, 4) -eq 'data') {
            [System.BitConverter]::GetBytes([uint32]($audioBytes.Length - $index - 8)).CopyTo($audioBytes, $index + 4)
            break
        }
    }

    [System.IO.File]::WriteAllBytes($outputFullPath, $audioBytes)
}

if (-not $NoPlay) {
    $player = [System.Media.SoundPlayer]::new($outputFullPath)
    $player.Load()
    $player.PlaySync()
}

Write-Output $outputFullPath
