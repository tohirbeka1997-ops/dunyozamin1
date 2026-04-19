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

$AgentDir   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AgentJs    = Join-Path $AgentDir 'agent.js'
$NodeExe    = (Get-Command node -ErrorAction Stop).Source
$TaskName   = 'POS Print Agent'
$LogDir     = Join-Path $AgentDir 'logs'

if (!(Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}

Write-Host "Installing scheduled task '$TaskName'"
Write-Host "  Node:   $NodeExe"
Write-Host "  Script: $AgentJs"
Write-Host "  Logs:   $LogDir"

# cmd.exe wrapper so stdout/stderr are redirected without PowerShell quoting gymnastics.
$StartCmd  = "cmd.exe"
$StartArgs = "/c `"$NodeExe`" `"$AgentJs`" >> `"$LogDir\agent.log`" 2>&1"

$Action   = New-ScheduledTaskAction -Execute $StartCmd -Argument $StartArgs -WorkingDirectory $AgentDir
$Trigger  = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 5 -ExecutionTimeLimit ([System.TimeSpan]::Zero)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "  Removing existing task..."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description 'Local bridge between web POS and thermal printer (pos-print-agent).' | Out-Null

Write-Host "Starting task..."
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 2

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
