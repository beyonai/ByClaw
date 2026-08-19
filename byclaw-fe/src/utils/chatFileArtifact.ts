const MAX_ARTIFACT_PATHS = 20;

const KNOWN_BARE_FILE_ROOT = String.raw`(?:/by)?/(?:\.sessions|\.openclaw|\.shared|\.personal-agents|\.uiagent)/`;

const trimCandidate = (value: string) => {
  let candidate = value.trim();
  candidate = candidate.replace(/^file:\/\//i, 'file://');
  candidate = candidate.replace(/^[`'"“‘]+/, '').replace(/[`'"”’]+$/, '');
  candidate = candidate.replace(/[，。；;：:]+$/, '');
  candidate = candidate.replace(/[)\]}>]+$/, '');
  return candidate.trim();
};

export const isManagedChatFileArtifactPath = (value?: string) => {
  if (!value) return false;
  const candidate = trimCandidate(value).replace(/^file:\/\//i, '');
  return new RegExp(`^${KNOWN_BARE_FILE_ROOT}`, 'i').test(candidate);
};

const looksLikeFilePath = (value: string) => {
  const candidate = value.replace(/^file:\/\//i, '');
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return false;
  const fileName = candidate.split('/').pop() || '';
  return /\.[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/.test(fileName);
};

const addCandidate = (result: Set<string>, value?: string) => {
  if (!value || result.size >= MAX_ARTIFACT_PATHS) return;
  const candidate = trimCandidate(value);
  if (candidate.length > 2048 || !looksLikeFilePath(candidate)) return;
  result.add(candidate);
};

/**
 * 从助手回复中提取百应可管理文件路径。最终是否存在以及是否可下载由后端确认。
 */
export function extractChatFileArtifactPaths(content?: string): string[] {
  if (!content) return [];

  const result = new Set<string>();
  const matches: Array<{ index: number; value: string }> = [];

  const markdownLinkPattern = /\[[^\]]*]\((?:<([^>\n]+)>|([^)\n]+))\)/g;
  for (const match of content.matchAll(markdownLinkPattern)) {
    matches.push({ index: match.index || 0, value: match[1] || match[2] });
  }

  const inlineCodePattern = /`([^`\n]+)`/g;
  for (const match of content.matchAll(inlineCodePattern)) {
    matches.push({ index: match.index || 0, value: match[1] });
  }

  const labelledPathPattern = /(?:文件路径|文件地址|输出文件|保存路径|保存到)\s*[:：]?\s*(.+)$/gim;
  for (const match of content.matchAll(labelledPathPattern)) {
    matches.push({ index: match.index || 0, value: match[1] });
  }

  // 裸路径只主动识别百应已知目录；其他绝对路径需通过标签、Markdown 或反引号明确表达，降低误判。
  const barePathPattern = new RegExp(`${KNOWN_BARE_FILE_ROOT}[^\\s\\x60'"<>]+`, 'gi');
  for (const match of content.matchAll(barePathPattern)) {
    matches.push({ index: match.index || 0, value: match[0] });
  }

  matches.sort((left, right) => left.index - right.index).forEach((match) => addCandidate(result, match.value));

  return Array.from(result).slice(0, MAX_ARTIFACT_PATHS);
}
