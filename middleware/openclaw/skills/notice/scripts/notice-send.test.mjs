import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "notice-send.mjs");
const SECRET_TOKEN = "fixture-secret-beyond-token";

function startServer(handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, headers: request.headers, body: body ? JSON.parse(body) : undefined });
    handler(request, response, requests.length);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        requests,
        port: server.address().port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function ok(response, data) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ code: 0, msg: "Operation successful", data }));
}

function run(args, { port, env = {}, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        BEYOND_TOKEN: SECRET_TOKEN,
        USER_CODE: "sender-code",
        BYAI_SERVICE_BASE_URL: port ? `http://127.0.0.1:${port}/byaiService` : "",
        ...env,
      },
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr, json: stdout.trim() ? JSON.parse(stdout.trim()) : undefined }));
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    }
  });
}

test("send maps priority words to backend 1-4 and defaults sender to USER_CODE", async () => {
  const server = await startServer((request, response) => ok(response, "Operation successful"));
  const result = await run(["send"], {
    port: server.port,
    stdin: JSON.stringify({
      title: "采集到 2 条待处理需求",
      content: "详情见项目需求列表",
      notices: [
        { userId: 10000022, priority: "high" },
        { userCode: "lisi" },
      ],
    }),
  });
  await server.close();

  assert.equal(result.code, 0);
  assert.deepEqual(result.json, { ok: true, requested: 2, sent: 2, batches: 1, failures: [], dingtalkSent: 0 });
  const [call] = server.requests;
  assert.match(call.url, /\/byaiService\/open\/api\/notice\/create$/);
  assert.equal(call.headers["beyond-token"], SECRET_TOKEN);
  assert.deepEqual(call.body.noticeDetails[0], {
    title: "采集到 2 条待处理需求",
    content: "详情见项目需求列表",
    priority: 3,
    sendUserCode: "sender-code",
    targetId: 10000022,
  });
  // 未给 priority 的走 medium 默认，targetUserCode 分支保留字符串寻址。
  assert.equal(call.body.noticeDetails[1].priority, 2);
  assert.equal(call.body.noticeDetails[1].targetUserCode, "lisi");
});

test("send splits batches above the backend 100-item cap", async () => {
  const server = await startServer((request, response) => ok(response, "Operation successful"));
  const notices = Array.from({ length: 101 }, (unused, index) => ({ userId: 1000 + index }));
  const result = await run(["send"], {
    port: server.port,
    stdin: JSON.stringify({ title: "t", content: "c", notices }),
  });
  await server.close();

  assert.equal(result.json.batches, 2);
  assert.equal(result.json.sent, 101);
  assert.equal(server.requests[0].body.noticeDetails.length, 100);
  assert.equal(server.requests[1].body.noticeDetails.length, 1);
});

test("send reports a failed batch without losing the successful one", async () => {
  const server = await startServer((request, response, callIndex) => {
    if (callIndex === 2) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: -1, msg: "user not found" }));
      return;
    }
    ok(response, "Operation successful");
  });
  const notices = Array.from({ length: 101 }, (unused, index) => ({ userId: 1000 + index }));
  const result = await run(["send"], {
    port: server.port,
    stdin: JSON.stringify({ title: "t", content: "c", notices }),
  });
  await server.close();

  assert.equal(result.code, 1);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.sent, 100);
  assert.equal(result.json.failures.length, 1);
  assert.equal(result.json.failures[0].errorCode, "NOTICE_BACKEND_REJECTED");
});

test("send clamps over-long title and content instead of failing the batch", async () => {
  const server = await startServer((request, response) => ok(response, "Operation successful"));
  await run(["send"], {
    port: server.port,
    stdin: JSON.stringify({
      title: "标".repeat(250),
      content: "正".repeat(2500),
      notices: [{ userId: 1 }],
    }),
  });
  await server.close();

  const detail = server.requests[0].body.noticeDetails[0];
  assert.equal(detail.title.length, 200);
  assert.equal(detail.content.length, 2000);
  assert.ok(detail.title.endsWith("..."));
});

test("send refuses when no recipient identity is resolvable", async () => {
  const result = await run(["send"], {
    port: 1,
    stdin: JSON.stringify({ title: "t", content: "c", notices: [{ userName: "张三" }] }),
  });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "NOTICE_TARGET_UNRESOLVED");
});

test("send refuses when the sender identity is unavailable", async () => {
  const result = await run(["send"], {
    port: 1,
    env: { USER_CODE: "", BYCLAW_ECOSYSTEM_USER_CODE: "", NOTICE_SENDER_ID: "" },
    stdin: JSON.stringify({ title: "t", content: "c", notices: [{ userId: 1 }] }),
  });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "NOTICE_SENDER_UNRESOLVED");
});

test("members returns only the fields notification needs, including userName", async () => {
  const server = await startServer((request, response) => ok(response, [
    { memberId: 1, projectId: 7, userId: 10000022, userCode: "zhangsan", userName: "张三", userNumber: "0012345678", role: "owner", agentName: "架构师" },
    { memberId: 2, projectId: 7, userId: 10000023, userCode: "lisi", userName: "李四", role: "member" },
    { memberId: 3, projectId: 7, userId: null, userCode: null, userName: "幽灵成员", role: "member" },
  ]));
  const result = await run(["members", "--project-id", "7"], { port: server.port });
  await server.close();

  assert.match(server.requests[0].url, /\/open\/api\/v1\/listProjectMembers$/);
  assert.equal(server.requests[0].body.projectId, 7);
  assert.equal(result.json.total, 2);
  assert.deepEqual(result.json.members[0], {
    userId: 10000022,
    userCode: "zhangsan",
    userName: "张三",
    userNumber: "0012345678",
    role: "owner",
    agentName: "架构师",
  });
  // 工号缺失回 null 而不是省略字段，调用方据此直接降级到下一种匹配方式。
  assert.equal(result.json.members[1].userNumber, null);
  // memberId / projectId / createTime 等不参与通知，不回传给调用方。
  assert.deepEqual(
    Object.keys(result.json.members[1]).sort(),
    ["agentName", "role", "userCode", "userId", "userName", "userNumber"],
  );
});

test("projects lists candidates so a missing projectId can be resolved by choosing", async () => {
  const server = await startServer((request, response) => ok(response, {
    total: 2,
    list: [
      { projectId: 7, projectName: "研发闭环", projectType: "develop", sessionCount: 12, description: "无关字段" },
      { projectId: 8, projectName: "客服助手", projectType: "normal", sessionCount: 3 },
    ],
  }));
  const result = await run(["projects", "--keyword", "研发"], { port: server.port });
  await server.close();

  assert.match(server.requests[0].url, /\/open\/api\/v1\/selectProjectsByQo$/);
  assert.equal(server.requests[0].body.keyword, "研发");
  assert.equal(result.json.total, 2);
  // 只回传选项需要的字段，description 之类不进上下文。
  assert.deepEqual(result.json.projects[0], {
    projectId: 7,
    projectName: "研发闭环",
    projectType: "develop",
    sessionCount: 12,
  });
});

test("members returns jobNumber by default but hides phone unless --with-phone", async () => {
  const rows = [
    { memberId: 1, projectId: 7, userId: 10000022, userCode: "zhangsan", userName: "张三", userNumber: "0012345678", role: "owner", phone: "13800138000" },
  ];
  const bare = await startServer((request, response) => ok(response, rows));
  const bareResult = await run(["members", "--project-id", "7"], { port: bare.port });
  await bare.close();
  assert.ok(!("phone" in bareResult.json.members[0]));
  assert.ok(!bareResult.stdout.includes("13800138000"));
  // 工号是首选匹配项，默认就要有，否则调用方只能退回手机号。
  assert.equal(bareResult.json.members[0].userNumber, "0012345678");

  const opted = await startServer((request, response) => ok(response, rows));
  const optedResult = await run(["members", "--project-id", "7", "--with-phone"], { port: opted.port });
  await opted.close();
  assert.equal(optedResult.json.members[0].phone, "13800138000");
});

test("resolve-project maps a session to its project", async () => {
  const server = await startServer((request, response) => ok(response, {
    sessionId: 990, bound: true, projectId: 7, projectName: "研发闭环", projectType: "develop",
  }));
  const result = await run(["resolve-project", "--session-id", "990"], { port: server.port });
  await server.close();

  assert.match(server.requests[0].url, /\/open\/api\/v1\/resolveProjectBySession$/);
  assert.equal(server.requests[0].body.sessionId, 990);
  assert.equal(result.json.bound, true);
  assert.equal(result.json.projectId, 7);
  assert.equal(result.json.projectName, "研发闭环");
});

test("resolve-project reports bound:false instead of failing when the session has no project", async () => {
  const server = await startServer((request, response) => ok(response, {
    sessionId: 991, bound: false, projectId: null, projectName: null, projectType: null,
  }));
  const result = await run(["resolve-project", "--session-id", "991"], { port: server.port });
  await server.close();

  // 查不到项目必须和调用失败区分开：ok=true 让调用方继续走追问兜底，而不是当成故障重试。
  assert.equal(result.code, 0);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.bound, false);
  assert.equal(result.json.projectId, null);
});

test("resolve-project requires sessionId", async () => {
  const result = await run(["resolve-project"], { port: 1 });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "NOTICE_SESSION_ID_MISSING");
});

test("members requires projectId", async () => {
  const result = await run(["members"], { port: 1 });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "NOTICE_PROJECT_ID_MISSING");
});

test("never echoes the beyond token in stdout or stderr", async () => {
  const server = await startServer((request, response) => {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: -1, msg: "boom" }));
  });
  const result = await run(["send"], {
    port: server.port,
    stdin: JSON.stringify({ title: "t", content: "c", notices: [{ userId: 1 }] }),
  });
  await server.close();

  assert.ok(!result.stdout.includes(SECRET_TOKEN));
  assert.ok(!result.stderr.includes(SECRET_TOKEN));
});

test("help lists both commands without contacting the backend", async () => {
  const result = await run(["help"]);
  assert.equal(result.code, 0);
  assert.ok(result.json.commands.send.includes("notice-send.mjs send"));
  assert.ok(result.json.commands.members.includes("--project-id"));
});

const NO_AUTH_ENV = {
  BEYOND_TOKEN: "",
  BYCLAW_BEYOND_TOKEN: "",
  BYCLAW_ECOSYSTEM_BEYOND_TOKEN: "",
  BAIYING_SESSION: "",
  SESSION_ID: "",
  BYCLAW_SESSION: "",
  BYCLAW_ECOSYSTEM_SESSION: "",
};

test("missing credentials fail before the request instead of surfacing as a backend 401", async () => {
  const server = await startServer((request, response) => ok(response, { bound: false }));
  const result = await run(["resolve-project", "--session-id", "77"], { port: server.port, env: NO_AUTH_ENV });
  await server.close();

  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "NOTICE_AUTH_CONTEXT_UNAVAILABLE");
  assert.equal(server.requests.length, 0);
});

test("sessionId is sent as a SESSION cookie so an expired token snapshot still authenticates", async () => {
  const server = await startServer((request, response) => ok(response, { bound: false }));
  const result = await run(["resolve-project", "--session-id", "77"], {
    port: server.port,
    env: { ...NO_AUTH_ENV, BAIYING_SESSION: "sess-9" },
  });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(server.requests[0].headers.cookie, "SESSION=sess-9; PORTAL-SESSION=sess-9");
  assert.equal(server.requests[0].headers["beyond-token"], undefined);
});

test("a 401 reports the login reason from resultMsg under its own error code", async () => {
  const server = await startServer((request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ resultCode: 401, resultMsg: "beyond-token 已过期", type: 1 }));
  });
  const result = await run(["resolve-project", "--session-id", "77"], { port: server.port });
  await server.close();

  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "NOTICE_AUTH_REJECTED");
  assert.match(result.json.detail, /已过期/);
  assert.ok(!JSON.stringify(result.json).includes(SECRET_TOKEN));
});
