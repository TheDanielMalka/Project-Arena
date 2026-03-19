Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Step "Frontend tests"
npm run test

Step "Frontend lint"
npm run lint

Step "Frontend build"
npm run build

Step "Engine dependencies"
$env:PYTHONUTF8 = "1"
python -m pip install -r "engine/requirements.txt"

Step "Engine tests"
python -m pytest -q "engine/tests"

Step "Client dependencies"
python -m pip install -r "client/requirements.txt"

Step "Client build"
Set-Location "$root/client"
python build.py --clean

$exe = Join-Path (Get-Location) "dist/ArenaClient.exe"
if (!(Test-Path $exe)) {
  throw "Client EXE not found after build: $exe"
}

$item = Get-Item $exe
Step "Verification complete"
Write-Host "EXE: $($item.FullName)" -ForegroundColor Green
Write-Host "Size: $([math]::Round($item.Length / 1MB, 1)) MB" -ForegroundColor Green
Write-Host "Updated: $($item.LastWriteTime)" -ForegroundColor Green
