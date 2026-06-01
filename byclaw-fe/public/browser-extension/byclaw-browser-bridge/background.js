const STORAGE_KEY = "byclawCaptureBinding";
const BRIDGE_CLIENT_ID_KEY = "byclawBridgeClientId";
const PLUGIN_VERSION = "0.3.0";
const PROTOCOL_VERSION = "1.1";
const TOKEN_EXPIRY_SOON_MS = 10 * 60 * 1000;
const BRIDGE_TYPE = "ECOSYSTEM_BRIDGE";

let bridgeSocket = null;
let bridgeReconnectTimer = null;
let bridgeHeartbeatTimer = null;
let bridgeStatus = {
  connected: false,
  message: "未连接",
  lastEvent: "",
  lastHeartbeatAt: "",
};
const activeBridgeTasks = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BYCLAW_SAVE_BINDING") {
    const binding = enrichBinding(message.payload || {});
    chrome.storage.local.set({ [STORAGE_KEY]: binding }, () => {
      startBridge().catch(() => undefined);
      extensionStatus().then((status) => sendResponse({ ok: true, status }));
    });
    return true;
  }

  if (message?.type === "BYCLAW_GET_BINDING") {
    getBinding().then((binding) => sendResponse({ ok: true, binding }));
    return true;
  }

  if (message?.type === "BYCLAW_GET_EXTENSION_STATUS") {
    extensionStatus().then((status) => sendResponse({ ok: true, status }));
    return true;
  }

  if (message?.type === "BYCLAW_CLEAR_BINDING") {
    clearBinding().then((status) => sendResponse({ ok: true, status }));
    return true;
  }

  if (message?.type === "BYCLAW_START_BRIDGE") {
    startBridge()
      .then(() => sendResponse({ ok: true, status: bridgeStatus }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error), status: bridgeStatus }));
    return true;
  }

  if (message?.type === "BYCLAW_STOP_BRIDGE") {
    stopBridge("用户已停止 Browser Bridge");
    sendResponse({ ok: true, status: bridgeStatus });
    return true;
  }

  if (message?.type === "BYCLAW_GET_BRIDGE_STATUS") {
    sendResponse({ ok: true, status: bridgeStatus });
    return true;
  }

  return undefined;
});

chrome.runtime.onStartup?.addListener(() => {
  startBridge().catch(() => undefined);
});

chrome.runtime.onInstalled?.addListener(() => {
  startBridge().catch(() => undefined);
});

async function startBridge() {
  const binding = await getBinding();
  if (!binding?.portalOrigin) {
    updateBridgeStatus(false, "未绑定门户配置");
    throw new Error("Please bind the extension from ByClaw knowledge center first.");
  }
  const token = resolveBeyondToken(binding);
  if (!token) {
    updateBridgeStatus(false, "缺少 beyond-token");
    throw new Error("Missing beyond-token in binding.");
  }
  const currentTokenStatus = tokenStatus(binding);
  if (currentTokenStatus.status === "EXPIRED") {
    updateBridgeStatus(false, "登录态已过期，请回到 ByClaw 重新绑定插件配置");
    throw new Error("ByClaw login token has expired. Please rebind the extension from the portal.");
  }
  if (bridgeSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(bridgeSocket.readyState)) {
    return bridgeStatus;
  }

  clearTimeout(bridgeReconnectTimer);
  const wsUrl = buildBridgeWebSocketUrl(binding, token);
  bridgeSocket = new WebSocket(wsUrl);
  updateBridgeStatus(false, "正在连接 Browser Bridge");

  bridgeSocket.addEventListener("open", () => {
    updateBridgeStatus(true, "Browser Bridge 已连接");
    getBridgeClientId().then(async (bridgeClientId) => {
      sendBridgeAction("BIND", await bridgeHeartbeatPayload(binding, bridgeClientId));
      sendBridgeAction("PULL_TASKS", { bridgeClientId });
      startBridgeHeartbeat(binding, bridgeClientId);
    });
  });

  bridgeSocket.addEventListener("message", (event) => {
    handleBridgeMessage(event.data).catch((error) => {
      updateBridgeStatus(false, error.message || String(error));
    });
  });

  bridgeSocket.addEventListener("close", () => {
    updateBridgeStatus(false, "Browser Bridge 已断开，等待重连");
    stopBridgeHeartbeat();
    scheduleBridgeReconnect();
  });

  bridgeSocket.addEventListener("error", () => {
    updateBridgeStatus(false, "Browser Bridge 连接异常");
  });

  return bridgeStatus;
}

function stopBridge(message) {
  clearTimeout(bridgeReconnectTimer);
  stopBridgeHeartbeat();
  if (bridgeSocket) {
    bridgeSocket.close();
    bridgeSocket = null;
  }
  updateBridgeStatus(false, message || "Browser Bridge 已停止");
}

function startBridgeHeartbeat(binding, bridgeClientId) {
  stopBridgeHeartbeat();
  bridgeHeartbeatTimer = setInterval(async () => {
    sendBridgeAction("HEARTBEAT", await bridgeHeartbeatPayload(binding, bridgeClientId));
  }, 30000);
}

function stopBridgeHeartbeat() {
  if (bridgeHeartbeatTimer) {
    clearInterval(bridgeHeartbeatTimer);
    bridgeHeartbeatTimer = null;
  }
}

function scheduleBridgeReconnect() {
  if (bridgeReconnectTimer) {
    return;
  }
  bridgeReconnectTimer = setTimeout(() => {
    bridgeReconnectTimer = null;
    startBridge().catch(() => undefined);
  }, 5000);
}

async function handleBridgeMessage(rawMessage) {
  const message = JSON.parse(rawMessage || "{}");
  if (message.type !== BRIDGE_TYPE) {
    return;
  }
  bridgeStatus.lastEvent = message.event || "";
  if (message.event === "TASK") {
    await claimBridgeTask(message.data || {});
    return;
  }
  if (message.event === "TASK_LIST") {
    const tasks = message.data?.tasks || [];
    for (const task of tasks) {
      await claimBridgeTask(task);
    }
    return;
  }
  if (message.event === "CLAIM_ACCEPTED") {
    await handleClaimAccepted(message.data || {});
    return;
  }
  if (message.event === "LEASE_RENEWED") {
    handleLeaseRenewed(message.data || {});
    return;
  }
  if (message.event === "CANCEL_TASK") {
    cancelBridgeTask(String(message.data?.runId || ""));
  }
}

async function claimBridgeTask(task) {
  const runId = String(task.runId || "");
  if (!runId || activeBridgeTasks.has(runId)) {
    return;
  }
  const bridgeClientId = await getBridgeClientId();
  const taskState = { cancelled: false, tabId: null, task, bridgeClientId, leaseId: "", leaseTimer: null };
  activeBridgeTasks.set(runId, taskState);
  sendBridgeAction("CLAIM_TASK", { runId, bridgeClientId });
}

async function handleClaimAccepted(data) {
  const runId = String(data.runId || "");
  const taskState = activeBridgeTasks.get(runId);
  if (!taskState) {
    return;
  }
  if (!data.claimed) {
    activeBridgeTasks.delete(runId);
    updateBridgeStatus(true, data.message || "任务租约被其他采集端持有");
    return;
  }
  taskState.leaseId = data.leaseId;
  taskState.leaseExpiresAtMs = data.leaseExpiresAtMs;
  taskState.task = data.task || taskState.task;
  startLeaseRenewal(runId, taskState, data.leaseTtlMs || taskState.task?.lease?.ttlMs || 120000);
  await executeClaimedBridgeTask(taskState.task, taskState);
}

function handleLeaseRenewed(data) {
  const taskState = activeBridgeTasks.get(String(data.runId || ""));
  if (taskState) {
    taskState.leaseExpiresAtMs = data.leaseExpiresAtMs;
  }
}

function startLeaseRenewal(runId, taskState, leaseTtlMs) {
  clearLeaseRenewal(taskState);
  const intervalMs = Math.max(15000, Math.floor(Number(leaseTtlMs || 120000) / 2));
  taskState.leaseTimer = setInterval(() => {
    if (taskState.cancelled) {
      clearLeaseRenewal(taskState);
      return;
    }
    sendBridgeAction("RENEW_LEASE", {
      runId,
      leaseId: taskState.leaseId,
      bridgeClientId: taskState.bridgeClientId,
    });
  }, intervalMs);
}

function clearLeaseRenewal(taskState) {
  if (taskState?.leaseTimer) {
    clearInterval(taskState.leaseTimer);
    taskState.leaseTimer = null;
  }
}

async function executeClaimedBridgeTask(task, taskState) {
  const runId = String(task.runId || "");
  try {
    assertBridgeTaskAllowed(task);
    const context = { task, tabId: null, page: null, screenshotDataUrl: "" };
    const commands = task.commands?.length ? task.commands : defaultBridgeCommands(task);
    for (let index = 0; index < commands.length; index += 1) {
      ensureTaskNotCancelled(taskState);
      await executeBridgeCommand(commands[index], context, taskState, index, commands.length);
    }
    const page = context.page || {};
    const assetCount = context.screenshotDataUrl ? 1 : 0;
    sendBridgeAction("TASK_RESULT", {
      runId,
      leaseId: taskState.leaseId,
      bridgeClientId: taskState.bridgeClientId,
      title: page.title,
      sourceUrl: page.sourceUrl || task.sourceUrl,
      markdown: page.markdown,
      html: page.html,
      text: page.text,
      extractionMode: page.extractionMode,
      contentLength: page.contentLength,
      pagination: page.pagination,
      screenshotDataUrl: context.screenshotDataUrl,
      assetCount,
    });
  } catch (error) {
    if (taskState.cancelled) {
      sendBridgeAction("TASK_CANCELLED", {
        runId,
        leaseId: taskState.leaseId,
        bridgeClientId: taskState.bridgeClientId,
      });
      return;
    }
    sendBridgeAction("TASK_FAILED", {
      runId,
      leaseId: taskState.leaseId,
      bridgeClientId: taskState.bridgeClientId,
      currentStep: "PULL_RAW",
      errorMessage: error.message || String(error),
    });
  } finally {
    clearLeaseRenewal(taskState);
    activeBridgeTasks.delete(runId);
  }
}

async function executeBridgeCommand(command, context, taskState, index, total) {
  const action = command.action;
  sendTaskProgress(context.task, taskState, action, Math.min(90, Math.floor((index / Math.max(total, 1)) * 80) + 10));
  try {
    if (action === "open") {
      const tab = await openTaskTab(command.url || context.task.sourceUrl, {
        allowedHosts: command.allowedHosts || context.task.allowedHosts || [],
        preferExisting: command.preferExisting !== false,
      });
      context.tabId = tab.id;
      taskState.tabId = tab.id;
      if (command.waitUntil === "complete") {
        await waitForTabComplete(tab.id, command.timeoutMs || commandTimeout(context.task, "waitForReady", 30000));
      }
      return;
    }
    if (action === "waitForReady") {
      await waitForTabComplete(context.tabId, command.timeoutMs || 30000);
      return;
    }
    if (action === "screenshot") {
      const tab = await chrome.tabs.get(context.tabId);
      context.screenshotDataUrl = await captureVisibleScreenshot(tab);
      return;
    }
    if (["waitForSelector", "scroll", "extract", "collectMailbox", "click", "input"].includes(action)) {
      const result = await chrome.tabs.sendMessage(context.tabId, {
        type: "BYCLAW_BRIDGE_COMMAND",
        command,
      });
      if (action === "extract" || action === "collectMailbox") {
        context.page = result;
      }
    }
  } catch (error) {
    if (!command.optional) {
      throw error;
    }
  }
}

function sendTaskProgress(task, taskState, currentCommand, progress) {
  sendBridgeAction("TASK_PROGRESS", {
    runId: String(task.runId || ""),
    leaseId: taskState.leaseId,
    bridgeClientId: taskState.bridgeClientId,
    currentStep: ["extract", "collectMailbox"].includes(currentCommand) ? "NORMALIZE_MARKDOWN" : "PULL_RAW",
    currentCommand,
    message: `Browser Bridge 正在执行：${currentCommand}`,
    progress,
  });
}

function defaultBridgeCommands(task) {
  return [
    { action: "open", url: task.sourceUrl, waitUntil: "complete" },
    { action: "waitForReady", timeoutMs: 30000 },
    { action: "scroll", direction: "bottom", stepPx: 900, maxSteps: 8, delayMs: 350, optional: true },
    { action: "extract", formats: ["markdown", "html", "text"], includeImages: true },
    { action: "screenshot", optional: true },
  ];
}

function cancelBridgeTask(runId) {
  const taskState = activeBridgeTasks.get(runId);
  if (!taskState) {
    return;
  }
  taskState.cancelled = true;
  if (taskState.tabId) {
    chrome.tabs.remove(taskState.tabId).catch(() => undefined);
  }
}

function assertBridgeTaskAllowed(task) {
  if (!task.sourceUrl) {
    throw new Error("Browser Bridge task sourceUrl is required.");
  }
  const sourceHost = new URL(task.sourceUrl).hostname.toLowerCase();
  const allowedHosts = task.allowedHosts || [];
  const matched = allowedHosts.some((allowedHost) => hostMatches(sourceHost, allowedHost));
  if (!matched) {
    throw new Error(`Source host is not allowed: ${sourceHost}`);
  }
}

function hostMatches(host, allowedHost) {
  const allowed = String(allowedHost || "").toLowerCase();
  return Boolean(allowed) && (host === allowed || host.endsWith(`.${allowed}`));
}

function ensureTaskNotCancelled(taskState) {
  if (taskState.cancelled) {
    throw new Error("Browser Bridge task cancelled.");
  }
}

async function openTaskTab(sourceUrl, options = {}) {
  const existingTab = options.preferExisting === false ? null : await findExistingTaskTab(sourceUrl, options.allowedHosts);
  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId) {
      await chrome.windows.update(existingTab.windowId, { focused: true }).catch(() => undefined);
    }
    return existingTab;
  }
  return chrome.tabs.create({ url: sourceUrl, active: true });
}

async function findExistingTaskTab(sourceUrl, allowedHosts = []) {
  const expectedHosts = normalizeAllowedHosts(sourceUrl, allowedHosts);
  if (!expectedHosts.length) {
    return null;
  }
  const tabs = await chrome.tabs.query({});
  return (
    tabs.find((tab) => {
      try {
        const host = new URL(tab.url || "").hostname.toLowerCase();
        return expectedHosts.some((allowedHost) => hostMatches(host, allowedHost));
      } catch (error) {
        return false;
      }
    }) || null
  );
}

function normalizeAllowedHosts(sourceUrl, allowedHosts = []) {
  const hosts = [...allowedHosts];
  try {
    const sourceHost = new URL(sourceUrl || "").hostname;
    if (sourceHost) {
      hosts.unshift(sourceHost);
    }
  } catch (error) {
    // Some task URLs, such as imaps://, are not browser URLs. Use allowedHosts only.
  }
  return hosts.map((host) => String(host || "").toLowerCase()).filter(Boolean);
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error("Timed out waiting for page ready."));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          finish();
        }
      })
      .catch(() => undefined);
  });
}

function commandTimeout(task, action, defaultValue) {
  const command = (task.commands || []).find((item) => item.action === action);
  return Number(command?.timeoutMs || defaultValue);
}

function sendBridgeAction(action, payload) {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
    return false;
  }
  bridgeSocket.send(
    JSON.stringify({
      type: BRIDGE_TYPE,
      extParams: {
        action,
        ...(payload || {}),
      },
    })
  );
  return true;
}

async function getBridgeClientId() {
  const data = await chrome.storage.local.get(BRIDGE_CLIENT_ID_KEY);
  if (data[BRIDGE_CLIENT_ID_KEY]) {
    return data[BRIDGE_CLIENT_ID_KEY];
  }
  const bridgeClientId = crypto.randomUUID();
  await chrome.storage.local.set({ [BRIDGE_CLIENT_ID_KEY]: bridgeClientId });
  return bridgeClientId;
}

async function bridgeHeartbeatPayload(binding, bridgeClientId) {
  const currentTokenStatus = tokenStatus(binding);
  return {
    bridgeClientId,
    agentName: "ByClaw Browser Bridge",
    runtimeName: "ByClaw 浏览器插件",
    runtimeVersion: PLUGIN_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    browserBridgeStatus: "CONNECTED",
    chromeProfile: "browser-extension",
    status: "ONLINE",
    tokenStatus: currentTokenStatus.status,
    tokenExpiresAt: currentTokenStatus.expiresAt,
    siteSessions: await collectSiteSessions(),
    language: binding.language || "zh-CN",
  };
}

async function collectSiteSessions() {
  const sessions = [];
  const qqmail = await detectQqMailSession();
  if (qqmail) {
    sessions.push(qqmail);
  }
  return sessions;
}

async function detectQqMailSession() {
  const tabs = await chrome.tabs.query({ url: ["*://mail.qq.com/*", "*://*.mail.qq.com/*", "*://exmail.qq.com/*", "*://*.exmail.qq.com/*", "*://mail.tencent.com/*", "*://*.mail.tencent.com/*"] });
  if (!tabs.length) {
    return null;
  }
  let fallback = null;
  for (const tab of tabs) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "BYCLAW_BRIDGE_COMMAND",
        command: { action: "detectMailboxSession", provider: "qqmail" },
      });
      const session = {
        siteCode: "qqmail",
        siteName: "QQ 邮箱",
        status: result?.loggedIn ? "LOGGED_IN" : "NEED_LOGIN",
        statusName: result?.loggedIn ? "已登录" : "未登录",
      };
      if (result?.loggedIn) {
        return session;
      }
      fallback = fallback || session;
    } catch (error) {
      fallback = fallback || {
        siteCode: "qqmail",
        siteName: "QQ 邮箱",
        status: "UNKNOWN",
        statusName: "已打开，登录态待确认",
      };
    }
  }
  return fallback;
}

function buildBridgeWebSocketUrl(binding, token) {
  const origin = new URL(binding.portalOrigin);
  const wsProtocol = origin.protocol === "https:" ? "wss:" : "ws:";
  const wsPath = binding.websocketPath || `${binding.apiBase || "/byaiService"}/ws`;
  const url = new URL(`${wsProtocol}//${origin.host}${wsPath}`);
  url.searchParams.set("beyond-token", token);
  const headers = binding.auth?.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    if (value && key.toLowerCase() !== "beyond-token") {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function resolveBeyondToken(binding) {
  const headers = binding.auth?.headers || {};
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "beyond-token");
  return entry?.[1] || "";
}

function enrichBinding(binding, options = {}) {
  const now = new Date().toISOString();
  const token = resolveBeyondToken(binding);
  return {
    ...binding,
    schemaVersion: 2,
    pluginVersion: PLUGIN_VERSION,
    protocolVersion: binding.protocolVersion || PROTOCOL_VERSION,
    boundAt: options.preserveBoundAt && binding.boundAt ? binding.boundAt : binding.boundAt || now,
    updatedAt: now,
    expiresAt: binding.expiresAt || binding.auth?.tokenExpiresAt || parseJwtExpiresAt(token) || "",
  };
}

function tokenStatus(binding) {
  if (!binding) {
    return { status: "UNBOUND", statusName: "未绑定", expiresAt: "" };
  }
  const token = resolveBeyondToken(binding);
  if (!token) {
    return { status: "MISSING", statusName: "缺少登录态", expiresAt: "" };
  }
  const expiresAt = binding.expiresAt || binding.auth?.tokenExpiresAt || parseJwtExpiresAt(token) || "";
  if (!expiresAt) {
    return { status: "UNKNOWN", statusName: "有效期未知", expiresAt: "" };
  }
  const expiresTime = Date.parse(expiresAt);
  if (!Number.isFinite(expiresTime)) {
    return { status: "UNKNOWN", statusName: "有效期未知", expiresAt };
  }
  const remains = expiresTime - Date.now();
  if (remains <= 0) {
    return { status: "EXPIRED", statusName: "已过期", expiresAt };
  }
  if (remains <= TOKEN_EXPIRY_SOON_MS) {
    return { status: "EXPIRING_SOON", statusName: "即将过期", expiresAt };
  }
  return { status: "VALID", statusName: "有效", expiresAt };
}

function parseJwtExpiresAt(token) {
  if (!token || token.split(".").length < 2) {
    return "";
  }
  try {
    const payload = JSON.parse(decodeBase64Url(token.split(".")[1]));
    const exp = Number(payload.exp || 0);
    return exp ? new Date(exp * 1000).toISOString() : "";
  } catch (error) {
    return "";
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(`${normalized}${padding}`);
}

function updateBridgeStatus(connected, message) {
  bridgeStatus = {
    ...bridgeStatus,
    connected,
    message,
    lastHeartbeatAt: connected ? new Date().toISOString() : bridgeStatus.lastHeartbeatAt,
  };
  chrome.storage.local.set({ byclawBridgeStatus: bridgeStatus }).catch(() => undefined);
}

async function getBinding() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const binding = data[STORAGE_KEY];
  if (binding && binding.schemaVersion !== 2) {
    const migrated = enrichBinding(binding, { preserveBoundAt: true });
    await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
    return migrated;
  }
  return binding;
}

async function clearBinding() {
  await chrome.storage.local.remove([STORAGE_KEY, "byclawBindingWarning"]);
  stopBridge("用户已解绑浏览器插件");
  return extensionStatus();
}

async function extensionStatus() {
  const binding = await getBinding();
  const data = await chrome.storage.local.get(["byclawBindingWarning"]);
  const currentTokenStatus = tokenStatus(binding);
  return {
    installed: true,
    version: PLUGIN_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    binding: {
      bound: Boolean(binding?.portalOrigin),
      targetName: binding?.captureDefaults?.knowledgeBaseName || binding?.captureDefaults?.knowledgeBaseId || "",
      portalOrigin: binding?.portalOrigin || "",
      boundAt: binding?.boundAt || "",
      updatedAt: binding?.updatedAt || "",
      expiresAt: currentTokenStatus.expiresAt,
      tokenStatus: currentTokenStatus.status,
      tokenStatusName: currentTokenStatus.statusName,
      warning: data.byclawBindingWarning || null,
    },
    bridgeStatus,
  };
}

async function captureVisibleScreenshot(tab) {
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch (error) {
    return "";
  }
}
