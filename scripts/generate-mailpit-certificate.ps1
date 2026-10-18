$ErrorActionPreference = "Stop"

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
  throw "OpenSSL is required to create the local Mailpit STARTTLS certificate."
}

$certificateDirectory = Join-Path (Get-Location) ".local/mailpit"
New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null
$keyPath = Join-Path $certificateDirectory "mailpit.key"
$certificatePath = Join-Path $certificateDirectory "mailpit.crt"

& $openssl.Source req -x509 -newkey rsa:2048 -sha256 -nodes -days 30 `
  -keyout $keyPath `
  -out $certificatePath `
  -subj "/CN=mailpit" `
  -addext "subjectAltName=DNS:mailpit" `
  -addext "basicConstraints=critical,CA:TRUE"
if ($LASTEXITCODE -ne 0) {
  throw "OpenSSL could not create the local Mailpit certificate."
}

Write-Output "Created ignored local certificate files in $certificateDirectory"
