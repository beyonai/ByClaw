#!/usr/bin/env node

/**
 * gh-issues-list.mjs — List GitHub issues.
 *
 * Usage:
 *   node gh-issues-list.mjs [--repo owner/repo] [--state open] [--labels bug,feature] [--limit 20]
 */

import { requireGitHubToken } from "./gh-token.mjs";

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const repo = getArg("repo") || process.env.GITHUB_PR_REVIEW_REPO || "beyonai/ByClaw";
const state = getArg("state") || "open";
const labels = getArg("labels") || "";
const limit = parseInt(getArg("limit") || "20", 10);
const token = await requireGitHubToken();

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
};

async function main() {
  const params = new URLSearchParams({
    state,
    per_page: String(Math.min(limit, 100)),
    sort: "updated",
    direction: "desc",
  });
  if (labels) params.set("labels", labels);

  const url = `${API_BASE}/repos/${repo}/issues?${params}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  const raw = await res.json();
  // Filter out pull requests (GitHub API returns PRs in issues endpoint)
  const issues = raw
    .filter((item) => !item.pull_request)
    .slice(0, limit)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: issue.user?.login,
      labels: (issue.labels || []).map((l) => l.name),
      assignees: (issue.assignees || []).map((a) => a.login),
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      url: issue.html_url,
      body_preview: (issue.body || "").slice(0, 200),
    }));

  console.log(JSON.stringify({ ok: true, data: { total: issues.length, issues } }, null, 2));
}

main().catch((err) => fail(err.message));
