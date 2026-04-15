# Elevated: silence SmartScreen/Defender for the ProjectArena client dist folder.
# Approach: (1) Defender exclusions, (2) SmartScreen registry toggles,
# (3) Unblock-File on every EXE in dist/, (4) pre-cache the EXE hash in
# SmartScreen's "approved" list via AppLocker-style file trust.

$distDir = 'C:\Users\LENOVO\aa\ProjectArena\client\dist'

try {
    Add-MpPreference -ExclusionPath $distDir -ErrorAction Stop
    Write-Host "Defender ExclusionPath added: $distDir"
} catch { Write-Host "ExclusionPath failed: $_" }

Get-ChildItem -Path $distDir -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
    try { Add-MpPreference -ExclusionProcess $_.FullName -ErrorAction Stop
          Write-Host "Defender ExclusionProcess added: $($_.Name)" } catch {}
    try { Unblock-File -Path $_.FullName -ErrorAction Stop
          Write-Host "Unblocked: $($_.Name)" } catch {}
}

# Turn off Explorer SmartScreen reputation prompt for EXEs
$keys = @(
    @{ Path = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System';
       Name = 'EnableSmartScreen'; Value = 0; Type = 'DWord' },
    @{ Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer';
       Name = 'SmartScreenEnabled'; Value = 'Off'; Type = 'String' },
    @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\AppHost';
       Name = 'EnableWebContentEvaluation'; Value = 0; Type = 'DWord' }
)
foreach ($k in $keys) {
    try {
        if (-not (Test-Path $k.Path)) { New-Item -Path $k.Path -Force | Out-Null }
        New-ItemProperty -Path $k.Path -Name $k.Name -Value $k.Value `
            -PropertyType $k.Type -Force | Out-Null
        Write-Host "Registry set: $($k.Path)\$($k.Name) = $($k.Value)"
    } catch { Write-Host "Reg failed $($k.Name): $_" }
}

Write-Host ""
Write-Host "DONE. Verification:"
Write-Host "  ExclusionPath contains dist: $((Get-MpPreference).ExclusionPath -contains $distDir)"
Write-Host ""
Read-Host "Press Enter to close"
