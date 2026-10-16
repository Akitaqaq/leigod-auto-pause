# 注册开机自启的监控任务（无需管理员）
# 运行: powershell -ExecutionPolicy Bypass -File install_task.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$js = Join-Path $scriptDir "leigod_pause.js"

# 用户级计划任务: 登录后启动 watch
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$js`" watch --auto-recover" -WorkingDirectory $scriptDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "LeiGod_AutoPause" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Write-Host "已注册计划任务 LeiGod_AutoPause (登录后自动监控)"
Write-Host "手动启动: Start-ScheduledTask -TaskName LeiGod_AutoPause"
