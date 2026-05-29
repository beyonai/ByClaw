#!/usr/bin/env node

/**
 * gh-pr-list.mjs — List pull requests from a GitHub repository.
 *
 * Usage:
 *   node gh-pr-list.mjs --repo owner/repo [--state open] [--label needs-review] [--limit 10]
 *
 * Env: GITHUB_TOKEN (required)
 */

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const repo = getArg("repo") || process.env.GITHUB_PR_REVIEW_REPO || "beyonai/ByClaw";
const state = getArg("state") || "open";
const label = getArg("label");
const limit = parseInt(getArg("limit") || "10", 10);
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
if (!repo) fail("--repo owner/repo is required");

const API_BASE = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "byclaw-pr-review-skill",
};

async function main() {
  const params = new URLSearchParams({
    state,
    per_page: String(Math.min(limit, 100)),
    sort: "updated",
    direction: "desc",
  });

  const url = `${API_BASE}/repos/${repo}/pulls?${params}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  let prs = await res.json();

  if (label) {
    prs = prs.filter((pr) =>
      pr.labels?.some((l) => l.name === label)
    );
  }

  const result = prs.slice(0, limit).map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login,
    base: pr.base?.ref,
    head: pr.head?.ref,
    draft: pr.draft,
    labels: (pr.labels || []).map((l) => l.name),
    updated_at: pr.updated_at,
    url: pr.html_url,
  }));

  console.log(JSON.stringify({ ok: true, data: { total: result.length, prs: result } }, null, 2));
}

main().catch((err) => fail(err.message));
