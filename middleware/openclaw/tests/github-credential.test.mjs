import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  credentialResponse,
  resolveGitHubToken,
} from '../runtime-tools/git-credential.mjs';
import { getGitHubToken as getAnalysisToken } from '../skills/github-code-analysis/scripts/gh-token.mjs';
import { getGitHubToken as getIssuesToken } from '../skills/github-issues-mgmt/scripts/gh-token.mjs';

test('projected credential takes precedence over stale launch-time environments', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'byclaw-github-credential-'));
  const credentialFile = path.join(directory, 'credential.json');
  writeFileSync(credentialFile, JSON.stringify({ provider: 'github', accessToken: 'projected-token' }));
  const previous = process.env.BYCLAW_GITHUB_CREDENTIAL_FILE;
  process.env.BYCLAW_GITHUB_CREDENTIAL_FILE = credentialFile;
  process.env.BY_GH_TOKEN = 'stale-by-token';
  process.env.GH_TOKEN = 'stale-gh-token';
  try {
    assert.equal(resolveGitHubToken(process.env), 'projected-token');
    assert.equal(getAnalysisToken(), 'projected-token');
    assert.equal(getIssuesToken(), 'projected-token');
  } finally {
    if (previous === undefined) delete process.env.BYCLAW_GITHUB_CREDENTIAL_FILE;
    else process.env.BYCLAW_GITHUB_CREDENTIAL_FILE = previous;
    delete process.env.BY_GH_TOKEN;
    delete process.env.GH_TOKEN;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy environment remains a migration fallback when projection is unavailable', () => {
  assert.equal(resolveGitHubToken({
    BYCLAW_GITHUB_CREDENTIAL_FILE: '/missing/credential.json',
    GH_TOKEN: 'legacy-token',
  }), 'legacy-token');
});

test('git credential helper responds only to HTTPS github.com lookups', () => {
  const environment = {
    BYCLAW_GITHUB_CREDENTIAL_FILE: '/missing/credential.json',
    GH_TOKEN: 'helper-token',
  };
  assert.equal(credentialResponse('get', 'protocol=https\nhost=github.com\n', environment),
    'username=x-access-token\npassword=helper-token\n');
  assert.equal(credentialResponse('get', 'protocol=https\nhost=gitlab.com\n', environment), '');
  assert.equal(credentialResponse('store', 'protocol=https\nhost=github.com\n', environment), '');
});

test('git credential fill uses the installed helper contract without a tokenized URL', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'byclaw-git-helper-'));
  const credentialFile = path.join(directory, 'credential.json');
  const helper = fileURLToPath(new URL('../runtime-tools/git-credential.mjs', import.meta.url));
  writeFileSync(credentialFile, JSON.stringify({ provider: 'github', accessToken: 'git-helper-token' }));
  const environment = {
    ...process.env,
    HOME: directory,
    BYCLAW_GITHUB_CREDENTIAL_FILE: credentialFile,
    GIT_TERMINAL_PROMPT: '0',
  };
  try {
    execFileSync('git', ['config', '--global', 'credential.https://github.com.helper', helper], { env: environment });
    const output = execFileSync('git', ['credential', 'fill'], {
      env: environment,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    assert.match(output, /username=x-access-token/);
    assert.match(output, /password=git-helper-token/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
