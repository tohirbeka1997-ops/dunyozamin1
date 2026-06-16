#Requires -Version 5.1
<#
.SYNOPSIS
  Serverdagi eng yangi POS DB snapshotini lokal PC ga yuklab oladi (faqat PULL).

.DESCRIPTION
  - Manba: /var/lib/pos/backups/pos-*.db (jonli pos.db EMAS)
  - Maqsad: zaxira nusxa — production serverga hech narsa yuborilmaydi
  - deploy/deploy.env dan DEPLOY_SERVER va SSH_IDENTITY_FILE o'qiladi

.EXAMPLE
  .\deploy\scripts\pull-db-from-server.ps1

.EXAMPLE
  .\deploy\scripts\pull-db-from-server.ps1 -Server "deploy@1.2.3.4" -LocalDir "D:\POS-Backups"
#>
[CmdletBinding()]
param(
    [string] $Server = '',
    [string] $IdentityFile = '',
    [string] $RemoteBackupDir = '/var/lib/pos/backups',
    [string] $LocalDir = '',
    [int] $KeepDays = 14,
    [switch] $SkipPrune
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info([string] $Message) { Write-Host "[pull-db] $Message" }
function Write-Warn([string] $Message) { Write-Warning "[pull-db] $Message" }

function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Read-DeployEnv {
    param([string] $Path)
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -le 0) { return }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim()
        if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        $map[$key] = $val
    }
    return $map
}

function Expand-HomePath([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    if ($Path -match '^~(/|\\|$)') {
        return Join-Path $env:USERPROFILE $Path.Substring(2)
    }
    if ($Path -match '%([^%]+)%') {
        return [regex]::Replace($Path, '%([^%]+)%', {
            param($m)
            $v = [Environment]::GetEnvironmentVariable($m.Groups[1].Value)
            if ($v) { $v } else { $m.Value }
        })
    }
    return $Path
}

function Assert-Command([string] $Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Topilmadi: $Name. Windows OpenSSH Client o'rnatilgan bo'lishi kerak (Settings → Optional Features → OpenSSH Client)."
    }
}

function Invoke-Ssh {
    param(
        [string[]] $BaseArgs,
        [string] $RemoteCommand
    )
    $args = @()
    if ($BaseArgs) { $args += $BaseArgs }
    $args += @($Server, $RemoteCommand)
    & ssh @args 2>&1
}

$repoRoot = Get-RepoRoot
$deployEnvPath = Join-Path $repoRoot 'deploy\deploy.env'
$rootEnvPath = Join-Path $repoRoot '.env'
$envDeploy = Read-DeployEnv $deployEnvPath
$envRoot = Read-DeployEnv $rootEnvPath

if (-not $Server) {
    $Server = $envDeploy['DEPLOY_SERVER']
    if (-not $Server) { $Server = $envRoot['DEPLOY_SERVER'] }
    if (-not $Server) { $Server = $envDeploy['SERVER'] }
    if (-not $Server) { $Server = $envRoot['SERVER'] }
}
if (-not $Server) {
    throw "DEPLOY_SERVER topilmadi. deploy/deploy.env ga DEPLOY_SERVER=user@host qo'shing yoki -Server parametrini bering."
}

if (-not $IdentityFile) {
    $IdentityFile = $envDeploy['SSH_IDENTITY_FILE']
    if (-not $IdentityFile) { $IdentityFile = $envRoot['SSH_IDENTITY_FILE'] }
    if (-not $IdentityFile) { $IdentityFile = $envDeploy['SSH_KEY'] }
    if (-not $IdentityFile) { $IdentityFile = $envRoot['SSH_KEY'] }
}
$IdentityFile = Expand-HomePath $IdentityFile

if (-not $LocalDir) {
    $LocalDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'POS-Backups'
}

Assert-Command 'ssh'
Assert-Command 'scp'

if (-not (Test-Path -LiteralPath $LocalDir)) {
    New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null
}

$sshBaseArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new')
$scpBaseArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new')

if ($IdentityFile) {
    if (-not (Test-Path -LiteralPath $IdentityFile)) {
        Write-Warn "SSH kalit topilmadi ($IdentityFile) — default ssh agent ishlatiladi."
        $IdentityFile = ''
    }
}

if ($IdentityFile) {
    $sshBaseArgs = @('-i', $IdentityFile) + $sshBaseArgs
    $scpBaseArgs = @('-i', $IdentityFile) + $scpBaseArgs
}

Write-Info "Server: $Server"
Write-Info "Remote backup dir: $RemoteBackupDir"
Write-Info "Local dir: $LocalDir"

Write-Info 'SSH ulanish tekshiruvi...'
$ping = Invoke-Ssh -BaseArgs $sshBaseArgs -RemoteCommand 'echo ok'
if ($LASTEXITCODE -ne 0 -or ($ping -join "`n").Trim() -ne 'ok') {
    throw "SSH ulanib bo'lmadi: $Server"
}

$findCmd = "ls -1t ${RemoteBackupDir}/pos-*.db 2>/dev/null | head -1"
Write-Info 'Eng yangi snapshot qidirilmoqda...'
$remotePath = (Invoke-Ssh -BaseArgs $sshBaseArgs -RemoteCommand $findCmd | Select-Object -First 1).ToString().Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remotePath)) {
    throw "Serverda backup topilmadi: ${RemoteBackupDir}/pos-*.db. POS_BACKUP_ENABLED=1 va pos-server ishlayotganini tekshiring."
}

$baseName = Split-Path -Leaf $remotePath
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$localName = "${baseName}.pulled-${stamp}.db"
$localPath = Join-Path $LocalDir $localName

Write-Info "Yuklanmoqda: ${Server}:${remotePath}"
Write-Info "           -> $localPath"

& scp @scpBaseArgs "${Server}:${remotePath}" $localPath
if ($LASTEXITCODE -ne 0) {
    throw 'scp muvaffaqiyatsiz tugadi.'
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $localPath).Length / 1MB, 2)
Write-Info "Tayyor: $localPath ($sizeMb MB)"
Write-Warn 'Bu faqat ZAXIRA nusxa. Production server pos.db ga qayta yuklamang — faqat tiklash (restore) vaqtida ishlating.'

if (-not $SkipPrune -and $KeepDays -gt 0) {
    $cutoff = (Get-Date).AddDays(-$KeepDays)
    $removed = 0
    Get-ChildItem -LiteralPath $LocalDir -Filter '*.db' -File | Where-Object {
        $_.LastWriteTime -lt $cutoff
    } | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        $removed++
    }
    if ($removed -gt 0) {
        Write-Info "Eski lokal nusxalar o'chirildi: $removed ta (>$KeepDays kun)"
    }
}

exit 0
