#!/usr/bin/env node

/**
 * gh-repo-clone.mjs — Clone or update repository locally for analysis.
 *
 * Usage:
 *   node gh-repo-clone.mjs [--repo owner/repo] [--branch main] [--force]
 *
 * Clones to: skills/github-code-analysis/.cache/<repo-name>/
 * If already cloned, does `git pull` to update. Use --force to re-clone.
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireGitHubToken } from "./gh-token.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".cache");

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
const force = hasFlag("force");
const token = await requireGitHubToken();

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const repoName = repo.split("/").pop();
const cloneDir = path.join(CACHE_DIR, repoName);
const cloneUrl = `https://${token}@github.com/${repo}.git`;

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 120000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err) {
    fail(`Command failed: ${cmd}\n${err.stderr || err.message}`);
  }
}

mkdirSync(CACHE_DIR, { recursive: true });

if (force && existsSync(cloneDir)) {
  rmSync(cloneDir, { recursive: true, force: true });
}

let action;
if (existsSync(path.join(cloneDir, ".git"))) {
  run(`git fetch origin ${branch}`, cloneDir);
  run(`git checkout ${branch}`, cloneDir);
  run(`git reset --hard origin/${branch}`, cloneDir);
  action = "updated";
} else {
  run(`git clone --depth 1 --branch ${branch} --single-branch ${cloneUrl} ${cloneDir}`);
  action = "cloned";
}

const commitHash = run("git rev-parse --short HEAD", cloneDir);
const commitMsg = run("git log -1 --format=%s", cloneDir);

console.log(JSON.stringify({
  ok: true,
  data: {
    action,
    repo,
    branch,
    path: cloneDir,
    commit: commitHash,
    message: commitMsg,
  },
}, null, 2));
