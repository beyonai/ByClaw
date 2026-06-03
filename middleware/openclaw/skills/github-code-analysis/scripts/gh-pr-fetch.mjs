#!/usr/bin/env node

/**
 * gh-pr-fetch.mjs — Fetch PR information from GitHub API.
 *
 * Usage:
 *   node gh-pr-fetch.mjs --repo owner/repo --pr 123 [--format diff|files|metadata|all]
 */

import { requireGitHubToken } from "./gh-token.mjs";

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const repo = getArg("repo") || process.env.GITHUB_PR_REVIEW_REPO || "beyonai/ByClaw";
const prNumber = getArg("pr");
const format = getArg("format") || "all";
const token = await requireGitHubToken();

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

if (!repo) fail("--repo owner/repo is required");
if (!prNumber) fail("--pr <number> is required");

const API_BASE = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "byclaw-pr-review-skill",
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

async function fetchMetadata() {
  const res = await ghFetch(`/repos/${repo}/pulls/${prNumber}`);
  const pr = await res.json();
  return {
    number: pr.number,
    title: pr.title,
    author: pr.user?.login,
    base: pr.base?.ref,
    head: pr.head?.ref,
    state: pr.state,
    draft: pr.draft,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    body: pr.body || "",
    labels: (pr.labels || []).map((l) => l.name),
    url: pr.html_url,
  };
}

async function fetchFiles() {
  const files = [];
  let page = 1;
  while (true) {
    const res = await ghFetch(
      `/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`
    );
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const f of batch) {
      files.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch || "",
      });
    }
    if (batch.length < 100) break;
    page++;
  }
  return files;
}

async function fetchDiff() {
  const res = await ghFetch(`/repos/${repo}/pulls/${prNumber}`, {
    Accept: "application/vnd.github.v3.diff",
  });
  return await res.text();
}

async function fetchCommits() {
  const res = await ghFetch(
    `/repos/${repo}/pulls/${prNumber}/commits?per_page=100`
  );
  const commits = await res.json();
  return (commits || []).map((c) => ({
    sha: c.sha?.slice(0, 8),
    message: c.commit?.message?.split("\n")[0] || "",
    author: c.commit?.author?.name || c.author?.login || "",
  }));
}

async function main() {
  const result = { pr: null, diff: null, files: null, commits: null };

  if (format === "metadata" || format === "all") {
    result.pr = await fetchMetadata();
  }
  if (format === "diff" || format === "all") {
    result.diff = await fetchDiff();
  }
  if (format === "files" || format === "all") {
    result.files = await fetchFiles();
  }
  if (format === "all") {
    result.commits = await fetchCommits();
  }

  console.log(JSON.stringify({ ok: true, data: result }, null, 2));
}

main().catch((err) => fail(err.message));
