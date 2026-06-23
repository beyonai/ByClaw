#!/usr/bin/env node

import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const SCRIPT = "middleware/openclaw/skills/bycli/scripts/bycli-markdown-ingest.mjs";

function createServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyBuffer = Buffer.concat(chunks);
      const bodyText = bodyBuffer.toString("utf8");
      requests.push({ method: req.method, url: req.url, headers: req.headers, rawHeaders: req.rawHeaders, bodyText });

      if (req.url === "/asset.png") {
        res.setHeader("content-type", "image/png");
        res.end(Buffer.from("png-bytes"));
        return;
      }

      if (req.url === "/doc.pdf") {
        res.setHeader("content-type", "application/pdf");
        res.end(Buffer.from("pdf-bytes"));
        return;
      }

      if (req.url === "/byaiService/spaceDir/listPersonalKb") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          data: {
            selectedKbs: [],
            pageInfo: {
              list: [
                { dirId: 90001, name: "个人默认知识库", dataId: 90001, datasetId: 80001 },
              ],
              total: 1,
            },
          },
        }));
        return;
      }

      if (req.url === "/byaiService/chat/uploadFiles") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          data: {
            sessionId: 42,
            uploadItems: [
              { fileId: 70001, fileName: "asset.png", fileUrl: "/commonFile/preview?filePath=asset.png" },
            ],
          },
        }));
        return;
      }

      if (req.url?.includes("/ecosystemCollection/ingestion/")) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 500, message: "ingestion should not be called in this test" }));
        return;
      }

      res.statusCode = 404;
      res.end(`not found: ${req.url}`);
    });
  });

  return {
    requests,
    listen() {
      return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function runCli(args, input, port) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: `http://127.0.0.1:${port}`,
        REDIS_HOST: "",
        BEYOND_TOKEN: "system-token",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      resolve({ code, stdout, stderr, json });
    });
    child.stdin.end(JSON.stringify(input));
    setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out: ${args.join(" ")}`));
    }, 10000).unref();
  });
}

async function testMarkdownIngestListsKnowledgeBasesBeforeImport() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(["ingest"], { title: "Article", content: "# Article" }, port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.needsKnowledgeBaseSelection, true);
    assert.equal(result.json?.knowledgeBases?.[0]?.resourceId, 90001);
    assert.equal(result.json?.knowledgeBases?.[0]?.name, "个人默认知识库");
    assert.equal(server.requests.filter((request) => request.url === "/byaiService/spaceDir/listPersonalKb").length, 1);
    assert.equal(server.requests.some((request) => request.url?.includes("/ecosystemCollection/ingestion/")), false);
  } finally {
    await server.close();
  }
}

async function testImageUrlUploadsToChatFilesAndStops() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(["ingest", "--session-id", "42"], {
      fileUrl: `http://127.0.0.1:${port}/asset.png`,
      fileName: "asset.png",
    }, port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "upload-resource");
    assert.equal(result.json?.uploaded?.sessionId, 42);
    const upload = server.requests.find((request) => request.url === "/byaiService/chat/uploadFiles");
    assert.ok(upload, "expected /chat/uploadFiles request");
    assert.match(upload.bodyText, /name="sessionType"\r\n\r\nAGENT/);
    assert.match(upload.bodyText, /name="sessionId"\r\n\r\n42/);
    assert.match(upload.bodyText, /filename="asset\.png"/);
    assert.equal(server.requests.some((request) => request.url?.includes("/ecosystemCollection/ingestion/")), false);
  } finally {
    await server.close();
  }
}

await testMarkdownIngestListsKnowledgeBasesBeforeImport();
await testImageUrlUploadsToChatFilesAndStops();
console.log("bycli-markdown-ingest tests passed");
