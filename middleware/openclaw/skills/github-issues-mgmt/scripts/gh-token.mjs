import { readFileSync } from 'node:fs';

const DEFAULT_CREDENTIAL_FILE = '/by/.connector-auth/.github/credential.json';

function projectedGitHubToken() {
  const credentialFile = process.env.BYCLAW_GITHUB_CREDENTIAL_FILE || DEFAULT_CREDENTIAL_FILE;
  try {
    const credential = JSON.parse(readFileSync(credentialFile, 'utf8'));
    return credential?.provider === 'github' && typeof credential?.accessToken === 'string'
      ? credential.accessToken.trim()
      : null;
  } catch {
    return null;
  }
}

export function getGitHubToken() {
  return projectedGitHubToken()
    || process.env.BY_GH_TOKEN
    || process.env.GH_TOKEN
    || process.env.GITHUB_TOKEN
    || null;
}

export async function requireGitHubToken() {
  const token = getGitHubToken();
  if (token) return token;
  console.log(JSON.stringify({
    ok: false,
    auth_required: true,
    action: "authorize_connector",
    connector_code: "github",
    message: "GitHub 连接器尚未授权或凭据已失效，请先在平台连接器中完成 GitHub 授权。",
  }));
  process.exit(1);
}
