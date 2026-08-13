/**
 * ByClaw 桌面端主进程 v2
 * - 本地静态服务：托管 byclaw-fe 构建产物
 * - HTTP/WS 代理：/byaiService 等请求转发到线上 8080 网关
 * - 本地 Agent sidecar：随应用启停 worker，托盘状态显示
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from "electron";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";
import { makeDotIcon, STATUS_COLORS } from "./lib/icons.mjs";
import { loadConfig } from "./lib/config.mjs";
import { startWorker as launchWorker } from "./worker/worker-launcher.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 加载配置（用户配置目录 ~/.config/byclaw/config.json，兜底 online.env）──
const { config: CFG, source: CFG_SOURCE } = loadConfig();
console.log(`[desktop] config source: ${CFG_SOURCE}`);

// ── 配置 ──────────────────────────────────────────────
const API_TARGET = CFG.apiBaseUrl;
const FE_DIST =
  process.env.BYCLAW_FE_DIST ||
  path.join(__dirname, "renderer");
const LOCAL_PORT = Number(process.env.BYCLAW_DESKTOP_PORT || 38080);
const WORKER_SCRIPT =
  process.env.BYCLAW_WORKER_SCRIPT ||
  CFG.worker.script ||
  path.join(__dirname, "..", "worker", "start-worker.sh");
const WORKER_ONLINE_KEY =
  process.env.BYCLAW_WORKER_ONLINE_KEY ||
  `byai_gateway:registry:worker:online:byai-channel-worker-${CFG.userCode}`;
const REDIS_INFO = {
  host: process.env.REDIS_HOST || CFG.redis.host || "",
  port: Number(process.env.REDIS_PORT || CFG.redis.port || 6379),
  password: process.env.REDIS_PASSWORD || CFG.redis.password || "",
};

let mainWindow = null;
let tray = null;
let workerProc = null;
let agentOnline = false;
let workerManaged = false; // 当前 worker 是否由桌面端托管（spawn 的）
let isQuitting = false;

// ── 代理 ──────────────────────────────────────────────
// 上游连接复用（keep-alive）：高频轮询不再反复建连；
// freeSocketTimeout 15s：空闲连接及时销毁，避免复用被线上 Nginx 断开的死连接导致请求挂起
// timeout 120s：SSE 流式长连接留足余量（LLM 首词前可能长时间无数据）
const upstreamAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  keepAliveMsecs: 5000,
  maxFreeSockets: 16,
  freeSocketTimeout: 15000,
  timeout: 120000,
});

const proxy = httpProxy.createProxyServer({
  target: API_TARGET,
  changeOrigin: true,
  ws: true,
  xfwd: true,
  agent: upstreamAgent,
  timeout: 120000,
  proxyTimeout: 120000,
});

proxy.on("error", (err, req, res) => {
  console.error(`[proxy] ${req.url}: ${err.message}`);
  if (res && !res.headersSent) {
    res.writeHead(502);
    res.end("Bad Gateway");
  }
});

// ── 静态服务 ──────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  if (urlPath === "/") urlPath = "/index.html";
  let file = path.join(FE_DIST, urlPath);
  if (!file.startsWith(FE_DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(FE_DIST, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found：门户页面缺失（renderer 未构建？请先运行 npm run build:renderer）");
      return;
    }
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000",
  });
  fs.createReadStream(file).pipe(res);
}

// ── 全局错误捕获（落盘，便于无终端/弹窗不可复制场景排查）──
function logError(scope, err) {
  const line = `[${new Date().toISOString()}] [${scope}] ${err?.stack || err}`;
  try {
    if (CFG.worker.localRoot) {
      const logDir = path.join(CFG.worker.localRoot, "logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, "desktop.log"), line + "\n");
    }
  } catch { /* 日志失败不阻塞 */ }
  console.error(line);
}
process.on("uncaughtException", (e) => logError("uncaughtException", e));
process.on("unhandledRejection", (e) => logError("unhandledRejection", e));

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/byaiService") || url.startsWith("/v1/sandboxes")) {
    proxy.web(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";
  // 线上 Nginx 未配置 WebSocket 转发（502/挂起），快速失败让前端重连，避免 read ETIMEDOUT 长时间挂住
  if (url.startsWith("/byaiService/ws")) {
    socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (url.startsWith("/byaiService") || url.startsWith("/v1/sandboxes")) {
    proxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

// ── Agent 状态检测（Redis worker online key）──────────
function checkAgentOnline() {
  return new Promise((resolve) => {
    let buf = "";
    const sock = net.connect(
      { host: REDIS_INFO.host, port: REDIS_INFO.port, timeout: 3000 },
      () => {
        sock.write(`AUTH ${REDIS_INFO.password}\r\nEXISTS ${WORKER_ONLINE_KEY}\r\n`);
      },
    );
    sock.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/:(\d+)\r\n/);
      if (m) {
        sock.destroy();
        resolve(m[1] === "1");
      }
    });
    sock.on("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function refreshAgentStatus() {
  const online = await checkAgentOnline();
  if (online !== agentOnline) {
    const wasOnline = agentOnline;
    agentOnline = online;
    updateTray();
    console.log(`[desktop] agent status: ${online ? "ONLINE" : "OFFLINE"}`);
    // 外部 worker 掉线（含启动时残留 key 过期）→ 桌面端接管拉起
    if (wasOnline && !online && !workerManaged && !workerProc) {
      console.log("[desktop] external worker went offline, taking over…");
      startWorker();
    }
  }
  // 托管的 worker 进程死了但 Redis 还在线（心跳窗口期）→ 重启
  if (online && workerManaged && workerProc && workerProc.exitCode !== null) {
    console.log("[desktop] worker process exited, restarting…");
    startWorker();
  }
}

/**
 * 方案 A：桌面端全托管 worker。
 * 启动时探测 Redis 在线状态：已有外部 worker 在线 → 跟随显示（不重复拉起，避免 gateway 锁冲突）；
 * 不在线 → 由桌面端 spawn 托管。
 */
async function ensureWorker() {
  await refreshAgentStatus();
  if (agentOnline) {
    console.log("[desktop] external worker online, desktop follows (not managed)");
    workerManaged = false;
    return;
  }
  startWorker();
}

// ── Worker sidecar ────────────────────────────────────
function startWorker() {
  if (workerProc && workerProc.exitCode === null) return;
  workerManaged = true;
  console.log("[desktop] starting local agent worker…");
  // 纯 JS 启动器（worker-launcher.mjs）：配置派生 env + node 跑 openclaw CLI（跨平台）
  workerProc = launchWorker({
    USER_CODE: CFG.userCode,
    REDIS_HOST: CFG.redis.host,
    REDIS_PORT: String(CFG.redis.port ?? 6379),
    REDIS_PASSWORD: CFG.redis.password || "",
    REDIS_MODE: CFG.redis.mode || "standalone",
    REDIS_KEY_SCHEMA_VERSION: CFG.redis.keySchemaVersion || "v1",
    BY_FRAMEWORK_READ_BLOCK_MS: String(CFG.worker.readBlockMs ?? 100),
    BYAI_GROUP_CHAT_CONTEXT_BASE_URL: CFG.worker.groupChatContextBaseUrl || CFG.apiBaseUrl,
    ...(CFG.worker.localRoot
      ? {
          OPENCLAW_STATE_DIR: path.join(CFG.worker.localRoot, "runtime"),
          OPENCLAW_CONFIG_PATH: path.join(CFG.worker.localRoot, "config", "openclaw.json"),
        }
      : {}),
  });
  workerProc.stdout.on("data", (d) => {
    const s = d.toString().trim();
    if (s) console.log(`[worker] ${s}`);
  });
  workerProc.stderr.on("data", (d) => {
    const s = d.toString().trim();
    if (s) console.error(`[worker:err] ${s}`);
  });
  workerProc.on("exit", (code) => {
    console.log(`[desktop] worker exited (code=${code})`);
    agentOnline = false;
    updateTray();
    // 主动退出（isQuitting）或锁冲突（78，已有其他 gateway 实例）不自动重启；
    // 其余情况（崩溃/被杀/异常退出）3s 后自动重启
    if (!isQuitting && code !== 78) {
      setTimeout(() => {
        if (!isQuitting) startWorker();
      }, 3000);
    }
  });
}

function stopWorker() {
  if (workerProc && workerProc.exitCode === null) {
    workerProc.kill("SIGTERM");
    // 兜底：5s 后强杀
    setTimeout(() => {
      if (workerProc && workerProc.exitCode === null) workerProc.kill("SIGKILL");
    }, 5000);
  }
}

// ── 托盘 ──────────────────────────────────────────────
function trayIcon(status) {
  const buf = makeDotIcon(22, STATUS_COLORS[status] || STATUS_COLORS.offline);
  return nativeImage.createFromBuffer(buf);
}

function updateTray() {
  if (!tray) return;
  const status = agentOnline ? "online" : "offline";
  tray.setImage(trayIcon(status));
  tray.setToolTip(`ByClaw 本地 Agent：${agentOnline ? "在线" : "离线"}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 ByClaw 桌面端", click: () => showWindow() },
      {
        label: `本地 Agent：${agentOnline ? "在线" : "离线"}`,
        enabled: false,
      },
      {
        label: agentOnline ? "重启本地 Agent" : "启动本地 Agent",
        click: () => {
          if (agentOnline) stopWorker();
          setTimeout(() => startWorker(), 800);
        },
      },
      { type: "separator" },
      { label: "退出", click: () => quitApp() },
    ]),
  );
}

// ── 窗口 ──────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "ByClaw 桌面端",
    autoHideMenuBar: true,
    icon: trayIcon("online"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${LOCAL_PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  // 关闭窗口 → 最小化到托盘（Agent 继续跑）
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  isQuitting = true;
  stopWorker();
  app.quit();
}

// ── 生命周期 ──────────────────────────────────────────
app.whenReady().then(() => {
  server.on("error", (e) => {
    console.error(`[desktop] server error: ${e.message}`);
  });
  server.listen(LOCAL_PORT, "127.0.0.1", () => {
    console.log(`[desktop] local server listening on ${LOCAL_PORT}`);
  });

  tray = new Tray(trayIcon("offline"));
  tray.setToolTip("ByClaw 本地 Agent：启动中…");
  updateTray();
  tray.on("click", () => showWindow());

  ensureWorker();
  setInterval(refreshAgentStatus, 10000);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // 托盘驻留，不退出
});

app.on("before-quit", () => {
  isQuitting = true;
});


app.on("window-all-closed", () => {
  // 托盘驻留，不退出
});

app.on("before-quit", () => {
  isQuitting = true;
});
