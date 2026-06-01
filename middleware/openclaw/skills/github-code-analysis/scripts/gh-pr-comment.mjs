#!/usr/bin/env node

/**
 * gh-pr-comment.mjs — Post a review comment on a GitHub PR.
 *
 * Reads JSON from stdin:
 * {
 *   "repo": "owner/repo",
 *   "pr": 123,
 *   "body": "## Review Summary\n...",
 *   "event": "COMMENT",           // COMMENT | APPROVE | REQUEST_CHANGES
 *   "comments": [                  // optional inline comments
 *     { "path": "src/foo.ts", "line": 42, "body": "Issue here" }
 *   ]
 * }
 *
 * Env: GITHUB_TOKEN (required)
 */

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
  "User-Agent": "byclaw-pr-review-skill",
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

async function main() {
  const input = await readStdin();

  const repo = input.repo || process.env.GITHUB_PR_REVIEW_REPO;
  const pr = input.pr;
  const body = input.body || "";
  const event = input.event || "COMMENT";
  const comments = Array.isArray(input.comments) ? input.comments : [];

  if (!repo) fail("repo is required in input or GITHUB_PR_REVIEW_REPO env");
  if (!pr) fail("pr number is required");
  if (!body && comments.length === 0) fail("body or comments required");

  const reviewBody = {
    body,
    event,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: c.body,
    })),
  };

  const url = `${API_BASE}/repos/${repo}/pulls/${pr}/reviews`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(reviewBody),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    fail(`GitHub API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const result = await res.json();
  console.log(
    JSON.stringify({
      ok: true,
      data: {
        review_id: result.id,
        html_url: result.html_url,
        state: result.state,
        comments_count: comments.length,
      },
    })
  );
}

main().catch((err) => fail(err.message));
