#!/usr/bin/env node

/**
 * gh-repo-fetch.mjs — Fetch repository file tree or file contents from GitHub API.
 *
 * Usage:
 *   node gh-repo-fetch.mjs --tree [--path src/] [--branch main]
 *   node gh-repo-fetch.mjs --file src/index.ts [--branch main]
 *   node gh-repo-fetch.mjs --dir src/utils/ [--branch main]
 *
 * Env: GITHUB_TOKEN (required)
 */

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const repo = getArg("repo") || process.env.GITHUB_PR_REVIEW_REPO || "beyonai/ByClaw";
const branch = getArg("branch") || "main";
const token = process.env.GITHUB_TOKEN;

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

if (!token) {
  const authUrl = "https://github.com/settings/tokens/new?scopes=repo&description=ByClaw+PR+Review+Skill";
  console.log(JSON.stringify({
    ok: false,
    error: "GITHUB_TOKEN not configured",
    auth_required: true,
    auth_url: authUrl,
    message: `GitHub 授权未配置。请点击以下链接创建 Personal Access Token，然后将其设置为环境变量 GITHUB_TOKEN：\n\n${authUrl}\n\n创建时请确保勾选 repo 权限。创建后运行：export GITHUB_TOKEN=<your_token>`,
  }));
  process.exit(1);
}

const API_BASE = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "byclaw-code-analysis-skill",
};

async function ghFetch(path, extraHeaders = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers: { ...headers, ...extraHeaders } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`GitHub API ${res.status}: ${path} — ${body.slice(0, 200)}`);
  }
  return res;
}

async function fetchTree(treePath) {
  const encodedPath = treePath ? `/${encodeURIComponent(treePath).replace(/%2F/g, "/")}` : "";
  const res = await ghFetch(`/repos/${repo}/contents${encodedPath}?ref=${branch}`);
  const items = await res.json();

  if (!Array.isArray(items)) {
    return [{ name: items.name, path: items.path, type: items.type, size: items.size }];
  }

  return items.map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type,
    size: item.size,
  }));
}

async function fetchFile(filePath) {
  const encoded = encodeURIComponent(filePath).replace(/%2F/g, "/");
  const res = await ghFetch(`/repos/${repo}/contents/${encoded}?ref=${branch}`);
  const data = await res.json();

  if (data.encoding === "base64" && data.content) {
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { path: data.path, size: data.size, content };
  }

  if (data.download_url) {
    const dlRes = await fetch(data.download_url, { headers });
    const content = await dlRes.text();
    return { path: data.path, size: data.size, content };
  }

  fail(`Cannot decode file: ${filePath}`);
}

async function fetchDir(dirPath) {
  const tree = await fetchTree(dirPath);
  const files = tree.filter((item) => item.type === "file");
  const dirs = tree.filter((item) => item.type === "dir");

  const fileContents = [];
  for (const file of files.slice(0, 20)) {
    try {
      const fetched = await fetchFile(file.path);
      fileContents.push(fetched);
    } catch {
      fileContents.push({ path: file.path, size: file.size, content: null, error: "fetch failed" });
    }
  }

  return {
    path: dirPath,
    dirs: dirs.map((d) => d.path),
    files: fileContents,
    truncated: files.length > 20,
    totalFiles: files.length,
  };
}

async function main() {
  if (hasFlag("tree")) {
    const path = getArg("path") || getArg("tree") || "";
    const tree = await fetchTree(path);
    console.log(JSON.stringify({ ok: true, mode: "tree", data: { branch, path: path || "/", items: tree } }, null, 2));
    return;
  }

  if (getArg("file")) {
    const filePath = getArg("file");
    const file = await fetchFile(filePath);
    console.log(JSON.stringify({ ok: true, mode: "file", data: file }, null, 2));
    return;
  }

  if (getArg("dir")) {
    const dirPath = getArg("dir");
    const dir = await fetchDir(dirPath);
    console.log(JSON.stringify({ ok: true, mode: "dir", data: dir }, null, 2));
    return;
  }

  fail("Specify --tree, --file <path>, or --dir <path>");
}

main().catch((err) => fail(err.message));
