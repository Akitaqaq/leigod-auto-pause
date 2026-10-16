# Register hidden-window Leigod pause tasks
# Run: powershell -ExecutionPolicy Bypass -File install_shutdown_hook.ps1

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$watchVbs = Join-Path $scriptDir "run_watch_hidden.vbs"
$pauseVbs = Join-Path $scriptDir "run_pause_hidden.vbs"
$workDir = $scriptDir

if (-not (Test-Path -LiteralPath $watchVbs)) { throw "missing run_watch_hidden.vbs" }
if (-not (Test-Path -LiteralPath $pauseVbs)) { throw "missing run_pause_hidden.vbs" }

$actionW = New-ScheduledTaskAction -Execute $wscript -Argument $watchVbs -WorkingDirectory $workDir
$triggerW = New-ScheduledTaskTrigger -AtLogOn
$settingsW = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principalW = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "LeiGod_AutoPause" -Action $actionW -Trigger $triggerW -Settings $settingsW -Principal $principalW -Force | Out-Null
Write-Host "[OK] AutoPause (hidden watch via wscript)"

$actionP = New-ScheduledTaskAction -Execute $wscript -Argument $pauseVbs -WorkingDirectory $workDir
$settingsP = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$principalP = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited
$cimClass = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
$sub1 = '<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name=''User32''] and (EventID=1074)]]</Select></Query></QueryList>'
$sub2 = '<QueryList><Query Id="0" Path="Security"><Select Path="Security">*[System[Provider[@Name=''Microsoft-Windows-Security-Auditing''] and (EventID=4647)]]</Select></Query></QueryList>'

foreach ($pair in @(
  @{ n = "LeiGod_PauseOnShutdownEvent"; s = $sub1 },
  @{ n = "LeiGod_PauseOnLogoffEvent"; s = $sub2 }
)) {
  try {
    $trig = New-CimInstance -CimClass $cimClass -Property @{ Enabled = $true; Subscription = $pair.s } -ClientOnly
    Register-ScheduledTask -TaskName $pair.n -Action $actionP -Trigger $trig -Settings $settingsP -Principal $principalP -Force | Out-Null
    Write-Host ("[OK] " + $pair.n)
  } catch {
    Write-Host ("[FAIL] " + $pair.n + " : " + $_.Exception.Message)
  }
}

Write-Host ""
Get-ScheduledTask -TaskName "LeiGod_*" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host ($_.TaskName + " => " + $_.Actions[0].Execute + " " + $_.Actions[0].Arguments)
}
