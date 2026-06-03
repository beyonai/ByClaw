import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLIENT_ID = "Ov23lidZA2zDLSm0gJf5";
const CREDENTIALS_DIR = join(homedir(), ".openclaw", "credentials");
const TOKEN_FILE = join(CREDENTIALS_DIR, "github-token");
const PENDING_FILE = join(CREDENTIALS_DIR, ".github-device-pending");

export function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    if (token) return token;
  } catch {}
  return null;
}

export async function requireGitHubToken() {
  const token = getGitHubToken();
  if (token) return token;

  // Auto-initiate device flow
  try {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: "repo" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (!existsSync(CREDENTIALS_DIR)) mkdirSync(CREDENTIALS_DIR, { recursive: true });
      writeFileSync(PENDING_FILE, JSON.stringify({
        device_code: data.device_code,
        expires_at: Date.now() + data.expires_in * 1000,
        interval: data.interval || 5,
      }), { mode: 0o600 });

      console.log(JSON.stringify({
        ok: false,
        auth_required: true,
        action: "show_to_user",
        verification_uri: data.verification_uri,
        user_code: data.user_code,
        message: `GitHub 需要授权，请在浏览器中完成：\n\n👉 [点击打开授权页面](${data.verification_uri})\n📋 授权码: **${data.user_code}**\n\n完成后告诉我"授权完了"。`,
        next_step: "用户确认授权后执行: node skills/github-code-analysis/scripts/gh-auth-login.mjs --poll",
      }));
      process.exit(1);
    }
  } catch {}

  console.log(JSON.stringify({
    ok: false,
    auth_required: true,
    message: "GitHub 未授权且无法发起 Device Flow。请手动运行: node skills/github-code-analysis/scripts/gh-auth-login.mjs --start",
  }));
  process.exit(1);
}
