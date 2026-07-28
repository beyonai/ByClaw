#!/usr/bin/env node

import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(TEST_DIR, "knowledge-collection-ingest.mjs");
const KNOWLEDGE_MANAGER_SCRIPT = path.resolve(
  TEST_DIR,
  "../../by-knowledge-manager/scripts/by-knowledge-manager.mjs",
);

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

      if (req.url === "/large.png") {
        const body = Buffer.alloc(128, 1);
        res.setHeader("content-type", "image/png");
        res.setHeader("content-length", String(body.length));
        res.end(body);
        return;
      }

      if (req.url === "/slow.png") {
        setTimeout(() => {
          if (!res.destroyed) {
            res.setHeader("content-type", "image/png");
            res.end(Buffer.from("slow-png"));
          }
        }, 200);
        return;
      }

      if (req.url === "/redirect.png") {
        res.statusCode = 302;
        res.setHeader("location", "/redirect.png");
        res.end();
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

function runCli(args, input, port, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: `http://127.0.0.1:${port}`,
        REDIS_HOST: "",
        BEYOND_TOKEN: "system-token",
        BY_KNOWLEDGE_MANAGER_SCRIPT: KNOWLEDGE_MANAGER_SCRIPT,
        ...envOverrides,
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

function canonicalItem(markdown, fileName = markdown, overrides = {}) {
  return {
    title: "Canonical article",
    url: "https://example.com/article",
    author: "Author",
    publishTime: "2026-07-28T00:00:00Z",
    markdown,
    fileName,
    ...overrides,
  };
}

function canonicalCollection(items, overrides = {}) {
  return {
    schemaVersion: "1.0",
    title: "Canonical collection",
    source: "public-internet",
    backend: "bycli",
    url: "https://example.com/collection",
    filters: {},
    items,
    ...overrides,
  };
}

async function testHelpUsesMigratedIdentityAndCanonicalInputFirst() {
  const result = await runCli(["--help"], undefined, 0);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /knowledge-collection-ingest/);
  assert.match(result.stdout, /--collection-result-file <file>/);
  assert.match(result.stdout, /--collection-result-json <json> \(inline compatibility; relative paths require --collection-result-file\)/);
  assert.match(result.stdout, /--bycli-json-file <file> \(legacy compatibility\)/);
  assert.match(result.stdout, /--bycli-json <json> \(legacy compatibility\)/);
}

async function testCanonicalCollectionResultPreservesMarkdownFrontmatter() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-fixture-"));
  const fixturePath = path.join(fixtureDir, "collection-result.json");
  const relativeMarkdownPath = "sanitized/items/tea.md";
  const markdownPath = path.join(fixtureDir, relativeMarkdownPath);
  const markdown = "---\ncollection_filters:\n  - 茶叶\n---\n\n# Tea collection\n\n龙井";
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(fixturePath, JSON.stringify({
    schemaVersion: "1.0",
    title: "Tea collection",
    source: "xiaohongshu",
    backend: "bycli",
    url: "https://example.com/collection/tea",
    filters: { keywords: ["茶叶"] },
    items: [{
      title: "Tea collection",
      url: "https://example.com/tea",
      author: "Tea author",
      publishTime: "2026-07-27T00:00:00Z",
      fileName: relativeMarkdownPath,
      markdown: relativeMarkdownPath,
    }],
  }));
  try {
    const result = await runCli(["normalize", "--collection-result-file", fixturePath], undefined, 0);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.payloads?.collectionResult?.items?.length, 1);
    const normalized = result.json?.payloads?.collectionResult;
    assert.equal(normalized?.items?.[0]?.fileName, relativeMarkdownPath);
    assert.equal(normalized?.items?.[0]?.markdown, markdown);
    assert.equal(normalized?.schemaVersion, "1.0");
    assert.equal(normalized?.title, "Tea collection");
    assert.equal(normalized?.source, "xiaohongshu");
    assert.equal(normalized?.backend, "bycli");
    assert.equal(normalized?.url, "https://example.com/collection/tea");
    assert.deepEqual(normalized?.filters, { keywords: ["茶叶"] });
    assert.equal(normalized?.items?.[0]?.sourceUrl, "https://example.com/tea");
    assert.equal(normalized?.items?.[0]?.author, "Tea author");
    assert.equal(normalized?.items?.[0]?.publishTime, "2026-07-27T00:00:00Z");
    assert.equal(normalized?.items?.[0]?.localPath, undefined);
    assert.doesNotMatch(result.stdout, new RegExp(fixtureDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(normalized?.items?.[0]?.markdown || "", /collection_filters:\n  - 茶叶/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function testCanonicalCollectionResultRejectsInvalidContractShapes() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-contract-"));
  const markdownRelativePath = "sanitized/items/article.md";
  const textRelativePath = "sanitized/items/article.txt";
  fs.mkdirSync(path.join(fixtureDir, "sanitized/items"), { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, markdownRelativePath), "# Canonical article");
  fs.writeFileSync(path.join(fixtureDir, textRelativePath), "not markdown");
  const cases = [
    {
      name: "missing-version",
      mutate(value) { delete value.schemaVersion; },
      error: /schemaVersion.*1\.0/,
    },
    {
      name: "wrong-version",
      mutate(value) { value.schemaVersion = "2.0"; },
      error: /schemaVersion.*1\.0/,
    },
    {
      name: "extra-top-level",
      mutate(value) { value.router = "agent-reach"; },
      error: /不支持的顶层字段.*router/,
    },
    {
      name: "invalid-filters",
      mutate(value) { value.filters = ["tea"]; },
      error: /filters.*对象/,
    },
    {
      name: "empty-items",
      mutate(value) { value.items = []; },
      error: /items.*非空数组/,
    },
    {
      name: "extra-item-field",
      mutate(value) { value.items[0].localPath = "/tmp/article.md"; },
      error: /items\[0\].*不支持的字段.*localPath/,
    },
    {
      name: "non-markdown-artifact",
      mutate(value) {
        value.items[0].markdown = textRelativePath;
        value.items[0].fileName = textRelativePath;
      },
      error: /扩展名为 \.md.*Markdown 文件/,
    },
  ];
  try {
    for (const testCase of cases) {
      const value = canonicalCollection([canonicalItem(markdownRelativePath)]);
      testCase.mutate(value);
      const fixturePath = path.join(fixtureDir, `${testCase.name}.json`);
      fs.writeFileSync(fixturePath, JSON.stringify(value));
      const result = await runCli(["normalize", "--collection-result-file", fixturePath], undefined, 0);
      assert.equal(result.code, 1, `${testCase.name}: ${result.stderr || result.stdout}`);
      assert.match(String(result.json?.error || ""), testCase.error, testCase.name);
    }
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function testCanonicalCollectionResultRejectsUnsafeOrMissingMarkdownPaths() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-path-safety-"));
  const outsidePath = path.join(path.dirname(fixtureDir), `outside-${path.basename(fixtureDir)}.md`);
  const symlinkPath = path.join(fixtureDir, "escaped.md");
  fs.writeFileSync(outsidePath, "# must not be read");
  fs.symlinkSync(outsidePath, symlinkPath);
  const cases = [
    {
      name: "traversal",
      markdown: `../${path.basename(outsidePath)}`,
      fileName: `../${path.basename(outsidePath)}`,
      error: /越出采集根目录/,
    },
    {
      name: "absolute",
      markdown: outsidePath,
      fileName: outsidePath,
      error: /不能使用绝对路径/,
    },
    {
      name: "missing",
      markdown: "sanitized/items/missing.md",
      fileName: "sanitized/items/missing.md",
      error: /不存在或无法读取/,
    },
    {
      name: "symlink-escape",
      markdown: "escaped.md",
      fileName: "escaped.md",
      error: /符号链接越出采集根目录/,
    },
  ];
  try {
    for (const testCase of cases) {
      const fixturePath = path.join(fixtureDir, `${testCase.name}.json`);
      fs.writeFileSync(fixturePath, JSON.stringify(canonicalCollection([
        canonicalItem(testCase.markdown, testCase.fileName, { title: testCase.name }),
      ])));
      const result = await runCli(["normalize", "--collection-result-file", fixturePath], undefined, 0);
      assert.equal(result.code, 1, result.stderr || result.stdout);
      assert.match(String(result.json?.error || ""), testCase.error);
      assert.doesNotMatch(result.stdout, /must not be read/);
      if (testCase.name === "absolute") {
        assert.doesNotMatch(result.stdout, new RegExp(outsidePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    }
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(outsidePath, { force: true });
  }
}

async function testCanonicalCollectionResultRejectsMismatchedMarkdownAndFileName() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-mismatch-"));
  const fixturePath = path.join(fixtureDir, "collection-result.json");
  fs.writeFileSync(path.join(fixtureDir, "a.md"), "# Preview A");
  fs.writeFileSync(path.join(fixtureDir, "b.md"), "# Ingest B");
  fs.writeFileSync(fixturePath, JSON.stringify(canonicalCollection([
    canonicalItem("a.md", "b.md", { title: "Mismatch" }),
  ])));
  try {
    const result = await runCli(["normalize", "--collection-result-file", fixturePath], undefined, 0);
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /必须指向同一个 Markdown 文件/);
    assert.doesNotMatch(result.stdout, new RegExp(fixtureDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function testCollectionResultJsonIsExplicitInlineCompatibilityOnly() {
  const canonicalJson = JSON.stringify({
    schemaVersion: "1.0",
    items: [{ title: "Canonical path", markdown: "sanitized/item.md", fileName: "sanitized/item.md" }],
  });
  const canonicalResult = await runCli(["normalize", "--collection-result-json", canonicalJson], undefined, 0);
  assert.equal(canonicalResult.code, 1, canonicalResult.stderr || canonicalResult.stdout);
  assert.match(String(canonicalResult.json?.error || ""), /--collection-result-file/);

  const inlineJson = JSON.stringify({ items: [{ title: "Inline compatibility", markdown: "# Inline compatibility" }] });
  const inlineResult = await runCli(["normalize", "--collection-result-json", inlineJson], undefined, 0);
  assert.equal(inlineResult.code, 0, inlineResult.stderr || inlineResult.stdout);
  assert.equal(inlineResult.json?.payloads?.collectionResult?.items?.[0]?.markdown, "# Inline compatibility");
}

async function testCanonicalIngestUsesValidatedRootArtifactDespiteDirectoryOverrides() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-canonical-ingest-"));
  const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-override-"));
  const relativeMarkdownPath = "sanitized/items/article.md";
  const canonicalMarkdownPath = path.join(fixtureDir, relativeMarkdownPath);
  const overrideMarkdownPath = path.join(overrideDir, relativeMarkdownPath);
  fs.mkdirSync(path.dirname(canonicalMarkdownPath), { recursive: true });
  fs.mkdirSync(path.dirname(overrideMarkdownPath), { recursive: true });
  fs.writeFileSync(canonicalMarkdownPath, "# Canonical artifact");
  fs.writeFileSync(overrideMarkdownPath, "# Untrusted override");
  const fixturePath = path.join(fixtureDir, "collection-result.json");
  fs.writeFileSync(fixturePath, JSON.stringify(canonicalCollection([
    canonicalItem(relativeMarkdownPath, relativeMarkdownPath, { title: "Canonical" }),
  ])));
  try {
    const result = await runCli([
      "ingest",
      "--dry-run",
      "--collection-result-file", fixturePath,
      "--output-dir", overrideDir,
      "--session-dir", overrideDir,
      "--knowledge-base-resource-id", "90001",
    ], undefined, 0);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.upload?.files?.[0]?.fileName, relativeMarkdownPath);
    assert.equal(result.json?.upload?.files?.[0]?.source, "validated-canonical");
    assert.equal(result.json?.upload?.files?.[0]?.existingPath, undefined);
    assert.equal(result.json?.upload?.confirmation?.requiredArguments?.["confirmed-knowledge-base-resource-id"], 90001);
    assert.equal(result.json?.upload?.confirmation?.requiredArguments?.["confirmed-directory-path"], "/");
    assert.doesNotMatch(result.stdout, new RegExp(fixtureDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(result.stdout, new RegExp(overrideDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(result.json?.payloads, undefined);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(overrideDir, { recursive: true, force: true });
  }
}

async function testCanonicalActualIngestKeepsValidatedPathPrivate() {
  const server = createServer();
  const port = await server.listen();
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-private-ingest-"));
  const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-private-override-"));
  const relativeMarkdownPath = "sanitized/items/private.md";
  const canonicalMarkdownPath = path.join(fixtureDir, relativeMarkdownPath);
  const overrideMarkdownPath = path.join(overrideDir, relativeMarkdownPath);
  fs.mkdirSync(path.dirname(canonicalMarkdownPath), { recursive: true });
  fs.mkdirSync(path.dirname(overrideMarkdownPath), { recursive: true });
  fs.writeFileSync(canonicalMarkdownPath, "# Canonical private artifact");
  fs.writeFileSync(overrideMarkdownPath, "# Untrusted private override");
  const fixturePath = path.join(fixtureDir, "collection-result.json");
  fs.writeFileSync(fixturePath, JSON.stringify(canonicalCollection([
    canonicalItem(relativeMarkdownPath, relativeMarkdownPath, { title: "Private" }),
  ])));
  try {
    const result = await runCli([
      "ingest",
      "--collection-result-file", fixturePath,
      "--session-dir", overrideDir,
      "--knowledge-base-resource-id", "90001",
      "--confirmed-knowledge-base-resource-id", "90001",
      "--confirmed-directory-path", "/",
    ], undefined, port);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const upload = server.requests.find((request) => request.url === "/byaiService/datasetController/uploadFiles");
    assert.ok(upload, "expected canonical Markdown to be uploaded");
    assert.match(upload.bodyText, /Canonical private artifact/);
    assert.doesNotMatch(upload.bodyText, /Untrusted private override/);
    assert.equal(result.json?.uploaded?.files?.[0]?.source, "validated-canonical");
    assert.doesNotMatch(result.stdout, /localPath/);
    assert.doesNotMatch(result.stdout, new RegExp(fixtureDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(result.stdout, new RegExp(overrideDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(overrideDir, { recursive: true, force: true });
    await server.close();
  }
}

async function testCanonicalInputPrecedesLegacyAndLegacyRemainsSupported() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-precedence-"));
  const canonicalPath = path.join(fixtureDir, "canonical.json");
  const canonicalMarkdownPath = path.join(fixtureDir, "sanitized/canonical.md");
  const legacyPath = path.join(fixtureDir, "legacy.json");
  fs.mkdirSync(path.dirname(canonicalMarkdownPath), { recursive: true });
  fs.writeFileSync(canonicalMarkdownPath, "# Canonical");
  fs.writeFileSync(canonicalPath, JSON.stringify(canonicalCollection([
    canonicalItem("sanitized/canonical.md", "sanitized/canonical.md", { title: "Canonical" }),
  ])));
  fs.writeFileSync(legacyPath, JSON.stringify({ items: [{ title: "Legacy", markdown: "# Legacy" }] }));
  try {
    const precedenceResult = await runCli([
      "normalize",
      "--bycli-json-file",
      legacyPath,
      "--collection-result-file",
      canonicalPath,
    ], undefined, 0);
    assert.equal(precedenceResult.code, 0, precedenceResult.stderr || precedenceResult.stdout);
    assert.equal(precedenceResult.json?.payloads?.collectionResult?.items?.[0]?.markdown, "# Canonical");
    assert.deepEqual(precedenceResult.json?.payloads?.collectionResult?.filters, {});

    const legacyResult = await runCli(["normalize", "--bycli-json-file", legacyPath], undefined, 0);
    assert.equal(legacyResult.code, 0, legacyResult.stderr || legacyResult.stdout);
    assert.equal(legacyResult.json?.payloads?.collectionResult?.items?.[0]?.markdown, "# Legacy");
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function testLegacyInlineBycliJsonRemainsSupported() {
  const legacyJson = JSON.stringify({
    items: [{
      title: "Legacy inline",
      content: "# Legacy inline\n\n正文",
    }],
  });
  const result = await runCli(["normalize", "--bycli-json", legacyJson], undefined, 0);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.json?.payloads?.collectionResult?.items?.length, 1);
  assert.equal(result.json?.payloads?.collectionResult?.items?.[0]?.title, "Legacy inline");
  assert.equal(result.json?.payloads?.collectionResult?.items?.[0]?.markdown, "# Legacy inline\n\n正文");
}

async function testRemoteResourceRejectsPrivateAddressByDefault() {
  const server = createServer();
  const port = await server.listen();
  try {
    const urls = [
      `http://127.0.0.1:${port}/asset.png`,
      "http://10.0.0.1/resource.png",
      "http://169.254.169.254/latest/meta-data.png",
      "http://198.51.100.1/resource.png",
      "http://203.0.113.1/resource.png",
      "http://[::1]/resource.png",
      "http://[::ffff:7f00:1]/resource.png",
    ];
    for (const url of urls) {
      const result = await runCli(
        ["upload-resource", "--file-url", url],
        {},
        port,
        { KNOWLEDGE_COLLECTION_RESOURCE_TIMEOUT_MS: "20" },
      );
      assert.equal(result.code, 1, `${url}: ${result.stderr || result.stdout}`);
      assert.match(String(result.json?.error || ""), /私有或保留地址/, url);
    }
    const explicitFalse = await runCli(
      ["upload-resource", "--allow-private-resource=false", "--file-url", `http://127.0.0.1:${port}/asset.png`],
      {},
      port,
    );
    assert.equal(explicitFalse.code, 1, explicitFalse.stderr || explicitFalse.stdout);
    assert.match(String(explicitFalse.json?.error || ""), /私有或保留地址/);
    assert.equal(server.requests.some((request) => request.url === "/asset.png"), false);
  } finally {
    await server.close();
  }
}

async function testRemoteResourceRejectsUrlCredentials() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["upload-resource", "--allow-private-resource", "--file-url", `http://user:password@127.0.0.1:${port}/asset.png`],
      {},
      port,
    );
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /用户名或密码/);
  } finally {
    await server.close();
  }
}

async function testRemoteResourceLimitsRedirects() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      ["upload-resource", "--allow-private-resource", "--file-url", `http://127.0.0.1:${port}/redirect.png`],
      {},
      port,
    );
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /重定向次数/);
  } finally {
    await server.close();
  }
}

async function testRemoteResourceEnforcesTimeoutAndSizeLimits() {
  const server = createServer();
  const port = await server.listen();
  try {
    const oversized = await runCli(
      ["upload-resource", "--allow-private-resource", "--file-url", `http://127.0.0.1:${port}/large.png`],
      {},
      port,
      { KNOWLEDGE_COLLECTION_MAX_RESOURCE_BYTES: "16" },
    );
    assert.equal(oversized.code, 1, oversized.stderr || oversized.stdout);
    assert.match(String(oversized.json?.error || ""), /单文件大小上限/);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/chat/uploadFiles"), false);

    const timedOut = await runCli(
      ["upload-resource", "--allow-private-resource", "--file-url", `http://127.0.0.1:${port}/slow.png`],
      {},
      port,
      { KNOWLEDGE_COLLECTION_RESOURCE_TIMEOUT_MS: "20" },
    );
    assert.equal(timedOut.code, 1, timedOut.stderr || timedOut.stdout);
    assert.match(String(timedOut.json?.error || ""), /下载超时/);

    const malformedLimitFallsBack = await runCli(
      ["upload-resource", "--allow-private-resource", "--file-url", `http://127.0.0.1:${port}/large.png`],
      {},
      port,
      { KNOWLEDGE_COLLECTION_MAX_RESOURCE_BYTES: "16bytes" },
    );
    assert.equal(malformedLimitFallsBack.code, 0, malformedLimitFallsBack.stderr || malformedLimitFallsBack.stdout);
  } finally {
    await server.close();
  }
}

async function testLocalResourceEnforcesFileAndBatchLimits() {
  const server = createServer();
  const port = await server.listen();
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-limits-"));
  const firstPath = path.join(fixtureDir, "first.png");
  const secondPath = path.join(fixtureDir, "second.png");
  fs.writeFileSync(firstPath, Buffer.alloc(12, 1));
  fs.writeFileSync(secondPath, Buffer.alloc(12, 2));
  try {
    const oversized = await runCli(
      ["upload-resource", "--file-path", firstPath],
      {},
      port,
      { KNOWLEDGE_COLLECTION_MAX_RESOURCE_BYTES: "8" },
    );
    assert.equal(oversized.code, 1, oversized.stderr || oversized.stdout);
    assert.match(String(oversized.json?.error || ""), /单文件大小上限/);

    const tooMany = await runCli(
      ["upload-resource", "--file-path", firstPath, "--file-path", secondPath],
      {},
      port,
      { KNOWLEDGE_COLLECTION_MAX_RESOURCES: "1" },
    );
    assert.equal(tooMany.code, 1, tooMany.stderr || tooMany.stdout);
    assert.match(String(tooMany.json?.error || ""), /资源数量上限/);

    const batchTooLarge = await runCli(
      ["upload-resource", "--file-path", firstPath, "--file-path", secondPath],
      {},
      port,
      { KNOWLEDGE_COLLECTION_MAX_BATCH_BYTES: "16" },
    );
    assert.equal(batchTooLarge.code, 1, batchTooLarge.stderr || batchTooLarge.stdout);
    assert.match(String(batchTooLarge.json?.error || ""), /批次大小上限/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    await server.close();
  }
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

async function testLegacyKnowledgeBaseIdResolvesToResourceId() {
  const server = createServer();
  const port = await server.listen();
  try {
    const wrongConfirmation = await runCli(
      [
        "ingest",
        "--knowledge-base-id", "80001",
        "--confirmed-knowledge-base-resource-id", "80001",
        "--confirmed-directory-path", "/",
      ],
      { content: "# Legacy target" },
      port,
    );
    assert.equal(wrongConfirmation.code, 1, wrongConfirmation.stderr || wrongConfirmation.stdout);
    assert.match(String(wrongConfirmation.json?.error || ""), /confirmed-knowledge-base-resource-id/);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/datasetController/uploadFiles"), false);

    const resolved = await runCli(
      [
        "ingest",
        "--knowledge-base-id", "80001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
      { content: "# Legacy target" },
      port,
    );
    assert.equal(resolved.code, 0, resolved.stderr || resolved.stdout);
    assert.equal(resolved.json?.uploaded?.resourceId, 90001);
  } finally {
    await server.close();
  }
}

async function testImageUrlUploadsToChatFilesAndStops() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(["upload-resource", "--allow-private-resource", "--session-id", "42"], {
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
    const result = await runCli(["upload-resource", "--allow-private-resource", "--session-id", "42"], {
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
    const result = await runCli(["upload-resource", "--allow-private-resource", "--session-id", "42"], {
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

async function testMixedMediaAndMarkdownIngestCompletesBothPhases() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      [
        "ingest",
        "--allow-private-resource",
        "--image-url", `http://127.0.0.1:${port}/asset.png`,
        "--knowledge-base-resource-id", "90001",
        "--directory-path", "/imports",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/imports",
      ],
      { title: "Mixed article", content: "# Mixed article\n\n正文" },
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "ingest");
    assert.equal(result.json?.resourceUpload?.sessionId, 42);
    assert.equal(result.json?.knowledgeIngest?.manager?.action, "upload");
    assert.equal(server.requests.some((request) => request.url === "/byaiService/chat/uploadFiles"), true);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/datasetController/uploadFiles"), true);
  } finally {
    await server.close();
  }
}

async function testMixedStdinObjectKeepsMediaAndMarkdown() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      [
        "ingest",
        "--allow-private-resource",
        "--knowledge-base-resource-id", "90001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
      {
        title: "Mixed stdin article",
        content: "# Mixed stdin article\n\n正文",
        fileUrl: `http://127.0.0.1:${port}/asset.png`,
        fileName: "asset.png",
      },
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "ingest");
    assert.equal(result.json?.resourceUpload?.sessionId, 42);
    assert.equal(result.json?.knowledgeIngest?.manager?.action, "upload");
    assert.equal(server.requests.some((request) => request.url === "/byaiService/chat/uploadFiles"), true);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/datasetController/uploadFiles"), true);
  } finally {
    await server.close();
  }
}

async function testMediaOnlyIngestRejectsBeforeUpload() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      [
        "ingest",
        "--allow-private-resource",
        "--image-url", `http://127.0.0.1:${port}/asset.png`,
        "--knowledge-base-resource-id", "90001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
      {},
      port,
    );
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /upload-resource/);
    assert.equal(server.requests.some((request) => request.url === "/asset.png"), false);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/chat/uploadFiles"), false);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

async function testUploadDocViaDatasetController() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      [
        "upload-doc",
        "--allow-private-resource",
        "--file-url", `http://127.0.0.1:${port}/doc.pdf`,
        "--knowledge-base-resource-id", "90001",
        "--directory-path", "/imports",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/imports",
      ],
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
      [
        "ingest",
        "--markdown-file", mdPath,
        "--knowledge-base-resource-id", "90001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
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
      [
        "ingest",
        "--knowledge-base-resource-id", "90001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
      { content: "# Article\n\n正文" },
      port,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.ok, true);
    assert.equal(result.json?.action, "ingest");
    assert.equal(result.json?.uploaded?.reusedFiles?.length, 0);
    assert.equal(result.json?.uploaded?.generatedFiles?.length, 1);
    assert.match(result.json?.uploaded?.generatedFiles?.[0] || "", /knowledge-collection-ingest-/);
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
      ["upload-resource", "--allow-private-resource", "--file-url", `http://127.0.0.1:${port}/doc.pdf`],
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
      [
        "upload-doc",
        "--allow-private-resource",
        "--file-url", `http://127.0.0.1:${port}/empty.pdf`,
        "--knowledge-base-resource-id", "90001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
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
      [
        "upload-doc",
        "--allow-private-resource",
        "--file-url", `http://127.0.0.1:${port}/doc.PDF`,
        "--knowledge-base-resource-id", "90001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
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

async function testIngestRequiresConfirmedTargetBeforeWrite() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      [
        "ingest",
        "--knowledge-base-resource-id", "90001",
        "--directory-path", "/imports",
      ],
      { content: "# Unconfirmed article" },
      port,
    );
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /confirmed-knowledge-base-resource-id/);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

async function testBareResourceIdFlagsCannotConfirmTarget() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      [
        "ingest",
        "--knowledge-base-resource-id",
        "--confirmed-knowledge-base-resource-id",
        "--confirmed-directory-path", "/",
      ],
      { content: "# Bare flags must not write" },
      port,
    );
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /knowledge-base-resource-id/);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

async function testUploadDocRequiresConfirmedTargetBeforeWrite() {
  const server = createServer();
  const port = await server.listen();
  try {
    const result = await runCli(
      [
        "upload-doc",
        "--file-url", `http://127.0.0.1:${port}/doc.pdf`,
        "--knowledge-base-resource-id", "90001",
        "--directory-path", "/imports",
      ],
      {},
      port,
    );
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /confirmed-knowledge-base-resource-id/);
    assert.equal(server.requests.some((request) => request.url === "/byaiService/datasetController/uploadFiles"), false);
  } finally {
    await server.close();
  }
}

async function testIngestPropagatesOverwriteConfirmationAsNonTerminalState() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-conflict-manager-"));
  const managerPath = path.join(fixtureDir, "manager.mjs");
  fs.writeFileSync(managerPath, `
const command = process.argv[2];
process.stdout.write(JSON.stringify(command === "update-file" ? {
  ok: true,
  action: "update-file",
  uploaded: { uploadItems: [{ filePath: "/imports/Conflict-article.md" }] },
  builds: [{ filePath: "/imports/Conflict-article.md" }],
} : {
  ok: true,
  action: "upload",
  conflict: true,
  needsOverwriteConfirmation: true,
  overwritePaths: ["/imports/Conflict-article.md"],
}));
`);
  let continuationFiles = [];
  try {
    const result = await runCli(
      [
        "ingest",
        "--check-conflicts",
        "--knowledge-manager-script", managerPath,
        "--knowledge-base-resource-id", "90001",
        "--directory-path", "/imports",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/imports",
      ],
      { title: "Conflict article", content: "# Conflict article" },
      0,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json?.action, "confirm-overwrite");
    assert.equal(result.json?.needsOverwriteConfirmation, true);
    assert.deepEqual(result.json?.overwritePaths, ["/imports/Conflict-article.md"]);
    assert.equal(result.json?.uploaded, undefined);
    continuationFiles = result.json?.continuation?.markdownFilePaths || [];
    assert.equal(continuationFiles.length, 1);
    assert.equal(fs.existsSync(continuationFiles[0]), true, "conflict continuation must retain generated Markdown");
    assert.equal(result.json?.continuation?.requiredArguments?.["knowledge-base-resource-id"], 90001);
    assert.equal(result.json?.continuation?.requiredArguments?.["confirmed-knowledge-base-resource-id"], 90001);

    const resumed = await runCli(
      [
        "ingest",
        "--knowledge-manager-script", managerPath,
        "--markdown-file", continuationFiles[0],
        "--knowledge-base-resource-id", "90001",
        "--directory-path", "/imports",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/imports",
        "--confirmed-overwrite-path", "/imports/Conflict-article.md",
      ],
      {},
      0,
    );
    assert.equal(resumed.code, 0, resumed.stderr || resumed.stdout);
    assert.equal(resumed.json?.uploaded?.manager?.action, "update-file");
  } finally {
    for (const filePath of continuationFiles) {
      fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function testIngestRejectsSuccessfulManagerExitWithoutJsonContract() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-empty-manager-"));
  const managerPath = path.join(fixtureDir, "manager.mjs");
  fs.writeFileSync(managerPath, "process.exitCode = 0;\n");
  try {
    const result = await runCli(
      [
        "ingest",
        "--knowledge-manager-script", managerPath,
        "--knowledge-base-resource-id", "90001",
        "--confirmed-knowledge-base-resource-id", "90001",
        "--confirmed-directory-path", "/",
      ],
      { content: "# Manager contract" },
      0,
    );
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ""), /有效 JSON|返回契约/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

await testHelpUsesMigratedIdentityAndCanonicalInputFirst();
await testCanonicalCollectionResultPreservesMarkdownFrontmatter();
await testCanonicalCollectionResultRejectsInvalidContractShapes();
await testCanonicalCollectionResultRejectsUnsafeOrMissingMarkdownPaths();
await testCanonicalCollectionResultRejectsMismatchedMarkdownAndFileName();
await testCollectionResultJsonIsExplicitInlineCompatibilityOnly();
await testCanonicalIngestUsesValidatedRootArtifactDespiteDirectoryOverrides();
await testCanonicalActualIngestKeepsValidatedPathPrivate();
await testCanonicalInputPrecedesLegacyAndLegacyRemainsSupported();
await testLegacyInlineBycliJsonRemainsSupported();
await testRemoteResourceRejectsPrivateAddressByDefault();
await testRemoteResourceRejectsUrlCredentials();
await testRemoteResourceLimitsRedirects();
await testRemoteResourceEnforcesTimeoutAndSizeLimits();
await testLocalResourceEnforcesFileAndBatchLimits();
await testMarkdownIngestListsKnowledgeBasesBeforeImport();
await testLegacyKnowledgeBaseIdResolvesToResourceId();
await testImageUrlUploadsToChatFilesAndStops();
await testVideoUrlUploadsToChatFilesAndStops();
await testAudioUrlUploadsToChatFilesAndStops();
await testMixedMediaAndMarkdownIngestCompletesBothPhases();
await testMixedStdinObjectKeepsMediaAndMarkdown();
await testMediaOnlyIngestRejectsBeforeUpload();
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
await testIngestRequiresConfirmedTargetBeforeWrite();
await testBareResourceIdFlagsCannotConfirmTarget();
await testUploadDocRequiresConfirmedTargetBeforeWrite();
await testIngestPropagatesOverwriteConfirmationAsNonTerminalState();
await testIngestRejectsSuccessfulManagerExitWithoutJsonContract();
console.log("knowledge-collection-ingest tests passed");
