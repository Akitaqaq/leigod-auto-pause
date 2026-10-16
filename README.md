# 雷神加速器自动暂停

退出客户端时自动暂停计时，避免时长空转浪费。

## 逆向结论

| 项目 | 内容 |
|------|------|
| 应用 | Electron 11.3.3.0 (`E:\LeiGod_Acc\leigod.exe`) |
| 暂停 API | `POST https://api1.leigod.com/client/pause` |
| 恢复 API | `POST https://api1.leigod.com/client/recover` |
| 状态 API | `POST https://api1.leigod.com/client/pause/status` |
| 鉴权 | query `account_token` |
| 请求体 | `encrypt({})` = `tQFyh13f7AYsHg==`（RC4 key=`abc` + deflate） |

## 使用

```bash
cd <本文件夹>

# 手动
node leigod_pause.js status|pause|recover

# 后台监控（无窗口，脚本会自动找 node）
wscript run_watch_hidden.vbs
```

开机自启 / 关机暂停：

```powershell
powershell -ExecutionPolicy Bypass -File install_shutdown_hook.ps1
```

## 发给别人

整个 `leigod_auto` 文件夹（**不含** `logs\`）。对方需要：

1. 已安装 Node.js（任一常见位置即可，VBS 会自动探测：`D:\devTool\*`、`C:\Program Files\nodejs`、`where node`、PowerShell `Get-Command node`）
2. 雷神客户端本机登录过一次（`account_token` 从 `E:\LeiGod_Acc\resources\llogs\http-*.log` 解析）
3. 跑一次 `install_shutdown_hook.ps1` 注册计划任务

## 文件

- `leigod_pause.js` / `leigod_crypto.js` — 主程序
- `run_watch_hidden.vbs` / `run_pause_hidden.vbs` — 无窗口启动（自动探测 node）
- `install_shutdown_hook.ps1` — 注册计划任务
- `logs\` — 运行日志（本地时区）

## 路径探测

- **token 日志目录**（`llogs`）：自动找，顺序为
  1. `LEIGOD_LLOGS` 环境变量
  2. `LEIGOD_HOME
esources\llogs`
  3. 常见安装：`E/D/C:\LeiGod_Acc`、`Program Files\LeiGod_Acc`、`%LOCALAPPDATA%\LeiGod_Acc`
  4. 运行中的 `leigod.exe` 路径反推
  5. 兜底 `E:/LeiGod_Acc/resources/llogs`
- 启动日志会打印实际使用的 `llogs 目录:`

- **查询参数**（`hardware_id` / `client_version` / 省市 / 渠道等）：启动时从本机雷神 `http-*.log` 最近一条带 `hardware_id` 的请求解析，与真实客户端一致；解析不到时回退 `hardward.json` / `version_f.txt` / 内置默认值。

## token 失效怎么处理

1. **每次调用接口**：若返回 `code!=0` 且文案像登录/ token 失效，自动从 `E:\LeiGod_Acc
esources\llogs\http-*.log` **重读最新 token** 并重试一次。
2. **watch 模式**：约每 5 分钟主动同步一次日志里的 token；某次操作发现失效也会立刻同步。
3. **仍失败**：日志会写明原因；常见处理是 **重新打开雷神客户端登录一次**，它写入新 token 后，脚本下次会自动读到。
4. `LEIGOD_TOKEN` / `--token=` 指定的固定 token 不会被日志覆盖刷新（除非手动改）。
