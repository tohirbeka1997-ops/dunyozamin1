# ============================================================================
# pos-print-agent — Windows autostart installer
# ----------------------------------------------------------------------------
# Registers the agent as a per-user scheduled task that starts with Windows
# logon and keeps running in the background (LogonType=Interactive).
#
# Usage (right-click PowerShell -> Run as Administrator recommended, but
# per-user tasks can also be registered without admin):
#
#   cd print-agent
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
#
# Uninstall:
#   schtasks /Delete /TN "POS Print Agent" /F
# ============================================================================

$ErrorActionPreference = 'Stop'

$SourceDir  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AgentDir   = Join-Path $env:LOCALAPPDATA 'DunyoZamin\POS-Print-Agent'
if ($SourceDir -ne $AgentDir) {
  if (!(Test-Path $AgentDir)) {
    New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null
  }
  Copy-Item (Join-Path $SourceDir 'agent.js') $AgentDir -Force
  foreach ($Name in @('lib', 'node_modules', 'runtime')) {
    $Source = Join-Path $SourceDir $Name
    if (Test-Path $Source) {
      Copy-Item $Source $AgentDir -Recurse -Force
    }
  }
}
$AgentJs    = Join-Path $AgentDir 'agent.js'
$BundledNode = Join-Path $AgentDir 'runtime\node.exe'
$NodeExe    = if (Test-Path $BundledNode) {
  $BundledNode
} else {
  (Get-Command node -ErrorAction Stop).Source
}
$TaskName   = 'POS Print Agent'
$LogDir     = Join-Path $AgentDir 'logs'
$ConfigPath = Join-Path $AgentDir 'config.json'

if (!(Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}

# Reliable launcher — avoids quoting bugs when paths contain spaces (e.g. "Windows 11").
$StartBat = Join-Path $AgentDir 'start-agent.cmd'
$StartBatBody = @"
@echo off
setlocal
cd /d "%~dp0"
if not exist "logs" mkdir logs
where node >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: node.exe not found in PATH>> "logs\agent.log"
  exit /b 1
)
node "agent.js" >> "logs\agent.log" 2>&1
"@
[System.IO.File]::WriteAllText($StartBat, $StartBatBody, (New-Object System.Text.UTF8Encoding($false)))

if (!(Test-Path $ConfigPath)) {
  $Printer = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue |
    Where-Object { $_.Default -eq $true } |
    Select-Object -First 1
  if (!$Printer) {
    $Printer = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  $PrinterName = if ($Printer -and [string]$Printer.Name) { [string]$Printer.Name } else { 'XP-80C' }
  if (!$Printer -or ![string]$Printer.Name) {
    Write-Warning "Windows printer topilmadi. Config ga vaqtincha 'printer:XP-80C' yozildi — Devices and Printers dan nomni tekshirib config.json ni tahrirlang."
  }

  $Config = @{
    agent = @{
      bind = '127.0.0.1'
      port = 9100
      secret = $null
      allowOrigins = @('*')
      logFile = $null
    }
    printer = @{
      type = 'epson'
      interface = "printer:$PrinterName"
      timeoutMs = 15000
      charsPerLine = 48
      textSize = @{ width = 0; height = 0 }
      usbVendorId = $null
      usbProductId = $null
      feedLines = 6
      cut = $true
      retryCount = 2
    }
    scale = @{
      enabled = $false
      port = ''
      baudRate = 9600
      dataBits = 8
      stopBits = 1
      parity = 'none'
      protocol = 'cas'
      timeoutMs = 2500
      minStableMs = 0
      unit = $null
      divisor = $null
    }
  }
  $ConfigJson = $Config | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText(
    $ConfigPath,
    $ConfigJson,
    (New-Object System.Text.UTF8Encoding($false))
  )
  Write-Host "Printer interface: printer:$PrinterName"
}

Write-Host "Installing scheduled task '$TaskName'"
Write-Host "  Launcher: $StartBat"
Write-Host "  Script:   $AgentJs"
Write-Host "  Logs:     $LogDir"

$Action   = New-ScheduledTaskAction -Execute $StartBat -WorkingDirectory $AgentDir
$Trigger  = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 5 -ExecutionTimeLimit ([System.TimeSpan]::Zero)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "  Removing existing task..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description 'Local bridge between web POS and thermal printer (pos-print-agent).' | Out-Null

# If nothing already listens on 9100, start the task now.
$alreadyUp = $false
try {
  $probe = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9100/health' -TimeoutSec 2
  if ($probe.StatusCode -eq 200) { $alreadyUp = $true }
} catch { }

if (-not $alreadyUp) {
  Write-Host "Starting task..."
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
}

try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9100/health' -TimeoutSec 3
  Write-Host "Health check: $($resp.StatusCode)"
  Write-Host $resp.Content
} catch {
  Write-Warning "Could not reach http://127.0.0.1:9100/health yet. Check $LogDir\agent.log"
}

Write-Host ""
Write-Host "Done. The agent will auto-start at every Windows logon."
Write-Host "To uninstall:  schtasks /Delete /TN `"$TaskName`" /F"
