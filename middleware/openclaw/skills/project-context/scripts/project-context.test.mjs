import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "project-context.mjs");

function startServer(handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(body) });
    handler(request, response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    requests,
    port: server.address().port,
    close: () => new Promise((done) => server.close(done)),
  })));
}

function run(args, { port, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        BEYOND_TOKEN: "fixture-token",
        USER_CODE: "tester",
        BYAI_SERVICE_BASE_URL: port ? `http://127.0.0.1:${port}/byaiService` : "",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, json: JSON.parse(stdout.trim()) }));
  });
}

test("current sends projectId and returns the complete backend payload", async () => {
  const server = await startServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: { projectId: 7, project: { projectName: "研发项目" } } }));
  });
  const result = await run(["current", "--project-id", "7"], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.project.projectName, "研发项目");
  assert.deepEqual(server.requests[0].body, { projectId: 7 });
  assert.match(server.requests[0].url, /\/byaiService\/open\/api\/v1\/projectContext$/);
  assert.equal(server.requests[0].headers["beyond-token"], "fixture-token");
});

test("resources uses session fallback and limits sections", async () => {
  const server = await startServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: { resolvedBy: "sessionId" } }));
  });
  const result = await run(["resources", "--session-id", "99"], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.deepEqual(server.requests[0].body, { sessionId: 99, sections: ["knowledge", "ontologies"] });
});

test("files caps page size at 100", async () => {
  const server = await startServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: {} }));
  });
  await run(["files", "--project-id", "7", "--size", "999"], { port: server.port });
  await server.close();

  assert.deepEqual(server.requests[0].body, { projectId: 7, sections: ["sharedFiles"], pageSize: 100 });
});

test("fails before network access when neither project nor session is present", async () => {
  const result = await run(["current"], { env: { BYAI_SERVICE_BASE_URL: "" } });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "PROJECT_CONTEXT_ID_MISSING");
});
