import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendDocumentationNotification } from "./notification.js";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
});

describe("sendDocumentationNotification", () => {
  it("adds DingTalk timestamp and HMAC-SHA256 sign when secret is configured", async () => {
    Date.now = () => 1781760000000;
    const secret = "SEC-example";
    const expectedSign = createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(`${Date.now()}\n${secret}`, "utf8")
      .digest("base64");
    let requestedUrl = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const result = await sendDocumentationNotification({
      config: {
        webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=token",
        dingtalkSecret: secret,
        dingtalkActionCardBtnTitle: "通过",
        dingtalkActionCardBtnUrl: "",
        robotType: "dingtalk",
        maxOutputChars: 3000,
        minOutputChars: 1,
      },
      repository: {
        id: "byclaw",
        remoteUrl: "https://github.com/beyonai/ByClaw.git",
        branch: "develop",
        localPath: "/tmp/byclaw",
      },
      question: "如何上传 Skill？",
      documentMarkdown: "## 如何上传 Skill\n\n### 操作步骤\n1. 点击「上传」。",
    });

    const url = new URL(requestedUrl);
    assert.equal(result.ok, true);
    assert.equal(url.searchParams.get("access_token"), "token");
    assert.equal(url.searchParams.get("timestamp"), "1781760000000");
    assert.equal(url.searchParams.get("sign"), expectedSign);
  });

  it("treats DingTalk non-zero errcode as notification failure", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ errcode: 310000, errmsg: "sign not match" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await sendDocumentationNotification({
      config: {
        webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=token",
        dingtalkActionCardBtnTitle: "通过",
        dingtalkActionCardBtnUrl: "",
        robotType: "dingtalk",
        maxOutputChars: 3000,
        minOutputChars: 1,
      },
      repository: {
        id: "byclaw",
        remoteUrl: "https://github.com/beyonai/ByClaw.git",
        branch: "develop",
        localPath: "/tmp/byclaw",
      },
      documentMarkdown: "## 文档\n\n### 操作步骤\n1. 点击「保存」。",
    });

    assert.equal(result.attempted, true);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /310000/);
    assert.match(result.error ?? "", /sign not match/);
  });

  it("sends DingTalk ActionCard with configurable approve button", async () => {
    let requestedUrl = "";
    let requestedBody = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await sendDocumentationNotification({
      config: {
        dingtalkAccessToken: "token-from-config",
        dingtalkActionCardBtnTitle: "审核通过",
        dingtalkActionCardBtnUrl: "https://example.test/approve",
        robotType: "dingtalk",
        maxOutputChars: 3000,
        minOutputChars: 1,
      },
      repository: {
        id: "byclaw",
        remoteUrl: "https://github.com/beyonai/ByClaw.git",
        branch: "develop",
        localPath: "/tmp/byclaw",
      },
      documentTitle: "Skill 上传文档",
      question: "如何上传 Skill？",
      documentMarkdown: "## 如何上传 Skill\n\n### 操作步骤\n1. 点击「上传」。",
    });

    const url = new URL(requestedUrl);
    const payload = JSON.parse(requestedBody) as {
      msgtype?: string;
      actionCard?: Record<string, unknown>;
    };

    assert.equal(result.ok, true);
    assert.equal(url.origin + url.pathname, "https://oapi.dingtalk.com/robot/send");
    assert.equal(url.searchParams.get("access_token"), "token-from-config");
    assert.equal(payload.msgtype, "actionCard");
    assert.equal(payload.actionCard?.title, "Skill 上传文档");
    assert.equal(payload.actionCard?.btnTitle, "审核通过");
    assert.equal(payload.actionCard?.btnUrl, "https://example.test/approve");
    assert.equal(payload.actionCard?.singleTitle, "审核通过");
    assert.equal(payload.actionCard?.singleURL, "https://example.test/approve");
    assert.match(String(payload.actionCard?.text ?? ""), /如何上传 Skill/);
  });
});
