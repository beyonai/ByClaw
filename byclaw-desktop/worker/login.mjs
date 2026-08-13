#!/usr/bin/env node
/**
 * ByClaw 登录换 token 脚本（复现前端 AES-CBC + SM4-ECB 加密）
 *
 * 配置来源（优先）：~/.config/byclaw/config.json
 *   - apiBaseUrl: 线上网关
 *   - auth.username / auth.password / auth.token / auth.sessionId
 * 可用 CLI 参数或环境变量覆盖：node login.mjs [username] [password] [baseUrl]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── 配置加载 ──────────────────────────────────────────
function loadConfig() {
  const cfgPath =
    process.env.BYCLAW_CONFIG_FILE ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "byclaw",
      "config.json",
    );
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return {};
  }
}

const cfg = loadConfig();
const auth = cfg.auth || {};
const username =
  process.argv[2] || process.env.TEST_USERNAME || auth.username || cfg.userCode || "";
const password = process.argv[3] || process.env.TEST_PASSWORD || auth.password || "";
const baseUrl = process.argv[4] || process.env.BYCLAW_BE_BASE_URL || cfg.apiBaseUrl || "";
if (!baseUrl) {
  console.error("[login] ERROR: 未配置 apiBaseUrl（请填写 ~/.config/byclaw/config.json）");
  process.exit(1);
}

// 前端硬编码密钥（byclaw-fe/src/utils/encrypt/）
const AES_KEY = "7b=isMfY<ar1Mox5";
const AES_IV = "nVI;WhjYx+^E!ncs";
const SM4_KEY = "w4H@A9Klm!E06O^8";

function encryptByAES(str) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(AES_KEY, "utf8"), Buffer.from(AES_IV, "utf8"));
  const enc = Buffer.concat([cipher.update(str, "utf8"), cipher.final()]);
  return Buffer.from(enc.toString("hex"), "utf8").toString("base64");
}

function encryptBySM(str) {
  const cipher = crypto.createCipheriv("sm4-ecb", Buffer.from(SM4_KEY, "utf8"), null);
  cipher.setAutoPadding(true);
  const enc = Buffer.concat([cipher.update(str, "utf8"), cipher.final()]);
  return enc.toString("base64");
}

const body = {
  accountCode: encryptByAES(username),
  accountPwd: encryptBySM(password),
  loginType: "5",
  encrypt: 2,
};

console.log(`[login] POST ${baseUrl}/byaiService/system/session/loginByUsername (user=${username})`);
const res = await fetch(`${baseUrl}/byaiService/system/session/loginByUsername`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(`[login] HTTP ${res.status}`);
try {
  const parsed = JSON.parse(text);
  const d = parsed?.data ?? {};
  const token = parsed.token || d.accessToken || d.token || d.beyondToken || d.loginToken;
  console.log(`[login] code=${parsed.code} msg=${parsed.msg} userCode=${d.userCode}`);
  if (token) {
    console.log(`TOKEN=${token}`);
    console.log(`SESSION_ID=${parsed.sessionId || d.sessionId}`);
  } else {
    console.log("[login] 未找到 token 字段，响应顶层字段:", Object.keys(parsed).join(","));
    console.log(text.slice(0, 800));
  }
} catch {
  console.log(text.slice(0, 600));
}
