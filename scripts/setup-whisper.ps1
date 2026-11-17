$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $projectRoot '.tools\whisper'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
$archivePath = Join-Path $toolRoot 'whisper-v1.9.2.zip'
$archiveHash = '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a'
if (!(Test-Path -LiteralPath $archivePath)) {
  Write-Output 'Downloading official whisper.cpp v1.9.2 Windows x64 binaries...'
  & curl.exe --fail --location --retry 2 --output $archivePath 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip'
  if ($LASTEXITCODE -ne 0) { throw 'Whisper download failed.' }
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveHash) { throw 'Whisper archive checksum mismatch. Remove the incomplete archive and retry.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolRoot -Force
$modelPath = Join-Path $toolRoot 'ggml-base.bin'
if (!(Test-Path -LiteralPath $modelPath)) {
  Write-Output 'Downloading multilingual Whisper base model (148 MB)...'
  & curl.exe --fail --location --retry 2 --output $modelPath 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
  if ($LASTEXITCODE -ne 0) { throw 'Model download failed.' }
}
if ((Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe') { throw 'Model checksum mismatch. Remove the incomplete model and retry.' }
Write-Output 'Whisper ready. Start with: powershell -ExecutionPolicy Bypass -File scripts/start-whisper.ps1'
