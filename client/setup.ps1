# Arena Client — First-time setup (Windows)
# Right-click this file -> "Run with PowerShell" and accept UAC if prompted.
# After setup runs once, you can launch ArenaClient.exe directly.

$ErrorActionPreference = "SilentlyContinue"

$exePath = Join-Path $PSScriptRoot "ArenaClient.exe"
$cerPath = Join-Path $PSScriptRoot "arena_cert.cer"

if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: ArenaClient.exe not found next to this script." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "  Arena Client - Setup" -ForegroundColor Cyan
Write-Host "  --------------------"

if (Test-Path $cerPath) {
    try {
        Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
        Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null
        Write-Host "  [1/3] Certificate trusted: OK" -ForegroundColor Green
    } catch {
        Write-Host "  [1/3] Certificate install needs Admin - re-run as Administrator if blocked." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [1/3] arena_cert.cer not found - skipping cert install." -ForegroundColor Yellow
}

Unblock-File -Path $exePath
Write-Host "  [2/3] Zone identifier cleared: OK" -ForegroundColor Green

try {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut("$env:USERPROFILE\Desktop\Arena Client.lnk")
    $lnk.TargetPath = $exePath
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.IconLocation = $exePath
    $lnk.Save()
    Write-Host "  [3/3] Desktop shortcut created: OK" -ForegroundColor Green
} catch {
    Write-Host "  [3/3] Shortcut skipped: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Setup complete. Launching Arena Client..." -ForegroundColor Cyan
Write-Host ""
Start-Process $exePath
