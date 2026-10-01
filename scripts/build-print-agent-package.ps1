$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Source = Join-Path $Root 'print-agent'
$OutputRoot = Join-Path $Root 'release-print-agent'
$PackageDir = Join-Path $OutputRoot 'POS-Print-Agent'
$ZipPath = Join-Path $OutputRoot 'POS-Print-Agent-Windows-x64.zip'
$NodeVersion = 'v22.22.0'
$NodeArchive = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
$NodeExtract = Join-Path $env:TEMP "node-$NodeVersion-win-x64"

Write-Host '[print-agent] Installing production dependencies...'
Push-Location $Source
try {
  & npm.cmd install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

if (Test-Path $OutputRoot) {
  Remove-Item $OutputRoot -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $PackageDir 'runtime') -Force | Out-Null

foreach ($Name in @('agent.js', 'package.json', 'package-lock.json', 'README.md', 'INSTALL.bat')) {
  Copy-Item (Join-Path $Source $Name) $PackageDir -Force
}
foreach ($Name in @('lib', 'node_modules', 'scripts')) {
  Copy-Item (Join-Path $Source $Name) $PackageDir -Recurse -Force
}

if (!(Test-Path $NodeArchive)) {
  $Url = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
  Write-Host "[print-agent] Downloading official Node runtime: $Url"
  & curl.exe -fsSL --retry 3 -o $NodeArchive $Url
  if ($LASTEXITCODE -ne 0) { throw "Node download failed ($LASTEXITCODE)" }
}
if (Test-Path $NodeExtract) {
  Remove-Item $NodeExtract -Recurse -Force
}
Expand-Archive -Path $NodeArchive -DestinationPath $env:TEMP -Force
$ExpandedDir = Join-Path $env:TEMP "node-$NodeVersion-win-x64"
Copy-Item (Join-Path $ExpandedDir 'node.exe') (Join-Path $PackageDir 'runtime\node.exe') -Force
Copy-Item (Join-Path $ExpandedDir 'LICENSE') (Join-Path $PackageDir 'runtime\NODE-LICENSE.txt') -Force

Compress-Archive -Path $PackageDir -DestinationPath $ZipPath -CompressionLevel Optimal

$Hash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash
$Size = (Get-Item $ZipPath).Length
Write-Host "[print-agent] Ready: $ZipPath"
Write-Host "[print-agent] Bytes: $Size"
Write-Host "[print-agent] SHA256: $Hash"
