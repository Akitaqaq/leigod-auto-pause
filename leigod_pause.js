#!/usr/bin/env node
"use strict";
/**
 * 雷神加速器自动暂停/恢复时长
 *
 * 原理:
 *   暂停: POST https://api1.leigod.com/client/pause
 *   恢复: POST https://api1.leigod.com/client/recover
 *   状态: POST https://api1.leigod.com/client/pause/status
 *   时长: POST https://secapiv11.leigod.com/client/user/time/status
 *
 * 请求体: @leigod/crypto  encrypt({})  =>  "tQFyh13f7AYsHg=="
 * 鉴权:   querystring.account_token
 *
 * 用法:
 *   node leigod_pause.js status
 *   node leigod_pause.js pause
 *   node leigod_pause.js recover
 *   node leigod_pause.js watch          # 监控 leigod.exe 退出后自动暂停
 *   node leigod_pause.js watch --auto-recover  # 启动时自动恢复
 *
 * token 来源(按优先级):
 *   1. 环境变量 LEIGOD_TOKEN
 *   2. --token=xxx
 *   3. 从 llogs/http-*.log 解析 account_token
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const { encrypt, decrypt } = require("./leigod_crypto");

// ---------- 配置 ----------
const PROCESS_NAME = "leigod.exe";

function detectLlogs() {
  const cands = [];
  if (process.env.LEIGOD_LLOGS) cands.push(process.env.LEIGOD_LLOGS);
  if (process.env.LEIGOD_HOME) {
    cands.push(path.join(process.env.LEIGOD_HOME, "resources", "llogs"));
    cands.push(path.join(process.env.LEIGOD_HOME, "llogs"));
  }
  const roots = [
    "E:/LeiGod_Acc",
    "D:/LeiGod_Acc",
    "C:/LeiGod_Acc",
    "C:/Program Files/LeiGod_Acc",
    "C:/Program Files (x86)/LeiGod_Acc",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "LeiGod_Acc") : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local", "LeiGod_Acc") : null,
  ].filter(Boolean);
  for (const root of roots) {
    cands.push(path.join(root, "resources", "llogs"));
    cands.push(path.join(root, "llogs"));
  }
  for (const c of cands) {
    try {
      if (c && fs.existsSync(c) && fs.readdirSync(c).some((f) => f.startsWith("http-"))) {
        return c;
      }
    } catch (_) {}
  }
  try {
    const { execSync } = require("child_process");
    const out = execSync(
      "powershell -NoProfile -Command \"(Get-Process -Name leigod -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)\"",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim().split(/\r?\n/)[0];
    if (out) {
      const c = path.join(path.dirname(out), "resources", "llogs");
      if (fs.existsSync(c)) return c;
    }
  } catch (_) {}
  return "E:/LeiGod_Acc/resources/llogs";
}

const LLOGS = detectLlogs();
const LOG_DIR = path.join(__dirname, "logs");
function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const LOG_FILE = path.join(LOG_DIR, `auto-${localDateStr()}.log`);

// 查询参数：优先从本机雷神 HTTP 日志解析真实请求（对齐当前设备/版本/地区）
const FALLBACK_QS = {
  region_code: "1",
  area_code: "ZJ",
  province: "浙江",
  city_name_cn: "杭州",
  os_type: "0",
  product_type: "0",
  src_channel: "guanwang_nn",
  client_version: "11.3.3.0",
  hardware_id: "lgdv11_9873af67b4db01584c9607ffaacd37d1",
  locale: "zh_CN",
};

// 需要与本机客户端一致的键（日志里能解析到就覆盖）
const QS_KEYS = Object.keys(FALLBACK_QS);

function detectQueryFromLogs() {
  const qs = { ...FALLBACK_QS };
  try {
    const files = fs
      .readdirSync(LLOGS)
      .filter((f) => f.startsWith("http-") && f.endsWith(".log"))
      .sort()
      .reverse();
    for (const f of files) {
      const text = fs.readFileSync(path.join(LLOGS, f), "utf8");
      // 匹配 ...leigod.com/client/...?region_code=... 最近一条带 hardware_id 的请求
      const re = /https:\/\/[^"\s]*leigod\.(?:com|cn)\/[^"\s]*\?([^"\s]+)/g;
      let m;
      let best = null;
      while ((m = re.exec(text))) {
        const q = m[1];
        if (q.includes("hardware_id=") || q.includes("client_version=")) best = q;
      }
      if (!best) continue;
      const params = new URLSearchParams(best);
      for (const k of QS_KEYS) {
        const v = params.get(k);
        if (v) qs[k] = v;
      }
      return qs;
    }
  } catch (e) {
    // ignore, use fallback
  }
  // 再尝试 hardward.json / 版本文件
  try {
    const hw = path.join(path.dirname(LLOGS), "leishenSdk", "hardward.json");
    if (fs.existsSync(hw)) {
      const j = JSON.parse(fs.readFileSync(hw, "utf8"));
      if (j && j.mac) qs.hardware_id = j.mac;
    }
  } catch (_) {}
  try {
    const vf = path.join(path.dirname(LLOGS), "..", "version_f.txt");
    if (fs.existsSync(vf)) {
      const v = fs.readFileSync(vf, "utf8").trim();
      if (/^\d+\.\d+/.test(v)) qs.client_version = v;
    }
  } catch (_) {}
  return qs;
}

let _qsCache = null;
function getQueryParams() {
  if (!_qsCache) _qsCache = detectQueryFromLogs();
  return _qsCache;
}

// ---------- token ----------
function parseTokenFromLogs() {
  try {
    const files = fs
      .readdirSync(LLOGS)
      .filter((f) => f.startsWith("http-") && f.endsWith(".log"))
      .sort()
      .reverse();
    for (const f of files) {
      const text = fs.readFileSync(path.join(LLOGS, f), "utf8");
      const m = text.match(/account_token=([A-Za-z0-9]+)/g);
      if (m && m.length) {
        const last = m[m.length - 1];
        return last.replace("account_token=", "");
      }
    }
  } catch (e) {
    console.error("parse token from logs failed:", e.message);
  }
  return null;
}

function resolveToken(cliToken) {
  return (
    process.env.LEIGOD_TOKEN ||
    cliToken ||
    parseTokenFromLogs() ||
    null
  );
}

// token 失效识别：业务 code!=0 且文案含关键字，或常见鉴权 code
const AUTH_FAIL_CODES = new Set([
  401, 403, 401000, 401001, 401002, 401003,
  10001, 10002, 10010, 10011, 10012,
  20001, 300001, 300003, 400001, 400002, 400003,
  400801, 400802, 400803, 400804,
  500001, 500002,
]);
const AUTH_FAIL_HINT = /token|登录|失效|过期|未授权|鉴权|认证|无效|请重新|login|unauthorized|forbidden/i;

function isAuthFail(result) {
  if (!result || typeof result !== "object") return false;
  const code = Number(result.code);
  const msg = String(result.msg || result.message || "");
  if (code === 0 || Number.isNaN(code)) return false;
  if (AUTH_FAIL_CODES.has(code) && /token|登录|失效|过期|未授权|鉴权|认证|无效|重新登录|login|unauthorized|forbidden/i.test(msg)) {
    return true;
  }
  // 文案明确提 token/登录失效
  if (AUTH_FAIL_HINT.test(msg) && code !== 400804) {
    // 400804 是“账号已经恢复”，不算失效
    if (/token|登录失效|过期|未授权|请重新登录|unauthorized/i.test(msg)) return true;
  }
  return false;
}

// 从客户端最新日志刷新 token（雷神重新登录会写入新 token）
let lastTokenLog = "";
function refreshTokenFromLogs(current) {
  try {
    const files = fs
      .readdirSync(LLOGS)
      .filter((f) => f.startsWith("http-") && f.endsWith(".log"))
      .sort()
      .reverse();
    for (const f of files) {
      const text = fs.readFileSync(path.join(LLOGS, f), "utf8");
      const m = text.match(/account_token=([A-Za-z0-9]+)/g);
      if (m && m.length) {
        const t = m[m.length - 1].replace("account_token=", "");
        if (t && t !== current && t !== lastTokenLog) {
          lastTokenLog = t;
          return t;
        }
        return t === current ? current : t;
      }
    }
  } catch (e) {
    log("刷新 token 读日志失败:", e.message);
  }
  return current;
}

// ---------- API ----------
function buildQuery(token) {
  const params = new URLSearchParams({ ...getQueryParams(), account_token: token });
  return params.toString();
}

async function callApiOnce(base, apiPath, token, payload = {}) {
  const url = `${base}${apiPath}?${buildQuery(token)}`;
  const body = encrypt(payload);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "leigod/11.3.3.0",
    },
    body,
  });
  const text = await res.text();
  let data;
  try {
    data = decrypt(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data, url: apiPath, tokenUsed: token };
}

// 带 token 失效自动刷新 + 重试一次
async function callApi(base, apiPath, token, payload = {}, state = {}) {
  let tok = token;
  let r = await callApiOnce(base, apiPath, tok, payload);
  if (isAuthFail(r.data)) {
    log(`token 疑似失效 (${apiPath} code=${r.data?.code} msg=${r.data?.msg})，尝试从日志刷新...`);
    const fresh = refreshTokenFromLogs(tok);
    if (fresh && fresh !== tok) {
      log("已换新 token:", fresh.slice(0, 6) + "****");
      if (state) state.token = fresh;
      tok = fresh;
      r = await callApiOnce(base, apiPath, tok, payload);
      if (isAuthFail(r.data)) {
        log(`刷新后仍失败 (${apiPath} code=${r.data?.code} msg=${r.data?.msg})`);
      } else {
        log("刷新 token 后重试成功");
      }
    } else {
      log("日志里没有更新的 token，请重新打开雷神客户端登录一次，下次会自动读取。");
    }
  }
  if (state) state.token = tok;
  return r;
}

const API = {
  pause: (token, state) => callApi("https://api1.leigod.com", "/client/pause", token, {}, state),
  recover: (token, state) => callApi("https://api1.leigod.com", "/client/recover", token, {}, state),
  pauseStatus: (token, state) =>
    callApi("https://api1.leigod.com", "/client/pause/status", token, {}, state),
  timeStatus: (token, state) =>
    callApi("https://secapiv11.leigod.com", "/client/user/time/status", token, {}, state),
};

// ---------- 进程监控 ----------
function isLeigodRunning() {
  // Git Bash 会把 tasklist /FI 的 /FI 当成路径，改用 PowerShell
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-Process -Name 'leigod' -ErrorAction SilentlyContinue | Measure-Object).Count"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const n = parseInt(out.trim(), 10);
    return Number.isFinite(n) && n > 0;
  } catch {
    return false;
  }
}

function log(...args) {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  const line = `[${ts}] ` + args.map(String).join(" ");
  console.log(line);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + String.fromCharCode(10));
  } catch (_) {}
}

// ---------- 命令 ----------
async function cmdStatus(token, state) {
  log("查询暂停状态...");
  const s = await API.pauseStatus(token, state);
  log("pause/status:", JSON.stringify(s.data));
  log("查询时长状态...");
  const t = await API.timeStatus(token, state);
  log("time/status:", JSON.stringify(t.data));
}

async function cmdPause(token, state) {
  log("发送暂停...");
  const r = await API.pause(token, state);
  log("pause =>", r.status, JSON.stringify(r.data));
  if (r.data && r.data.code !== 0 && !isAuthFail(r.data)) {
    log("暂停返回非 0 code，若反复出现请检查账户状态。");
  }
  return r;
}

async function cmdRecover(token, state) {
  log("发送恢复...");
  const r = await API.recover(token, state);
  log("recover =>", r.status, JSON.stringify(r.data));
  return r;
}

async function cmdWatch(token, { autoRecover = false } = {}) {
  const st = { token };
  let wasRunning = isLeigodRunning();
  log(`开始监控 ${PROCESS_NAME} (当前: ${wasRunning ? "运行中" : "未运行"})`);
  if (autoRecover && wasRunning) {
    log("启动时自动 recover");
    await cmdRecover(st.token, st).catch((e) => log("recover 失败", e.message));
  }

  let tick = 0;
  setInterval(async () => {
    // 每 5 分钟尝试从雷神日志同步一次 token（防止过期后一直用旧值）
    if (tick % 100 === 0 && tick > 0) {
      const t2 = refreshTokenFromLogs(st.token);
      if (t2 && t2 !== st.token) {
        log("定期同步 token:", t2.slice(0, 6) + "****");
        st.token = t2;
      }
    }
    const running = isLeigodRunning();
    // 每 20 次（约 60 秒）打一次心跳，确认监控存活
    if (++tick % 20 === 0) {
      log(`心跳: leigod ${running ? "运行中" : "未运行"}`);
    }
    if (wasRunning && !running) {
      log("检测到 leigod 退出，自动暂停时长");
      try {
        await cmdPause(st.token, st);
        log("自动暂停完成");
      } catch (e) {
        log("自动暂停失败:", e.message);
      }
    } else if (!wasRunning && running) {
      log("检测到 leigod 启动");
      if (autoRecover) {
        try {
          await cmdRecover(st.token, st);
          log("自动恢复完成");
        } catch (e) {
          log("自动恢复失败:", e.message);
        }
      }
    }
    wasRunning = running;
  }, 3000);
}

// ---------- 入口 ----------
async function main() {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith("-")) || "status";
  const tokenArg = args.find((a) => a.startsWith("--token="));
  const cliToken = tokenArg ? tokenArg.split("=")[1] : null;
  const autoRecover = args.includes("--auto-recover");

  const token = resolveToken(cliToken);
  if (!token) {
    console.error(
      "未找到 account_token。请设置 LEIGOD_TOKEN 环境变量，或使用 --token=xxx，\n" +
        "或确保雷神客户端曾运行过（可从 llogs/http-*.log 解析）。"
    );
    process.exit(1);
  }
  log("llogs 目录:", LLOGS);
  {
    const q = getQueryParams();
    log("查询参数: client_version=" + q.client_version + " hardware_id=" + q.hardware_id.slice(0, 16) + "... region=" + q.province + "/" + q.city_name_cn + " channel=" + q.src_channel);
  }
  log("account_token:", token.slice(0, 6) + "****");

  switch (cmd) {
    case "status":
      await cmdStatus(token);
      break;
    case "pause":
      await cmdPause(token);
      break;
    case "recover":
    case "resume":
      await cmdRecover(token);
      break;
    case "watch":
      await cmdWatch(token, { autoRecover });
      break;
    default:
      console.log("用法: node leigod_pause.js [status|pause|recover|watch] [--token=xxx] [--auto-recover]");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
