# Arena Client — First-time setup (Windows)
# Right-click this file -> "Run with PowerShell" and accept UAC if prompted.
# After setup runs once, you can launch ArenaClient.exe directly.

$ErrorActionPreference = "SilentlyContinue"

$exePath = Join-Path $PSScriptRoot "ArenaClient.exe"
$hudExePath = Join-Path $PSScriptRoot "ArenaClient_HUD.exe"
$cerPath = Join-Path $PSScriptRoot "arena_cert.cer"

if (Test-Path $hudExePath) {
    $exePath = $hudExePath
}

if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: Client EXE not found next to this script." -ForegroundColor Red
    Write-Host "Expected: ArenaClient_HUD.exe (preferred) or ArenaClient.exe" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "  Arena Client - Setup" -ForegroundColor Cyan
Write-Host "  --------------------"

if (Test-Path $cerPath) {
    try {
        # Prefer CurrentUser stores so setup works without Admin.
        Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
        Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null
        Write-Host "  [1/3] Certificate trusted (CurrentUser): OK" -ForegroundColor Green
    } catch {
        Write-Host "  [1/3] Certificate install failed (CurrentUser). Try re-running as Administrator if needed." -ForegroundColor Yellow
    }

    # Optional: also install to LocalMachine when running elevated (helps all users on the PC).
    try {
        Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
        Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null
        Write-Host "        Certificate trusted (LocalMachine): OK" -ForegroundColor Green
    } catch {
        # Non-admin is fine.
    }
} else {
    Write-Host "  [1/3] arena_cert.cer not found - skipping cert install." -ForegroundColor Yellow
}

Unblock-File -Path $exePath -ErrorAction SilentlyContinue
Write-Host "  [2/4] Zone identifier cleared: OK" -ForegroundColor Green

try {
    $sig = Get-AuthenticodeSignature -FilePath $exePath
    Write-Host ("  [3/4] Signature status: " + $sig.Status) -ForegroundColor Cyan
    if ($sig.Status -ne "Valid") {
        Write-Host "        WARNING: EXE is not validly signed. Windows may block it." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [3/4] Signature status: unknown" -ForegroundColor Yellow
}

try {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut("$env:USERPROFILE\Desktop\Arena Client.lnk")
    $lnk.TargetPath = $exePath
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.IconLocation = $exePath
    $lnk.Save()
    Write-Host "  [4/4] Desktop shortcut created: OK" -ForegroundColor Green
} catch {
    Write-Host "  [4/4] Shortcut skipped: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Setup complete. Launching Arena Client..." -ForegroundColor Cyan
Write-Host ""
Start-Process $exePath
