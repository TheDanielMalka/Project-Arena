# Run as Administrator — creates and installs self-signed code signing cert
$ErrorActionPreference = "Stop"

$certSubject  = "CN=ArenaClient, O=ProjectArena"
$pfxPath      = "C:\Users\LENOVO\aa\ProjectArena\client\arena_sign.pfx"
$pfxPassword  = "arena2026"
$cerTmp       = "$env:TEMP\arena_cert.cer"

Write-Host "[1/5] Creating self-signed code signing certificate..."
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $certSubject `
    -CertStoreLocation "Cert:\LocalMachine\My" `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(5)
Write-Host "      Thumbprint: $($cert.Thumbprint)"

Write-Host "[2/5] Exporting .cer for trust installation..."
Export-Certificate -Cert $cert -FilePath $cerTmp -Force | Out-Null

Write-Host "[3/5] Installing in Trusted Root..."
Import-Certificate -FilePath $cerTmp -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null

Write-Host "[4/5] Installing in Trusted Publishers..."
Import-Certificate -FilePath $cerTmp -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null

Write-Host "[5/5] Exporting .pfx for build pipeline..."
$pass = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pass | Out-Null

Copy-Item $cerTmp "C:\Users\LENOVO\aa\ProjectArena\client\arena_cert.cer" -Force

Write-Host ""
Write-Host "Done. Certificate installed and PFX exported to:" -ForegroundColor Green
Write-Host "  $pfxPath"
Write-Host "  $($cerTmp -replace $env:TEMP, '%TEMP%')"
