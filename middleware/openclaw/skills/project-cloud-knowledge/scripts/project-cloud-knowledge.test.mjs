import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "project-cloud-knowledge.mjs");

function startServer(handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const contentType = request.headers["content-type"] || "";
    let body;
    if (contentType.includes("application/json")) {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : undefined;
    } else if (contentType.includes("multipart/form-data")) {
      body = { multipart: true, rawLength: raw.length, text: raw.toString("utf8") };
    } else {
      body = raw.length ? raw.toString("utf8") : undefined;
    }
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });
    handler(request, response, { raw, body });
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
    child.once("close", (code) => {
      try {
        resolve({ code, json: JSON.parse(stdout.trim()) });
      } catch (error) {
        reject(new Error(`invalid stdout: ${stdout}\n${error}`));
      }
    });
  });
}

test("list queries directory entries by level", async () => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      code: 0,
      data: [
        { name: "人事", type: "dir", fileName: "/制度/人事", directoryPath: "/制度/人事" },
        {
          name: "考勤制度.pdf",
          type: "file",
          fileId: 30001,
          fileName: "/制度/考勤制度.pdf",
          directoryPath: "/制度/考勤制度.pdf",
          size: 1024,
        },
      ],
    }));
  });
  const result = await run([
    "list",
    "--resource-id", "9001",
    "--directory-path", "/制度",
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.action, "list");
  assert.equal(result.json.directoryPath, "/制度");
  assert.equal(result.json.items.length, 2);
  assert.equal(result.json.items[0].type, "dir");
  assert.equal(result.json.items[1].fileId, 30001);
  assert.equal(server.requests[0].method, "POST");
  assert.match(server.requests[0].url, /\/byaiService\/datasetController\/queryDirAndFileByLevel$/);
  assert.deepEqual(server.requests[0].body, {
    resourceId: 9001,
    directoryPath: "/制度",
  });
});

test("mkdir creates folder under parent directory", async () => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      code: 0,
      data: { directoryPath: "/制度/人事", directoryName: "人事" },
    }));
  });
  const result = await run([
    "mkdir",
    "--resource-id", "9001",
    "--directory-path", "/制度",
    "--directory-name", "人事",
    "--directory-description", "人事制度",
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.action, "mkdir");
  assert.equal(result.json.created.directoryPath, "/制度/人事");
  assert.match(server.requests[0].url, /\/byaiService\/datasetController\/createFolder$/);
  assert.deepEqual(server.requests[0].body, {
    resourceId: 9001,
    directoryPath: "/制度",
    directoryName: "人事",
    directoryDescription: "人事制度",
  });
});

test("rename-dir posts existing path and new name", async () => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      code: 0,
      data: { directoryPath: "/制度", directoryName: "制度文档" },
    }));
  });
  const result = await run([
    "rename-dir",
    "--resource-id", "9001",
    "--directory-path", "/制度",
    "--directory-name", "制度文档",
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.action, "rename-dir");
  assert.match(server.requests[0].url, /\/byaiService\/datasetController\/renameFolder$/);
  assert.deepEqual(server.requests[0].body, {
    resourceId: 9001,
    directoryPath: "/制度",
    directoryName: "制度文档",
  });
});

test("delete-dir posts directory path", async () => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: null }));
  });
  const result = await run([
    "delete-dir",
    "--resource-id", "9001",
    "--directory-path", "/制度文档",
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.action, "delete-dir");
  assert.match(server.requests[0].url, /\/byaiService\/datasetController\/deleteFolder$/);
  assert.deepEqual(server.requests[0].body, {
    resourceId: 9001,
    directoryPath: "/制度文档",
  });
});

test("delete-dir rejects root path before network", async () => {
  const result = await run([
    "delete-dir",
    "--resource-id", "9001",
    "--directory-path", "/",
  ], { env: { BYAI_SERVICE_BASE_URL: "" } });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "CLOUD_DISK_INPUT_INVALID");
});

test("check posts conflict payload", async () => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      code: 0,
      data: { conflict: true, overwritePaths: ["/docs/a.md"] },
    }));
  });
  const result = await run([
    "check",
    "--resource-id", "9001",
    "--directory-path", "/docs",
    "--file-name", "a.md",
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.conflict, true);
  assert.deepEqual(result.json.overwritePaths, ["/docs/a.md"]);
  assert.equal(server.requests[0].method, "POST");
  assert.match(server.requests[0].url, /\/byaiService\/datasetController\/checkUploadFileConflicts$/);
  assert.deepEqual(server.requests[0].body, {
    resourceId: 9001,
    directoryPath: "/docs",
    fileNames: ["a.md"],
  });
  assert.equal(server.requests[0].headers["beyond-token"], "fixture-token");
});

test("upload sends multipart and can short-circuit on conflicts", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-cloud-knowledge-"));
  const filePath = path.join(tmpDir, "note.md");
  fs.writeFileSync(filePath, "# hello\n", "utf8");

  const server = await startServer((request, response) => {
    if (request.url.endsWith("/checkUploadFileConflicts")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        code: 0,
        data: { conflict: true, overwritePaths: ["/docs/note.md"] },
      }));
      return;
    }
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: 1, msg: "should not upload" }));
  });
  const result = await run([
    "upload",
    "--resource-id", "9001",
    "--directory-path", "/docs",
    "--file", filePath,
    "--check-conflicts",
  ], { port: server.port });
  await server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.equal(result.code, 0);
  assert.equal(result.json.needsOverwriteConfirmation, true);
  assert.equal(server.requests.length, 1);
});

test("upload text content uses multipart form", async () => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      code: 0,
      data: {
        resourceId: 9001,
        uploadItems: [{ fileName: "note.md", filePath: "/docs/note.md", success: true }],
        summary: { total: 1, succeeded: 1, failed: 0 },
      },
    }));
  });
  const result = await run([
    "upload",
    "--resource-id", "9001",
    "--directory-path", "docs",
    "--file-name", "note.md",
    "--text", "# hello",
    "--overwrite",
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.action, "upload");
  assert.equal(result.json.directoryPath, "/docs");
  assert.equal(server.requests[0].body.multipart, true);
  assert.match(server.requests[0].body.text, /name="resourceId"/);
  assert.match(server.requests[0].body.text, /9001/);
  assert.match(server.requests[0].body.text, /name="directoryPath"/);
  assert.match(server.requests[0].body.text, /\/docs/);
  assert.match(server.requests[0].body.text, /overwrite[\s\S]*true/);
});

test("download writes binary response to output", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-cloud-knowledge-"));
  const output = path.join(tmpDir, "out.pdf");
  const server = await startServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="a.pdf"',
    });
    response.end(Buffer.from("%PDF-1.4"));
  });
  const result = await run([
    "download",
    "--resource-id", "9001",
    "--file-path", "/docs/a.pdf",
    "--output", output,
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.equal(result.json.bytes, 8);
  assert.equal(fs.readFileSync(output, "utf8"), "%PDF-1.4");
  assert.match(server.requests[0].url, /resourceId=9001/);
  assert.match(decodeURIComponent(server.requests[0].url), /directoryPath=\/docs\/a\.pdf/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("remove posts file path as directoryPath", async () => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: null }));
  });
  const result = await run([
    "remove",
    "--resource-id", "9001",
    "--file-path", "docs/a.md",
  ], { port: server.port });
  await server.close();

  assert.equal(result.code, 0);
  assert.deepEqual(server.requests[0].body, {
    resourceId: 9001,
    directoryPath: "/docs/a.md",
  });
});

test("fails before network when resource id is missing", async () => {
  const result = await run(["check", "--directory-path", "/", "--file-name", "a.md"], {
    env: { BYAI_SERVICE_BASE_URL: "" },
  });
  assert.equal(result.code, 1);
  assert.equal(result.json.errorCode, "CLOUD_DISK_RESOURCE_ID_MISSING");
});
