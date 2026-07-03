#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "by-knowledge-manager.mjs");

function createServer(options = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyBuffer = Buffer.concat(chunks);
      const bodyText = bodyBuffer.toString("utf8");
      requests.push({ method: req.method, url: req.url, headers: req.headers, rawHeaders: req.rawHeaders, bodyText });

      if (options.httpFailure && req.url?.includes(options.httpFailure)) {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: -1, msg: "mock unavailable", data: null, success: false }));
        return;
      }

      if (options.businessFailure && req.url?.includes(options.businessFailure)) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: -1, msg: "资源不存在", data: null, success: false }));
        return;
      }

      if (req.url === "/byaiService/datasetController/createFolder") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          msg: "创建知识库目录成功",
          data: { knCode: "36", directoryPath: "/docs", directoryDescription: "desc" },
          success: true,
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/renameFolder") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          msg: "重命名知识库目录成功",
          data: { knCode: "36", directoryPath: "/docs", directoryName: "manuals" },
          success: true,
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/deleteFolder") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 0, msg: "删除知识库目录成功", data: null, success: true }));
        return;
      }

      if (req.url === "/byaiService/datasetController/queryDirAndFileByLevel") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          msg: "查询知识库目录文件成功",
          data: [
            {
              id: "internal-id",
              name: "guide.md",
              type: "file",
              fileId: "internal-file-id",
              fileName: "/docs/guide.md",
              fileUrl: "internal-url",
              directoryPath: "/docs/guide.md",
            },
          ],
          success: true,
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/checkUploadFileConflicts") {
        res.setHeader("content-type", "application/json");
        const body = bodyText ? JSON.parse(bodyText) : {};
        const conflict = body.fileNames?.includes("exists.md") || options.conflict;
        res.end(JSON.stringify({
          code: 0,
          msg: "查询知识库目录文件成功",
          data: {
            conflict: Boolean(conflict),
            overwritePaths: conflict ? ["/docs/exists.md"] : [],
          },
          success: true,
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/uploadFiles") {
        res.setHeader("content-type", "application/json");
        if (options.emptyUploadItems) {
          res.end(JSON.stringify({ code: 0, msg: "上传知识库文件成功", data: { uploadItems: [] }, success: true }));
          return;
        }
        if (options.uploadItemsWithoutPath) {
          res.end(JSON.stringify({
            code: 0,
            msg: "上传知识库文件成功",
            data: { resourceId: 10023355, uploadItems: [{ fileName: "guide.md" }] },
            success: true,
          }));
          return;
        }
        if (options.partialUploadItemWithoutPath) {
          res.end(JSON.stringify({
            code: 0,
            msg: "上传知识库文件成功",
            data: {
              resourceId: 10023355,
              uploadItems: [
                { fileName: "guide.md", filePath: "/docs/guide.md" },
                { fileName: "missing-path.md" },
              ],
            },
            success: true,
          }));
          return;
        }
        res.end(JSON.stringify({
          code: 0,
          msg: "上传知识库文件成功",
          data: {
            resourceId: 10023355,
            resourceCode: "36",
            resourceName: "个人知识库",
            uploadItems: [{ fileId: null, fileName: "guide.md", filePath: "/docs/guide.md", fileUrl: null }],
          },
          success: true,
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/build") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 0, msg: "触发知识库构建成功", data: null, success: true }));
        return;
      }

      if (req.url?.startsWith("/byaiService/datasetController/fileBuildStatus")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          msg: "查询文件构建状态成功",
          data: {
            status: "complete",
            currentStep: "complete",
            currentStepStatus: null,
            statusDict: [{ standCode: "complete", standDisplayValue: "已完成", standDisplayValueEn: "complete" }],
            stepDict: [{ standCode: "complete", standDisplayValue: "已完成", standDisplayValueEn: "complete" }],
          },
          success: true,
        }));
        return;
      }

      if (req.url?.startsWith("/byaiService/datasetController/download")) {
        if (options.downloadBusinessFailure) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ code: -1, msg: "资源不存在", data: null, success: false }));
          return;
        }
        res.setHeader("content-type", "application/octet-stream;charset=UTF-8");
        res.setHeader("content-disposition", "attachment;filename=guide.md");
        res.end(Buffer.from("# Guide\n"));
        return;
      }

      if (req.url === "/byaiService/datasetController/readFile") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          msg: "查询知识库目录文件成功",
          data: {
            knCode: "10023355",
            filePath: "/docs/guide.md",
            startLine: 1,
            endLine: 20,
            data: "# Guide\n\nbody\n",
            reachedEof: true,
          },
          success: true,
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/knowledgeItems/search") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: 0,
          msg: "查询知识库目录文件成功",
          data: {
            data: [
              {
                knCode: "10023355",
                filePath: "/docs/guide.md",
                chunkNo: 1,
                chunkId: 1767,
                chunkText: "# Guide\n\nbody",
                score: 0.42,
                imagePath: "",
                startLine: 1,
                endLine: 3,
              },
            ],
          },
          success: true,
        }));
        return;
      }

      if (req.url === "/byaiService/datasetController/removeFile") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 0, msg: "删除知识库文件成功", data: null, success: true }));
        return;
      }

      res.statusCode = 404;
      res.end(`not found: ${req.method} ${req.url}`);
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

function runCli(args, port, input = "", envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HOST: `http://127.0.0.1:${port}`,
      REDIS_HOST: "",
      BEYOND_TOKEN: "system-token",
      USER_CODE: "u001",
      BAIYING_SESSION: "session-1",
      ...envOverrides,
    };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete env[key];
      }
    }
    const child = spawn("node", [SCRIPT, ...args], {
      cwd: path.dirname(path.dirname(SCRIPT)),
      env,
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
    child.stdin.end(input);
    setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out: ${args.join(" ")}`));
    }, 10000).unref();
  });
}

async function withServer(fn, options = {}) {
  const server = createServer(options);
  const port = await server.listen();
  try {
    await fn(server, port);
  } finally {
    await server.close();
  }
}

function parseJsonRequest(request) {
  return JSON.parse(request.bodyText);
}

function assertBycliAuthHeaders(request) {
  assert.equal(request.headers["beyond-token"], "system-token");
  assert.equal(request.headers["x-user-id"], "u001");
  assert.equal(request.headers["x-signature-sessionid"], "session-1");
  assert.equal(request.headers["x-session-id"], "session-1");
  assert.match(request.headers.cookie || "", /SESSION=session-1/);
  assert.ok(request.headers["x-signature-nonce"]);
  assert.ok(request.headers["x-signature-timestamp"]);
  assert.ok(request.headers["x-signature-value"]);
  const expectedSignature = crypto
    .createHash("md5")
    .update(`u001${request.headers["x-signature-nonce"]}${request.headers["x-signature-timestamp"]}${request.bodyText || ""}{#@*A12^c0+}`)
    .digest("hex");
  assert.equal(request.headers["x-signature-value"], expectedSignature);
}

function assertNoLegacyIngestEndpoints(server) {
  assert.equal(server.requests.some((item) => item.url?.includes("/ecosystemCollection/ingestion/")), false);
  assert.equal(server.requests.some((item) => item.url?.includes("/chat/uploadFiles")), false);
  assert.equal(server.requests.some((item) => item.url?.includes("/spaceDir/listPersonalKb")), false);
}

const FORBIDDEN_PUBLIC_KEYS = new Set(["backend", "auth", "endpoint", "buildEndpoint", "raw", "knCode", "resourceCode", "fileId", "fileUrl", "chunkId"]);

function assertPublicOutput(value, label = "output") {
  function visit(item, pathParts) {
    if (!item || typeof item !== "object") {
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, [...pathParts, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      const currentPath = [...pathParts, key].join(".");
      assert.equal(FORBIDDEN_PUBLIC_KEYS.has(key), false, `${label} exposes forbidden field: ${currentPath}`);
      visit(child, [...pathParts, key]);
    }
  }
  visit(value, []);
}

function makeTempMarkdown(name = "guide.md") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "by-km-test-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, "# Guide\n\nbody\n");
  return { dir, filePath };
}

async function testMkdirSuccess() {
  await withServer(async (server, port) => {
    const result = await runCli(["mkdir", "--resource-id", "10023355", "--directory-path", "/", "--directory-name", "docs", "--directory-description", "desc"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.action, "mkdir");
    assertPublicOutput(result.json, "mkdir");
    assert.equal(result.json.created.directoryPath, "/docs");
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/createFolder");
    assertBycliAuthHeaders(request);
    assert.deepEqual(parseJsonRequest(request), {
      resourceId: 10023355,
      directoryPath: "/",
      directoryName: "docs",
      directoryDescription: "desc",
    });
  });
}

async function testMkdirMissingNameFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["mkdir", "--resource-id", "10023355", "--directory-path", "/"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "mkdir failure");
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /directory-name/);
  });
}

async function testRenameDirSuccess() {
  await withServer(async (server, port) => {
    const result = await runCli(["rename-dir", "--resource-id", "10023355", "--directory-path", "/docs", "--directory-name", "manuals"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "rename-dir");
    assert.equal(result.json.renamed.directoryName, "manuals");
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/renameFolder");
    assert.deepEqual(parseJsonRequest(request), { resourceId: 10023355, directoryPath: "/docs", directoryName: "manuals" });
  });
}

async function testRenameDirMissingPathFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["rename-dir", "--resource-id", "10023355", "--directory-name", "manuals"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "rename-dir failure");
    assert.match(result.json.error, /directory-path/);
  });
}

async function testDeleteDirSuccess() {
  await withServer(async (server, port) => {
    const result = await runCli(["delete-dir", "--resource-id", "10023355", "--directory-path", "/docs"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "delete-dir");
    assert.equal(result.json.deleted, null);
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/deleteFolder");
    assert.deepEqual(parseJsonRequest(request), { resourceId: 10023355, directoryPath: "/docs" });
  });
}

async function testDeleteDirBusinessFailure() {
  await withServer(async (_server, port) => {
    const result = await runCli(["delete-dir", "--resource-id", "10023355", "--directory-path", "/missing"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "delete-dir failure");
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /资源不存在/);
  }, { businessFailure: "deleteFolder" });
}

async function testListSuccess() {
  await withServer(async (server, port) => {
    const result = await runCli(["list", "--resource-id", "10023355", "--directory-path", "/docs"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "list");
    assert.equal(result.json.items[0].fileName, "/docs/guide.md");
    assert.equal(Object.prototype.hasOwnProperty.call(result.json.items[0], "directoryPath"), false);
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/queryDirAndFileByLevel");
    assert.deepEqual(parseJsonRequest(request), { resourceId: 10023355, directoryPath: "/docs" });
  });
}

async function testKnManagerUrlFallbackWhenRedisEmpty() {
  await withServer(async (server, port) => {
    const result = await runCli(
      ["list", "--resource-id", "10023355", "--directory-path", "/docs"],
      port,
      "",
      { HOST: "http://127.0.0.1:1", KN_MANAGER_URL: `http://127.0.0.1:${port}` },
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "KN_MANAGER_URL fallback");
    assert.equal(server.requests.some((item) => item.url === "/byaiService/datasetController/queryDirAndFileByLevel"), true);
  });
}

async function testRedisErrorFallsBackToHostLikeBycli() {
  await withServer(async (server, port) => {
    const result = await runCli(
      ["list", "--resource-id", "10023355", "--directory-path", "/docs"],
      port,
      "",
      {
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: "1",
        KN_MANAGER_URL: "http://127.0.0.1:2",
        HOST: `http://127.0.0.1:${port}`,
        BYCLAW_REDIS_DISCOVERY_TIMEOUT_MS: "500",
      },
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "Redis error fallback");
    assert.equal(server.requests.some((item) => item.url === "/byaiService/datasetController/queryDirAndFileByLevel"), true);
  });
}

async function testListFailure() {
  await withServer(async (_server, port) => {
    const result = await runCli(["list", "--resource-id", "999", "--directory-path", "/"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "list failure");
    assert.match(result.json.error, /资源不存在/);
  }, { businessFailure: "queryDirAndFileByLevel" });
}

async function testCheckConflictsSuccess() {
  await withServer(async (_server, port) => {
    const result = await runCli(["check-conflicts", "--resource-id", "10023355", "--directory-path", "/docs", "--file-name", "exists.md"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "check-conflicts");
    assert.equal(result.json.conflict, true);
    assert.equal(result.json.needsOverwriteConfirmation, true);
    assert.deepEqual(result.json.overwritePaths, ["/docs/exists.md"]);
  });
}

async function testCheckConflictsMissingFileNamesFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["check-conflicts", "--resource-id", "10023355", "--directory-path", "/docs"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "check-conflicts failure");
    assert.match(result.json.error, /file-name/);
  });
}

async function testUploadSuccessAutoBuildsWithFrontMatterDefaultTrue() {
  const temp = makeTempMarkdown();
  await withServer(async (server, port) => {
    const result = await runCli(["upload", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.ok, true);
    assertPublicOutput(result.json, "upload");
    assert.equal(result.json.uploaded.uploadItems[0].filePath, "/docs/guide.md");
    assert.equal(result.json.builds.length, 1);
    const upload = server.requests.find((item) => item.url === "/byaiService/datasetController/uploadFiles");
    assert.match(upload.bodyText, /name="processFrontMatter"\r\n\r\ntrue/);
    assert.match(upload.bodyText, /name="overwrite"\r\n\r\nfalse/);
    assert.match(upload.bodyText, /filename="guide\.md"/);
    const build = server.requests.find((item) => item.url === "/byaiService/datasetController/build");
    assert.deepEqual(parseJsonRequest(build), { resourceId: 10023355, directoryPath: "/docs/guide.md" });
    assertNoLegacyIngestEndpoints(server);
  });
}

async function testUploadMissingFileFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["upload", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", "/tmp/not-here-by-km.md"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "upload missing file failure");
    assert.match(result.json.error, /文件不存在/);
  });
}

async function testUploadUnsupportedFileTypeFailsBeforeRequest() {
  const temp = makeTempMarkdown("archive.zip");
  await withServer(async (server, port) => {
    const result = await runCli(["upload", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "upload unsupported file type failure");
    assert.match(result.json.error, /不支持的文件类型/);
    assert.equal(server.requests.length, 0);
  });
}

async function testUploadEmptyItemsFails() {
  const temp = makeTempMarkdown();
  await withServer(async (_server, port) => {
    const result = await runCli(["upload", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "upload empty items failure");
    assert.match(result.json.error, /uploadItems/);
  }, { emptyUploadItems: true });
}

async function testUploadItemWithoutPathFails() {
  const temp = makeTempMarkdown();
  await withServer(async (_server, port) => {
    const result = await runCli(["upload", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "upload item without path failure");
    assert.match(result.json.error, /filePath/);
  }, { uploadItemsWithoutPath: true });
}

async function testUploadPartialItemWithoutPathFails() {
  const temp = makeTempMarkdown();
  await withServer(async (_server, port) => {
    const result = await runCli(["upload", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "upload partial path failure");
    assert.match(result.json.error, /filePath/);
  }, { partialUploadItemWithoutPath: true });
}

async function testUpdateFileSuccessChecksConflictOverwritesAndBuilds() {
  const temp = makeTempMarkdown("exists.md");
  await withServer(async (server, port) => {
    const result = await runCli(["update-file", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "update-file");
    assert.equal(result.json.conflict.conflict, true);
    assert.equal(result.json.builds.length, 1);
    const conflict = server.requests.find((item) => item.url === "/byaiService/datasetController/checkUploadFileConflicts");
    assert.deepEqual(parseJsonRequest(conflict), { resourceId: 10023355, directoryPath: "/docs", fileNames: ["exists.md"] });
    const upload = server.requests.find((item) => item.url === "/byaiService/datasetController/uploadFiles");
    assert.match(upload.bodyText, /name="overwrite"\r\n\r\ntrue/);
    assert.match(upload.bodyText, /name="processFrontMatter"\r\n\r\ntrue/);
  });
}

async function testUpdateFileUnsupportedFileTypeFailsBeforeRequest() {
  const temp = makeTempMarkdown("exists.zip");
  await withServer(async (server, port) => {
    const result = await runCli(["update-file", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "update-file unsupported file type failure");
    assert.match(result.json.error, /不支持的文件类型/);
    assert.equal(server.requests.length, 0);
  });
}

async function testUpdateFileConflictCheckFailureFails() {
  const temp = makeTempMarkdown("exists.md");
  await withServer(async (_server, port) => {
    const result = await runCli(["update-file", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "update-file conflict failure");
    assert.match(result.json.error, /资源不存在/);
  }, { businessFailure: "checkUploadFileConflicts" });
}

async function testUpdateFileBuildFailureFails() {
  const temp = makeTempMarkdown("exists.md");
  await withServer(async (_server, port) => {
    const result = await runCli(["update-file", "--resource-id", "10023355", "--directory-path", "/docs", "--file-path", temp.filePath], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "update-file build failure");
    assert.match(result.json.error, /mock unavailable|HTTP 503/);
  }, { httpFailure: "build" });
}

async function testBuildSuccess() {
  await withServer(async (server, port) => {
    const result = await runCli(["build", "--resource-id", "10023355", "--file-path", "/docs/guide.md"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "build");
    assert.equal(result.json.built, null);
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/build");
    assert.deepEqual(parseJsonRequest(request), { resourceId: 10023355, directoryPath: "/docs/guide.md" });
  });
}

async function testBuildMissingPathFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["build", "--resource-id", "10023355"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "build failure");
    assert.match(result.json.error, /file-path/);
  });
}

async function testBuildStatusSuccess() {
  await withServer(async (server, port) => {
    const result = await runCli(["build-status", "--resource-id", "10023355", "--file-path", "/docs/guide.md"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "build-status");
    assert.equal(result.json.status.status, "complete");
    const request = server.requests.find((item) => item.url?.startsWith("/byaiService/datasetController/fileBuildStatus"));
    assert.match(request.url, /resourceId=10023355/);
    assert.match(decodeURIComponent(request.url), /directoryPath=\/docs\/guide\.md/);
  });
}

async function testBuildStatusHttpFailureFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["build-status", "--resource-id", "10023355", "--file-path", "/docs/guide.md"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "build-status failure");
    assert.match(result.json.error, /HTTP 503/);
  }, { httpFailure: "fileBuildStatus" });
}

async function testDownloadSuccess() {
  await withServer(async (_server, port) => {
    const out = path.join(os.tmpdir(), `by-km-download-${Date.now()}.md`);
    const result = await runCli(["download", "--resource-id", "10023355", "--file-path", "/docs/guide.md", "--output", out], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "download");
    assert.equal(fs.readFileSync(out, "utf8"), "# Guide\n");
    assert.equal(result.json.bytes, 8);
    assert.equal(result.json.fileName, "guide.md");
    fs.rmSync(out, { force: true });
  });
}

async function testDownloadMissingOutputFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["download", "--resource-id", "10023355", "--file-path", "/docs/guide.md"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "download missing output failure");
    assert.match(result.json.error, /output/);
  });
}

async function testDownloadHttpFailureFails() {
  await withServer(async (_server, port) => {
    const out = path.join(os.tmpdir(), `by-km-download-fail-${Date.now()}.md`);
    const result = await runCli(["download", "--resource-id", "10023355", "--file-path", "/docs/guide.md", "--output", out], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "download http failure");
    assert.match(result.json.error, /HTTP 503/);
  }, { httpFailure: "download" });
}

async function testDownloadBusinessFailureJsonDoesNotWriteFile() {
  await withServer(async (_server, port) => {
    const out = path.join(os.tmpdir(), `by-km-download-business-fail-${Date.now()}.md`);
    const result = await runCli(["download", "--resource-id", "10023355", "--file-path", "/docs/missing.md", "--output", out], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "download business failure");
    assert.match(result.json.error, /资源不存在/);
    assert.equal(fs.existsSync(out), false);
  }, { downloadBusinessFailure: true });
}

async function testDownloadDirectoryUsesDirectoryPath() {
  await withServer(async (server, port) => {
    const out = path.join(os.tmpdir(), `by-km-download-dir-${Date.now()}.zip`);
    const result = await runCli(["download", "--resource-id", "10023355", "--directory-path", "/docs", "--output", out], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "download directory");
    const request = server.requests.find((item) => item.url?.startsWith("/byaiService/datasetController/download"));
    assert.match(request.url, /directoryPath=%2Fdocs/);
    fs.rmSync(out, { force: true });
  });
}

async function testDownloadRejectsBothFileAndDirectoryPath() {
  await withServer(async (_server, port) => {
    const out = path.join(os.tmpdir(), `by-km-download-conflict-${Date.now()}.zip`);
    const result = await runCli([
      "download",
      "--resource-id",
      "10023355",
      "--file-path",
      "/docs/guide.md",
      "--directory-path",
      "/docs",
      "--output",
      out,
    ], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "download path conflict");
    assert.match(result.json.error, /file-path.*directory-path|directory-path.*file-path/);
  });
}

async function testReadFileSuccessWithOptionalLines() {
  await withServer(async (server, port) => {
    const result = await runCli([
      "read-file",
      "--resource-id",
      "10023355",
      "--file-path",
      "/docs/guide.md",
      "--start-line",
      "1",
      "--end-line",
      "20",
    ], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "read-file");
    assert.equal(result.json.action, "read-file");
    assert.equal(result.json.file.resourceId, 10023355);
    assert.equal(result.json.file.filePath, "/docs/guide.md");
    assert.equal(result.json.file.content, "# Guide\n\nbody\n");
    assert.equal(result.json.file.reachedEof, true);
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/readFile");
    assert.deepEqual(parseJsonRequest(request), {
      resourceId: 10023355,
      filePath: "/docs/guide.md",
      startLine: 1,
      endLine: 20,
    });
  });
}

async function testReadFileWithoutLinesOmitsOptionalLinePayload() {
  await withServer(async (server, port) => {
    const result = await runCli(["read-file", "--resource-id", "10023355", "--file-path", "/docs/guide.md"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "read-file without lines");
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/readFile");
    assert.deepEqual(parseJsonRequest(request), {
      resourceId: 10023355,
      filePath: "/docs/guide.md",
    });
  });
}

async function testReadFileMissingFilePathFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["read-file", "--resource-id", "10023355"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "read-file failure");
    assert.match(result.json.error, /file-path/);
  });
}

async function testSearchSuccessFixesSearchModeMixedRecall() {
  await withServer(async (server, port) => {
    const result = await runCli(["search", "--resource-id", "10023355", "--query", "员工请假流程是什么", "--top-k", "5"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "search");
    assert.equal(result.json.action, "search");
    assert.deepEqual(result.json.resourceIds, [10023355]);
    assert.equal(result.json.query, "员工请假流程是什么");
    assert.equal(result.json.topK, 5);
    assert.equal(result.json.items[0].resourceId, 10023355);
    assert.equal(result.json.items[0].filePath, "/docs/guide.md");
    assert.equal(result.json.items[0].chunkText, "# Guide\n\nbody");
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/knowledgeItems/search");
    assert.deepEqual(parseJsonRequest(request), {
      resourceIdList: [10023355],
      query: "员工请假流程是什么",
      topK: 5,
      searchMode: "mixedRecall",
    });
  });
}

async function testSearchMissingQueryFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["search", "--resource-id", "10023355"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "search failure");
    assert.match(result.json.error, /query/);
  });
}

async function testRemoveFileSuccess() {
  await withServer(async (server, port) => {
    const result = await runCli(["remove-file", "--resource-id", "10023355", "--file-path", "/docs/guide.md"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "remove-file");
    assert.equal(result.json.removed, null);
    const request = server.requests.find((item) => item.url === "/byaiService/datasetController/removeFile");
    assert.deepEqual(parseJsonRequest(request), { resourceId: 10023355, directoryPath: "/docs/guide.md" });
  });
}

async function testRemoveFileFailure() {
  await withServer(async (_server, port) => {
    const result = await runCli(["remove-file", "--resource-id", "10023355", "--file-path", "/docs/missing.md"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "remove-file failure");
    assert.match(result.json.error, /资源不存在/);
  }, { businessFailure: "removeFile" });
}

async function testRemoveFileMissingFilePathFails() {
  await withServer(async (_server, port) => {
    const result = await runCli(["remove-file", "--resource-id", "10023355", "--directory-path", "/docs/guide.md"], port);
    assert.equal(result.code, 1);
    assertPublicOutput(result.json, "remove-file missing file-path");
    assert.match(result.json.error, /file-path/);
  });
}

async function testHelpIsUsefulManualWithoutRuntimeInternals() {
  await withServer(async (_server, port) => {
    const result = await runCli(["help"], port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assertPublicOutput(result.json, "help");
    assert.equal(result.json.ok, true);
    assert.equal(result.json.name, "by-knowledge-manager");
    assert.equal(result.json.usage, "node /app/scripts/by-knowledge-manager.mjs <command> [options]");
    assert.equal(result.json.commands.mkdir.description, "创建知识库目录");
    assert.deepEqual(result.json.commands.mkdir.required, ["--resource-id", "--directory-path", "--directory-name"]);
    assert.equal(result.json.commands.upload.description, "上传文件到知识库目录，成功后自动触发构建");
    assert.deepEqual(result.json.commands.upload.required, ["--resource-id", "--directory-path", "--file-path"]);
    assert.equal(result.json.commands["build-status"].description, "查询知识文件构建状态");
    assert.deepEqual(result.json.commands.build.required, ["--resource-id", "--file-path"]);
    assert.deepEqual(result.json.commands["build-status"].required, ["--resource-id", "--file-path"]);
    assert.deepEqual(result.json.commands.download.required, ["--resource-id", "--output", "--file-path 或 --directory-path"]);
    assert.equal(result.json.commands["read-file"].description, "读取知识库文件指定行范围内容");
    assert.deepEqual(result.json.commands["read-file"].required, ["--resource-id", "--file-path"]);
    assert.equal(result.json.commands.search.description, "检索知识库内容");
    assert.deepEqual(result.json.commands.search.required, ["--resource-id", "--query"]);
    assert.deepEqual(result.json.commands["remove-file"].required, ["--resource-id", "--file-path"]);
    assert.equal(JSON.stringify(result.json).includes("searchMode"), false);
    assert.equal(JSON.stringify(result.json).includes("--dry-run"), false);
  });
}

const tests = [
  testHelpIsUsefulManualWithoutRuntimeInternals,
  testMkdirSuccess,
  testMkdirMissingNameFails,
  testRenameDirSuccess,
  testRenameDirMissingPathFails,
  testDeleteDirSuccess,
  testDeleteDirBusinessFailure,
  testListSuccess,
  testKnManagerUrlFallbackWhenRedisEmpty,
  testRedisErrorFallsBackToHostLikeBycli,
  testListFailure,
  testCheckConflictsSuccess,
  testCheckConflictsMissingFileNamesFails,
  testUploadSuccessAutoBuildsWithFrontMatterDefaultTrue,
  testUploadMissingFileFails,
  testUploadUnsupportedFileTypeFailsBeforeRequest,
  testUploadEmptyItemsFails,
  testUploadItemWithoutPathFails,
  testUploadPartialItemWithoutPathFails,
  testUpdateFileSuccessChecksConflictOverwritesAndBuilds,
  testUpdateFileUnsupportedFileTypeFailsBeforeRequest,
  testUpdateFileConflictCheckFailureFails,
  testUpdateFileBuildFailureFails,
  testBuildSuccess,
  testBuildMissingPathFails,
  testBuildStatusSuccess,
  testBuildStatusHttpFailureFails,
  testDownloadSuccess,
  testDownloadMissingOutputFails,
  testDownloadHttpFailureFails,
  testDownloadBusinessFailureJsonDoesNotWriteFile,
  testDownloadDirectoryUsesDirectoryPath,
  testDownloadRejectsBothFileAndDirectoryPath,
  testReadFileSuccessWithOptionalLines,
  testReadFileWithoutLinesOmitsOptionalLinePayload,
  testReadFileMissingFilePathFails,
  testSearchSuccessFixesSearchModeMixedRecall,
  testSearchMissingQueryFails,
  testRemoveFileSuccess,
  testRemoveFileFailure,
  testRemoveFileMissingFilePathFails,
];

for (const test of tests) {
  await test();
}

console.log("by-knowledge-manager tests passed");
