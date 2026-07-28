#!/usr/bin/env node

import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "bycli-markdown-ingest.mjs");

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

      if (req.url === "/doc.pdf" || req.url === "/empty.pdf" || req.url === "/doc.PDF") {
        res.setHeader("content-type", "application/pdf");
        res.end(Buffer.from("pdf-bytes"));
        return;
      }

      if (req.url === "/clip.mp4") {
        res.setHeader("content-type", "video/mp4");
        res.end(Buffer.from("mp4-bytes"));
        return;
      }

      if (req.url === "/clip.mp3") {
        res.setHeader("content-type", "audio/mpeg");
        res.end(Buffer.from("mp3-bytes"));
        return;
      }

      if (req.url === "/byaiService/datasetController/uploadFiles") {
        res.setHeader("content-type", "application/json");
        // 用 filename="empty.pdf" 作为开关：模拟后端返回空 uploadItems（M6 用例）。
        if (/filename="empty\.pdf"/.test(bodyText)) {
          res.end(JSON.stringify({ code: 0, data: { uploadItems: [] } }));
          return;
        }
        res.end(JSON.stringify({
          code: 0,
          data: { uploadItems: [{ fileId: 88001, fileName: "doc.pdf", filePath: "/imports/doc.pdf" }] },
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/build") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 0, data: { status: "BUILDING", directoryPath: "/imports/doc.pdf" } }));
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

async function testVideoUrlUploadsToChatFilesAndStops() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(["ingest", "--session-id", "42"], {
      fileUrl: `http://127.0.0.1:${port}/clip.mp4`,
      fileName: "clip.mp4",
    }, port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "upload-resource");
    const upload = server.requests.find((request) => request.url === "/byaiService/chat/uploadFiles");
    assert.ok(upload, "expected video to go to /chat/uploadFiles");
    assert.match(upload.bodyText, /filename="clip\.mp4"/);
  } finally {
    await server.close();
  }
}

async function testNonMediaFileSkipsUploadAndGoesToMarkdown() {
  const server = createServer();
  const port = await server.listen();
  try {
    // 纯 PDF 链接（无正文字段）：不走 uploadFiles，也不入 Markdown 流程；
    // 白名单文档缺正文 → ingest 引导改用 upload-doc 直传（M1）。
    const result = await runCli(["ingest"], {
      fileUrl: `http://127.0.0.1:${port}/doc.pdf`,
      fileName: "doc.pdf",
    }, port);
    assert.equal(
      server.requests.some((request) => request.url === "/byaiService/chat/uploadFiles"),
      false,
      "non-media file must not hit /chat/uploadFiles",
    );
    assert.equal(result.json?.ok, false);
    assert.match(String(result.json?.error || ""), /upload-doc/);
    assert.equal(server.requests.some((request) => request.url?.includes("/ecosystemCollection/ingestion/")), false);
  } finally {
    await server.close();
  }
}

async function testAudioUrlUploadsToChatFilesAndStops() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(["ingest", "--session-id", "42"], {
      fileUrl: `http://127.0.0.1:${port}/clip.mp3`,
      fileName: "clip.mp3",
    }, port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "upload-resource");
    const upload = server.requests.find((request) => request.url === "/byaiService/chat/uploadFiles");
    assert.ok(upload, "expected audio to go to /chat/uploadFiles");
    assert.match(upload.bodyText, /filename="clip\.mp3"/);
  } finally {
    await server.close();
  }
}

async function testUploadDocViaDatasetController() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["upload-doc", "--file-url", `http://127.0.0.1:${port}/doc.pdf`, "--knowledge-base-resource-id", "90001", "--directory-path", "/imports"],
      {},
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "upload-doc");
    const upload = server.requests.find((r) => r.url === "/byaiService/datasetController/uploadFiles");
    assert.ok(upload, "expected /datasetController/uploadFiles request");
    assert.match(upload.bodyText, /filename="doc\.pdf"/);
    assert.match(upload.bodyText, /name="resourceId"\r\n\r\n90001/);
    assert.match(upload.bodyText, /name="directoryPath"\r\n\r\n\/imports/);
    const build = server.requests.find((r) => r.url === "/byaiService/datasetController/build");
    assert.ok(build, "expected /datasetController/build request");
    assert.match(build.bodyText, /\/imports\/doc\.pdf/);
    assert.equal(result.json?.builds?.length, 1);
    assert.equal(server.requests.some((r) => r.url?.includes("/ecosystemCollection/ingestion/")), false);
  } finally {
    await server.close();
  }
}

async function testUploadDocRejectsUnsupportedType() {
  const server = createServer();
  const port = await server.listen();
  try {
    // .png 不是文档类型 → upload-doc 拒绝，且不调 datasetController
    const result = await runCli(
      ["upload-doc", "--file-url", `http://127.0.0.1:${port}/asset.png`, "--knowledge-base-resource-id", "90001"],
      {},
      port,
    );
    assert.equal(result.json?.ok, false);
    assert.match(String(result.json?.error || ""), /文档/);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

// ① 本地文件不存在 → upload-doc 报「文件不存在」明确错（H1）
async function testUploadDocMissingLocalFileErrors() {
  const server = createServer();
  const port = await server.listen();
  try {
    const missing = path.join(os.tmpdir(), `bycli-no-such-${Date.now()}.pdf`);
    const result = await runCli(
      ["upload-doc", "--file-path", missing, "--knowledge-base-resource-id", "90001"],
      {},
      port,
    );
    assert.equal(result.json?.ok, false);
    assert.match(String(result.json?.error || ""), /文件不存在/);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

// ② upload-doc 缺 --knowledge-base-resource-id → 报错
async function testUploadDocRequiresKnowledgeBaseResourceId() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["upload-doc", "--file-url", `http://127.0.0.1:${port}/doc.pdf`],
      {},
      port,
    );
    assert.equal(result.json?.ok, false);
    assert.match(String(result.json?.error || ""), /knowledge-base-resource-id/);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

// ③ --markdown-file 入库成功（走 ingest；内部调用 by-knowledge-manager upload/build）
async function testMarkdownFileIngestSucceeds() {
  const server = createServer();
  const port = await server.listen();
  const mdPath = path.join(os.tmpdir(), `bycli-md-${Date.now()}.md`);
  fs.writeFileSync(mdPath, "# From File\n\n正文内容");
  try {
    const result = await runCli(
      ["ingest", "--markdown-file", mdPath, "--knowledge-base-resource-id", "90001"],
      {},
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.ok, true);
    assert.equal(result.json?.action, "ingest");
    assert.equal(result.json?.uploaded?.manager?.action, "upload");
    assert.equal(result.json?.uploaded?.filePaths?.[0], mdPath);
    assert.equal(result.json?.uploaded?.reusedFiles?.[0], mdPath);
    assert.equal(result.json?.uploaded?.generatedFiles?.length, 0);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/uploadFiles"), true);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/build"), true);
    assert.equal(server.requests.some((r) => r.url?.includes("/ecosystemCollection/ingestion/")), false);
  } finally {
    fs.rmSync(mdPath, { force: true });
    await server.close();
  }
}

// ④ ingest 成功路径：stdin Markdown → 临时文件 → manager upload/build
async function testIngestInlineMarkdownUploadsThroughManager() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["ingest", "--knowledge-base-resource-id", "90001"],
      { content: "# Article\n\n正文" },
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.ok, true);
    assert.equal(result.json?.action, "ingest");
    assert.equal(result.json?.uploaded?.reusedFiles?.length, 0);
    assert.equal(result.json?.uploaded?.generatedFiles?.length, 1);
    assert.match(result.json?.uploaded?.generatedFiles?.[0] || "", /bycli-knowledge-ingest-/);
    const upload = server.requests.find((r) => r.url === "/byaiService/datasetController/uploadFiles");
    assert.ok(upload, "expected manager upload request");
    assert.match(upload.bodyText, /filename="Article\.md"/);
    assert.equal(server.requests.some((r) => r.url?.includes("/ecosystemCollection/ingestion/")), false);
  } finally {
    await server.close();
  }
}

// ⑤ upload-resource 上传一个文件类型（kind=file）→ 走 /chat/uploadFiles
async function testUploadResourceFileKindGoesToChatFiles() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["upload-resource", "--file-url", `http://127.0.0.1:${port}/doc.pdf`],
      {},
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "upload-resource");
    assert.equal(result.json?.resources?.[0]?.kind, "file");
    const upload = server.requests.find((r) => r.url === "/byaiService/chat/uploadFiles");
    assert.ok(upload, "expected file-kind resource to go to /chat/uploadFiles");
    assert.match(upload.bodyText, /filename="doc\.pdf"/);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

// ⑥ upload-doc 后端返回空 uploadItems → 报错（M6）
async function testUploadDocEmptyUploadItemsErrors() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["upload-doc", "--file-url", `http://127.0.0.1:${port}/empty.pdf`, "--knowledge-base-resource-id", "90001"],
      {},
      port,
    );
    assert.equal(result.json?.ok, false);
    assert.match(String(result.json?.error || ""), /uploadItems/);
    // 上传被调用，但因空 uploadItems 不应触发 build
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/uploadFiles"), true);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/build"), false);
  } finally {
    await server.close();
  }
}

// ⑦ 大写扩展名 .PDF 能被 upload-doc 识别
async function testUploadDocAcceptsUppercaseExtension() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["upload-doc", "--file-url", `http://127.0.0.1:${port}/doc.PDF`, "--knowledge-base-resource-id", "90001"],
      {},
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "upload-doc");
    assert.equal(result.json?.builds?.length, 1);
    assert.equal(server.requests.some((r) => r.url === "/byaiService/datasetController/uploadFiles"), true);
  } finally {
    await server.close();
  }
}

await testMarkdownIngestListsKnowledgeBasesBeforeImport();
await testImageUrlUploadsToChatFilesAndStops();
await testVideoUrlUploadsToChatFilesAndStops();
await testAudioUrlUploadsToChatFilesAndStops();
await testNonMediaFileSkipsUploadAndGoesToMarkdown();
await testUploadDocViaDatasetController();
await testUploadDocRejectsUnsupportedType();
await testUploadDocMissingLocalFileErrors();
await testUploadDocRequiresKnowledgeBaseResourceId();
await testMarkdownFileIngestSucceeds();
await testIngestInlineMarkdownUploadsThroughManager();
await testUploadResourceFileKindGoesToChatFiles();
await testUploadDocEmptyUploadItemsErrors();
await testUploadDocAcceptsUppercaseExtension();
console.log("bycli-markdown-ingest tests passed");
