#!/usr/bin/env node

/**
 * dingtalk-notify.mjs — Send messages to DingTalk via Webhook robot.
 *
 * Input (stdin JSON):
 * {
 *   "msgtype": "markdown",
 *   "markdown": {
 *     "title": "待办同步",
 *     "text": "## Issues 待办\n\n- [ ] #1 修复登录bug\n- [ ] #2 新增功能"
 *   }
 * }
 *
 * Or simplified:
 * {
 *   "title": "待办同步",
 *   "items": [
 *     {"number": 1, "title": "修复登录bug", "assignee": "user1", "url": "..."},
 *     {"number": 2, "title": "新增功能", "assignee": "user2", "url": "..."}
 *   ]
 * }
 *
 * Env: DINGTALK_WEBHOOK_URL (required)
 */

import { createHmac } from "node:crypto";

const webhookUrl = process.env.DINGTALK_WEBHOOK_URL;
const secret = process.env.DINGTALK_WEBHOOK_SECRET || "";

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

if (!webhookUrl) {
  console.log(JSON.stringify({
    ok: false,
    error: "DINGTALK_WEBHOOK_URL not configured",
    auth_required: true,
    message: `钉钉 Webhook 未配置。请在钉钉群中添加自定义机器人，获取 Webhook URL 后设置环境变量：\n\nexport DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx\n\n如果启用了加签，还需设置：\nexport DINGTALK_WEBHOOK_SECRET=SECxxx`,
  }));
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(chunks.join("")));
      } catch (e) {
        reject(new Error(`Invalid JSON input: ${e.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

function signUrl(url, secret) {
  if (!secret) return url;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = encodeURIComponent(
    createHmac("sha256", secret).update(stringToSign).digest("base64")
  );
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}timestamp=${timestamp}&sign=${sign}`;
}

function buildMarkdownFromItems(title, items) {
  const lines = [`## ${title}`, ""];
  for (const item of items) {
    const assignee = item.assignee ? ` @${item.assignee}` : "";
    const link = item.url ? `[#${item.number}](${item.url})` : `#${item.number}`;
    lines.push(`- [ ] ${link} ${item.title}${assignee}`);
  }
  lines.push("", `> 共 ${items.length} 条待办 | ${new Date().toLocaleString("zh-CN")}`);
  return { title, text: lines.join("\n") };
}

async function main() {
  const input = await readStdin();

  let payload;
  if (input.items && Array.isArray(input.items)) {
    const md = buildMarkdownFromItems(input.title || "GitHub Issues 待办", input.items);
    payload = { msgtype: "markdown", markdown: md };
  } else if (input.msgtype) {
    payload = input;
  } else {
    fail("Input must have 'items' array or be a raw DingTalk message payload");
  }

  const url = signUrl(webhookUrl, secret);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.errcode !== 0) {
    fail(`DingTalk API error: ${result.errmsg || JSON.stringify(result)}`);
  }

  console.log(JSON.stringify({ ok: true, data: { sent: true, errcode: 0 } }));
}

main().catch((err) => fail(err.message));
