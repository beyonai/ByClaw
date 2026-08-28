#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_CREDENTIAL_FILE = '/by/.connector-auth/.github/credential.json';

export function resolveGitHubToken(environment = process.env) {
  const credentialFile = environment.BYCLAW_GITHUB_CREDENTIAL_FILE || DEFAULT_CREDENTIAL_FILE;
  try {
    const credential = JSON.parse(readFileSync(credentialFile, 'utf8'));
    if ((credential?.connectorCode === 'github' || credential?.provider === 'github')
        && typeof credential?.accessToken === 'string') {
      const token = credential.accessToken.trim();
      if (token) return token;
    }
  } catch {
    // Fall through to the legacy launch-time environment during migration.
  }
  return environment.BY_GH_TOKEN || environment.GH_TOKEN || environment.GITHUB_TOKEN || null;
}

export function credentialResponse(operation, input, environment = process.env) {
  if (operation !== 'get') return '';
  const fields = Object.fromEntries(input.split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (fields.host !== 'github.com' || (fields.protocol && fields.protocol !== 'https')) return '';
  const token = resolveGitHubToken(environment);
  return token ? `username=x-access-token\npassword=${token}\n` : '';
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const response = credentialResponse(process.argv[2], Buffer.concat(chunks).toString('utf8'));
  if (response) process.stdout.write(response);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
