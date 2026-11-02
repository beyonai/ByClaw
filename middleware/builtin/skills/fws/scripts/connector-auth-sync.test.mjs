import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "connector-auth-sync.mjs");
const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "SKILL.md");
const SECRET_TOKEN = "fixture-secret-beyond-token";

test("requires conditional best-effort metadata sync after a lazy user refresh", () => {
  const skill = fs.readFileSync(SKILL, "utf8");

  assert.match(skill, /业务命令前.*auth status --json.*不得增加 `--verify`/s);
  assert.match(skill, /仅当.*needs_refresh.*user 身份业务命令成功后.*connector-auth-sync\.mjs/s);
  assert.match(skill, /回写失败不得改变已经成功的飞书业务结果/);
  assert.match(skill, /bot 身份.*不执行该业务后回写/);
});

function runHelper(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, BEYOND_TOKEN: SECRET_TOKEN, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "connector-auth-sync-"));
  const stateDir = path.join(root, "state");
  const authDir = path.join(stateDir, "workspace");
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, "baiying-session.json"), JSON.stringify({
    headers: { "Beyond-Token": SECRET_TOKEN },
  }));
  return { root, stateDir };
}

function startServer(handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: body ? JSON.parse(body) : undefined,
    });
    handler(requests.at(-1), response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      requests,
      port: server.address().port,
    }));
  });
}

function startRedisWithInstance(instance) {
  const value = JSON.stringify(instance);
  const response = `*2\r\n$2\r\nid\r\n$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  const commands = [];
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      const command = chunk.toString("utf8");
      if (command.includes("\r\nAUTH\r\n")) {
        commands.push("AUTH");
        socket.write("+OK\r\n");
      } else if (command.includes("\r\nSELECT\r\n")) {
        commands.push("SELECT");
        socket.write("+OK\r\n");
      } else if (command.includes("\r\nHGETALL\r\n")) {
        commands.push("HGETALL");
        socket.end(response);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      commands,
      port: server.address().port,
    }));
  });
}

test("rejects unexpected arguments before making a request", async () => {
  const result = await runHelper(["unexpected"], {
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "connector-auth-sync-home-")),
    OPENCLAW_STATE_DIR: "",
    REDIS_HOST: "",
  });

  assert.equal(result.code, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "CONNECTOR_SYNC_ARGUMENT_INVALID",
    retryable: false,
  });
  assert.equal(result.stderr, "");
});

test("does not fall back to session files when the global token is absent", async (t) => {
  const fixture = createFixture();
  const backend = await startServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ code: 0, data: { connectorCode: "lark", connected: true } }));
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BE_SERVER_PORT: String(backend.port),
    BEYOND_TOKEN: "",
  });

  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "AUTH_CONTEXT_UNAVAILABLE",
    retryable: false,
  });
  assert.equal(backend.requests.length, 0);
  assert.doesNotMatch(result.stdout, new RegExp(SECRET_TOKEN));
  assert.doesNotMatch(result.stderr, new RegExp(SECRET_TOKEN));
});

test("uses only the global ByaiService base URL", async (t) => {
  const fixture = createFixture();
  const backend = await startServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ code: 0, data: { connected: true } }));
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    HOST: "https://attacker.example",
    BE_SERVER_PORT: "1",
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(backend.requests.length, 1);
  assert.deepEqual(backend.requests[0].body, { connectorCode: "lark" });
});

test("shares one retry budget for retryable backend responses", async (t) => {
  const fixture = createFixture();
  let attempts = 0;
  const backend = await startServer((_request, response) => {
    attempts += 1;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(attempts === 1
      ? { code: -1, data: { connected: false, errorCode: "AUTH_BINDING_FAILED", retryable: true } }
      : { code: 0, data: { connected: true } }));
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    BE_SERVER_PORT: String(backend.port),
  });

  assert.equal(result.code, 0, result.stdout);
  assert.equal(attempts, 2);
  assert.deepEqual(JSON.parse(result.stdout), { connected: true });
});

test("rejects missing global ByaiService base URL even when legacy discovery is available", async (t) => {
  const fixture = createFixture();
  const backend = await startServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ code: 0, data: { connected: true } }));
  });
  const redis = await startRedisWithInstance({
    id: "secured-backend",
    protocol: "http",
    host: "127.0.0.1",
    port: backend.port,
  });
  t.after(() => {
    redis.server.close();
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: String(redis.port),
    REDIS_PASSWORD: "redis-secret",
    REDIS_DATABASE: "2",
    BYAI_SERVICE_BASE_URL: "",
  });

  assert.equal(result.code, 1, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "BACKEND_SERVICE_UNAVAILABLE",
    retryable: true,
  });
  assert.deepEqual(redis.commands, []);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /redis-secret/);
});

test("does not retry a non-retryable backend failure", async (t) => {
  const fixture = createFixture();
  const backend = await startServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      code: -1,
      data: { connected: false, errorCode: "CONNECTOR_CREDENTIAL_INVALID", retryable: false },
    }));
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    BE_SERVER_PORT: String(backend.port),
  });

  assert.equal(result.code, 1);
  assert.equal(backend.requests.length, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "CONNECTOR_CREDENTIAL_INVALID",
    retryable: false,
  });
});

test("does not retry an unauthorized non-JSON response", async (t) => {
  const fixture = createFixture();
  const backend = await startServer((_request, response) => {
    response.statusCode = 401;
    response.end("unauthorized internal detail");
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    BE_SERVER_PORT: String(backend.port),
  });

  assert.equal(result.code, 1);
  assert.equal(backend.requests.length, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "CONNECTOR_SYNC_HTTP_ERROR",
    retryable: false,
  });
  assert.doesNotMatch(result.stdout, /unauthorized internal detail/);
});

test("retries HTTP 429 once within the shared budget", async (t) => {
  const fixture = createFixture();
  let attempts = 0;
  const backend = await startServer((_request, response) => {
    attempts += 1;
    response.setHeader("Content-Type", "application/json");
    if (attempts === 1) {
      response.statusCode = 429;
      response.end(JSON.stringify({ message: "temporary throttle" }));
      return;
    }
    response.end(JSON.stringify({ code: 0, data: { connected: true } }));
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    BE_SERVER_PORT: String(backend.port),
  });

  assert.equal(result.code, 0, result.stdout);
  assert.equal(attempts, 2);
  assert.deepEqual(JSON.parse(result.stdout), { connected: true });
});

test("maps an unrecognized backend error code to the stable public fallback", async (t) => {
  const fixture = createFixture();
  const backend = await startServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      code: 500,
      data: {
        connected: false,
        errorCode: "database-password-is-secret",
        retryable: false,
      },
    }));
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    BE_SERVER_PORT: String(backend.port),
  });

  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "CONNECTOR_SYNC_FAILED",
    retryable: false,
  });
  assert.doesNotMatch(result.stdout, /password|secret/i);
  assert.equal(result.stderr, "");
});

test("retries a malformed success response once and emits no response detail", async (t) => {
  const fixture = createFixture();
  let attempts = 0;
  const backend = await startServer((_request, response) => {
    attempts += 1;
    response.statusCode = 200;
    response.end("malformed secret response");
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: path.join(fixture.root, "home"),
    OPENCLAW_STATE_DIR: fixture.stateDir,
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    BE_SERVER_PORT: String(backend.port),
  });

  assert.equal(result.code, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "CONNECTOR_SYNC_RESPONSE_INVALID",
    retryable: true,
  });
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /malformed|secret/i);
});

test("uses the sandbox Beyond-Token environment when session files are unavailable", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "connector-auth-sync-empty-"));
  const backend = await startServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ code: 0, data: { connected: true } }));
  });
  t.after(() => {
    backend.server.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const result = await runHelper([], {
    HOME: home,
    OPENCLAW_STATE_DIR: path.join(home, "state"),
    REDIS_HOST: "",
    BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${backend.port}/byaiService`,
    BE_SERVER_PORT: String(backend.port),
    BEYOND_TOKEN: "sandbox-environment-token",
  });

  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { connected: true });
  assert.equal(backend.requests[0].headers["beyond-token"], "sandbox-environment-token");
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /sandbox-environment-token/);
});

test("fails when auth context is unavailable", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "connector-auth-sync-empty-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const result = await runHelper([], {
    HOME: home,
    OPENCLAW_STATE_DIR: path.join(home, "state"),
    REDIS_HOST: "",
    BEYOND_TOKEN: "",
  });

  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    connected: false,
    errorCode: "AUTH_CONTEXT_UNAVAILABLE",
    retryable: false,
  });
});
