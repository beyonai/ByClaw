#!/usr/bin/env node

/**
 * gh-issues-create.mjs — Create GitHub issues from structured input (stdin JSON).
 *
 * Input (stdin JSON):
 * {
 *   "issues": [
 *     { "title": "...", "body": "...", "labels": ["bug"], "assignees": ["user1"] }
 *   ]
 * }
 */

import { requireGitHubToken } from "./gh-token.mjs";

const token = await requireGitHubToken();
const repo = process.env.GITHUB_PR_REVIEW_REPO || "beyonai/ByClaw";

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const API_BASE = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "byclaw-issues-mgmt-skill",
  "Content-Type": "application/json",
};

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(chunks.join("")));
      } catch (e) {
        reject(new Error(`Invalid JSON input: ${e.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

async function createIssue(issue) {
  const body = {
    title: issue.title,
    body: issue.body || "",
    labels: issue.labels || [],
    assignees: issue.assignees || [],
  };
  if (issue.milestone) body.milestone = issue.milestone;

  const url = `${API_BASE}/repos/${issue.repo || repo}/issues`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return { title: issue.title, ok: false, error: `${res.status}: ${errBody.slice(0, 200)}` };
  }

  const result = await res.json();
  return { title: issue.title, ok: true, number: result.number, url: result.html_url };
}

async function main() {
  const input = await readStdin();
  const issues = Array.isArray(input.issues) ? input.issues : [input];

  if (issues.length === 0) fail("No issues provided");

  const results = [];
  for (const issue of issues) {
    if (!issue.title) {
      results.push({ title: "(empty)", ok: false, error: "title is required" });
      continue;
    }
    results.push(await createIssue(issue));
  }

  const created = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(JSON.stringify({ ok: failed === 0, data: { total: results.length, created, failed, results } }, null, 2));
}

main().catch((err) => fail(err.message));
