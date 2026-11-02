import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "deepseek-web-search.mjs");

function run(args, port, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        BEYOND_TOKEN: "fixture-token",
        BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${port}/byaiService`,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, json: JSON.parse(stdout.trim()) }));
  });
}

test("search sends deduplicated queries and maxResults to the backend proxy", async () => {
  let captured;
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    captured = { url: request.url, headers: request.headers, body: JSON.parse(body) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: { sources: [{ url: "https://example.com" }], truncated: false } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const result = await run([
    "--query", "latest news",
    "--query", "product updates",
    "--query", "latest news",
    "--max-results", "3",
  ], server.address().port);
  await new Promise(resolve => server.close(resolve));

  assert.equal(result.code, 0);
  assert.equal(result.json.sources[0].url, "https://example.com");
  assert.match(captured.url, /\/connector\/runtime\/deepseek-web-search\/search$/);
  assert.equal(captured.headers["beyond-token"], "fixture-token");
  assert.deepEqual(captured.body, { queries: ["latest news", "product updates"], maxResults: 3 });
});

test("rejects more than four queries before calling the backend", async () => {
  const result = await run([
    "--query", "one",
    "--query", "two",
    "--query", "three",
    "--query", "four",
    "--query", "five",
  ], 1);

  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "DEEPSEEK_WEB_SEARCH_INPUT_INVALID");
  assert.equal(result.json.detail, "queries");
});

test("does not call the backend without login context", async () => {
  const result = await run(["--query", "q"], 1, { BEYOND_TOKEN: "" });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "DEEPSEEK_WEB_SEARCH_AUTH_CONTEXT_UNAVAILABLE");
});

test("reports revoked authorization separately from a disabled connector", async () => {
  const server = http.createServer(async (_request, response) => {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: 403, msg: "CONNECTOR_NOT_AUTHORIZED: authorization is required" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const result = await run(["--query", "latest news"], server.address().port);
  await new Promise(resolve => server.close(resolve));

  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "DEEPSEEK_WEB_SEARCH_CONNECTOR_NOT_AUTHORIZED");
});

test("uses the project-context session and signature fallback when Beyond-Token is unavailable", async () => {
  let captured;
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    captured = { headers: request.headers, body };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: { sources: [], truncated: false } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const result = await run(["--query", "latest news"], server.address().port, {
    BEYOND_TOKEN: "",
    BYCLAW_BEYOND_TOKEN: "",
    BYCLAW_ECOSYSTEM_BEYOND_TOKEN: "",
    USER_CODE: "tester",
    BYCLAW_ECOSYSTEM_SESSION: "session-123",
  });
  await new Promise(resolve => server.close(resolve));

  assert.equal(result.code, 0);
  assert.equal(captured.headers["x-user-id"], "tester");
  assert.equal(captured.headers["x-signature-sessionid"], "session-123");
  assert.equal(captured.headers.cookie, "SESSION=session-123; PORTAL-SESSION=session-123");
  assert.match(captured.headers["x-signature-nonce"], /.+/);
  assert.match(captured.headers["x-signature-timestamp"], /^\d+$/);
  assert.match(captured.headers["x-signature-value"], /^[a-f0-9]{32}$/);
});
