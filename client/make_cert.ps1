# Arena Client — Create signing material (no Admin required)
# Produces:
#  - arena_sign.pfx (private key)  [LOCAL ONLY, gitignored]
#  - arena_cert.cer (public cert)  [bundled in dist for setup.ps1]
#
# IMPORTANT: Do NOT regenerate on every run. If arena_sign.pfx exists, we keep it stable.
$ErrorActionPreference = "Stop"

$certSubject = "CN=ArenaClient, O=ProjectArena"
$pfxPath     = Join-Path $PSScriptRoot "arena_sign.pfx"
$cerPath     = Join-Path $PSScriptRoot "arena_cert.cer"
$pfxPassword = "arena2026"

function Export-CerFromPfx([string]$Pfx, [string]$Password, [string]$OutCer) {
    $bytes = [System.IO.File]::ReadAllBytes($Pfx)
    $cert  = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        $bytes, $Password,
        [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
    )
    $cerBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    [System.IO.File]::WriteAllBytes($OutCer, $cerBytes)
}

if (Test-Path $pfxPath) {
    Write-Host "[1/3] arena_sign.pfx already exists — keeping existing certificate." -ForegroundColor Cyan
    Export-CerFromPfx -Pfx $pfxPath -Password $pfxPassword -OutCer $cerPath
    Write-Host "[2/3] arena_cert.cer exported from existing PFX: OK" -ForegroundColor Green
    Write-Host "[3/3] Done." -ForegroundColor Green
    exit 0
}

Write-Host "[1/3] Creating self-signed code signing certificate..."
$cert = $null
try {
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyStorageProvider "Microsoft Software Key Storage Provider" `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -KeyExportPolicy Exportable `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(5)
} catch {
    Write-Host "      KSP failed. Trying legacy CSP provider..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -Provider "Microsoft Enhanced RSA and AES Cryptographic Provider" `
        -KeyLength 2048 `
        -KeyExportPolicy Exportable `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(5)
}
Write-Host "      Thumbprint: $($cert.Thumbprint)"

Write-Host "[2/3] Exporting arena_sign.pfx..."
$pass = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pass | Out-Null

Write-Host "[3/3] Exporting arena_cert.cer from PFX..."
Export-CerFromPfx -Pfx $pfxPath -Password $pfxPassword -OutCer $cerPath

Write-Host ""
Write-Host "OK. Created:" -ForegroundColor Green
Write-Host "  $pfxPath" -ForegroundColor Green
Write-Host "  $cerPath" -ForegroundColor Green
