# Create and install self-signed code signing cert (works without Admin).
$ErrorActionPreference = "Stop"

$certSubject = "CN=ArenaClient, O=ProjectArena"
$pfxPath     = Join-Path $PSScriptRoot "arena_sign.pfx"
$pfxPassword = "arena2026"
$cerTmp      = "$env:TEMP\arena_cert.cer"

Write-Host "[1/5] Creating self-signed code signing certificate..."
$cert = $null
try {
    # Prefer CurrentUser store (no Admin required).
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -KeyExportPolicy Exportable `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(5)
} catch {
    Write-Host "      CurrentUser cert creation failed. Trying LocalMachine (requires Admin)..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -CertStoreLocation "Cert:\LocalMachine\My" `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -KeyExportPolicy Exportable `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(5)
}
Write-Host "      Thumbprint: $($cert.Thumbprint)"

Write-Host "[2/5] Exporting .cer for trust installation..."
Export-Certificate -Cert $cert -FilePath $cerTmp -Force | Out-Null

Write-Host "[3/5] Installing in Trusted Root..."
try { Import-Certificate -FilePath $cerTmp -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null } catch { }
try { Import-Certificate -FilePath $cerTmp -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null } catch { }

Write-Host "[4/5] Installing in Trusted Publishers..."
try { Import-Certificate -FilePath $cerTmp -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null } catch { }
try { Import-Certificate -FilePath $cerTmp -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null } catch { }

Write-Host "[5/5] Exporting .pfx for build pipeline..."
$pass = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pass | Out-Null

Copy-Item $cerTmp (Join-Path $PSScriptRoot "arena_cert.cer") -Force

Write-Host ""
Write-Host "Done. Certificate installed and PFX exported to:" -ForegroundColor Green
Write-Host "  $pfxPath"
Write-Host "  $($cerTmp -replace $env:TEMP, '%TEMP%')"
