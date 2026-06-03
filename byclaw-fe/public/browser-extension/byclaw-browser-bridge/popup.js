const statusEl = document.getElementById("status");
const bridgeStatusEl = document.getElementById("bridgeStatus");
const resultEl = document.getElementById("result");
const bridgeBtn = document.getElementById("bridgeBtn");
const refreshBtn = document.getElementById("refreshBtn");
const unbindBtn = document.getElementById("unbindBtn");

bridgeBtn.addEventListener("click", startBridge);
refreshBtn.addEventListener("click", refreshBindingStatus);
unbindBtn.addEventListener("click", unbindCurrentConfig);

refreshBindingStatus();
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 5000);

function refreshBindingStatus() {
  chrome.runtime.sendMessage({ type: "BYCLAW_GET_EXTENSION_STATUS" }, (response) => {
    const status = response?.status || {};
    const binding = status.binding || {};
    const tokenExpired = binding.tokenStatus === "EXPIRED" || binding.tokenStatus === "MISSING";
    if (!binding.bound) {
      statusEl.textContent = "未绑定。请先在 ByClaw 知识中心选择“ByClaw Browser Bridge”，点击“绑定插件配置”。";
      bridgeBtn.disabled = true;
      unbindBtn.disabled = true;
      return;
    }
    const targetName = binding.targetName || "-";
    const expiresText = binding.expiresAt ? `，有效期至：${formatTime(binding.expiresAt)}` : "，有效期未知";
    const warning = binding.warning?.message ? `\n提示：${binding.warning.message}` : "";
    statusEl.textContent = `插件 v${status.version || "-"} · 已绑定：${targetName}\nToken：${
      binding.tokenStatusName || binding.tokenStatus || "-"
    }${expiresText}${warning}`;
    bridgeBtn.disabled = tokenExpired;
    unbindBtn.disabled = false;
  });
}

function refreshBridgeStatus() {
  chrome.runtime.sendMessage({ type: "BYCLAW_GET_EXTENSION_STATUS" }, (response) => {
    const status = response?.status || {};
    const bridgeStatus = status.bridgeStatus || {};
    const tokenBlocked = ["MISSING", "EXPIRED"].includes(status.binding?.tokenStatus);
    bridgeStatusEl.textContent = `桥接通道：${bridgeStatus.message || "未连接"}`;
    bridgeBtn.textContent = bridgeStatus.connected ? "桥接通道已在线" : "重新连接桥接通道";
    bridgeBtn.disabled = Boolean(!status.binding?.bound || tokenBlocked);
  });
}

function startBridge() {
  bridgeBtn.disabled = true;
  bridgeStatusEl.textContent = "桥接通道：正在连接...";
  chrome.runtime.sendMessage({ type: "BYCLAW_START_BRIDGE" }, (response) => {
    if (!response?.ok) {
      bridgeBtn.disabled = false;
      bridgeStatusEl.textContent = `桥接通道：${response?.error || "连接失败"}`;
      return;
    }
    refreshBridgeStatus();
  });
}

function unbindCurrentConfig() {
  unbindBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "BYCLAW_CLEAR_BINDING" }, (response) => {
    resultEl.textContent = response?.ok ? "已解绑，请回到 ByClaw 重新绑定。" : response?.error || "解绑失败";
    refreshBindingStatus();
    refreshBridgeStatus();
  });
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}
