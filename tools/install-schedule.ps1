# Instala tarea diaria 09:00 para despertar Reportador.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$wake = Join-Path $root 'tools\wake-at-7.ps1'
$taskName = 'Reportador Wake 9am'

if (-not (Test-Path $wake)) { throw "Falta $wake" }

$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wake`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Arranca Reportador todos los dias a las 09:00' -Force | Out-Null
Write-Host "Tarea registrada: $taskName (diaria 09:00)"
