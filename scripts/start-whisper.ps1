param([switch]$Background)
$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools\whisper'
$exe = Get-ChildItem -LiteralPath $toolRoot -Recurse -Filter whisper-server.exe | Select-Object -First 1
if (!$exe) { throw 'Run scripts/setup-whisper.ps1 first.' }
$modelPath = Join-Path $toolRoot 'ggml-base.bin'
if (!(Test-Path -LiteralPath $modelPath)) { throw 'Model missing. Run scripts/setup-whisper.ps1.' }
if ($Background) {
  $quotedModel = '"' + $modelPath + '"'
  $process = Start-Process -FilePath $exe.FullName -ArgumentList @('-m', $quotedModel, '--host', '127.0.0.1', '--port', '8080', '-l', 'auto', '-t', '4') -WorkingDirectory $exe.DirectoryName -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $toolRoot 'server.stdout.log') -RedirectStandardError (Join-Path $toolRoot 'server.stderr.log')
  Write-Output "Whisper server process: $($process.Id)"
} else {
  & $exe.FullName -m $modelPath --host 127.0.0.1 --port 8080 -l auto -t 4
}
