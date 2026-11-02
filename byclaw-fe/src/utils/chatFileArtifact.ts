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

/** Resolve local preview/download wrappers to the same UserFS identity as a raw path. */
export const getChatFileArtifactPath = (value?: string): string | undefined => {
  if (!value) return undefined;
  let candidate = trimCandidate(value).replace(/^(?:{{file_preview_prefix}}|%7b%7bfile_preview_prefix%7d%7d)/i, '');
  candidate = candidate.replace(/^file:\/\//i, '');
  if (!new RegExp(`^${KNOWN_BARE_FILE_ROOT}`, 'i').test(candidate)) {
    try {
      const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
      const url = new URL(candidate, origin);
      if (url.origin !== origin) return undefined;
      // Explicit object-storage buckets are not the current session's UserFS identity.
      if (url.searchParams.get('bucketName')) return undefined;
      if (/^\/(?:byaiService\/|WaManagerService\/)?commonFile\/(?:preview|view|download)$/.test(url.pathname)) {
        candidate = url.searchParams.get('filePath') || '';
      } else if (/^\/(?:byaiService\/)?chat\/file-artifacts\/download$/.test(url.pathname)) {
        candidate = url.searchParams.get('path') || '';
      } else {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  if (!new RegExp(`^${KNOWN_BARE_FILE_ROOT}`, 'i').test(candidate)) return undefined;
  return candidate.replace(/^\/by(?=\/)/, '');
};

/** A relative file link needs the message's session root, not the backend URL root. */
export const isRelativeChatFileArtifactPath = (value?: string) => {
  if (!value) return false;
  const candidate = trimCandidate(value);
  return (
    !/^(?:[/\\#?]|[a-z][a-z\d+.-]*:)/i.test(candidate) &&
    !/^(?:byaiService|WaManagerService|commonFile|chat\/file-artifacts)\//i.test(candidate) &&
    /\.[a-z\d][a-z\d._-]{0,15}$/i.test(candidate.split(/[?#]/, 1)[0])
  );
};

export const getRelativeChatFileArtifactPath = (value: string, sessionId?: string) => {
  if (!sessionId || !/^[1-9]\d*$/.test(sessionId) || !isRelativeChatFileArtifactPath(value)) return undefined;
  let candidate: string;
  try {
    candidate = decodeURIComponent(trimCandidate(value).split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  } catch {
    return undefined;
  }
  if (/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(candidate) || /[\x00-\x1f\x7f]/.test(candidate)) return undefined;
  const segments = candidate.split('/').filter((part) => part && part !== '.');
  if (!segments.length || segments.includes('..') || candidate.length > 2048) return undefined;
  return `/.sessions/${sessionId}/${segments.join('/')}`;
};

export const isManagedChatFileArtifactPath = (value?: string) => Boolean(getChatFileArtifactPath(value));

const looksLikeFilePath = (value: string) => {
  const candidate = value.replace(/^file:\/\//i, '');
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return false;
  const fileName = candidate.split('/').pop() || '';
  return /\.[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/.test(fileName);
};

const addCandidate = (result: Set<string>, value?: string) => {
  if (!value || result.size >= MAX_ARTIFACT_PATHS) return;
  const managedPath = getChatFileArtifactPath(value);
  const candidate = managedPath || trimCandidate(value);
  if (
    !managedPath &&
    /^\/(?:byaiService\/|WaManagerService\/)?(?:commonFile\/|chat\/file-artifacts\/)/.test(candidate)
  ) {
    return;
  }
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
  const linkRanges: Array<{ start: number; end: number }> = [];

  const markdownLinkPattern = /\[[^\]]*]\((?:<([^>\n]+)>|([^)\n]+))\)/g;
  for (const match of content.matchAll(markdownLinkPattern)) {
    matches.push({ index: match.index || 0, value: match[1] || match[2] });
    linkRanges.push({ start: match.index || 0, end: (match.index || 0) + match[0].length });
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
    const index = match.index || 0;
    // A parsed link already supplied its target; do not reinterpret a remote URL's path as a local file.
    if (linkRanges.some((range) => index >= range.start && index < range.end)) continue;
    const tokenPrefix = content.slice(0, index).match(/[^\s`'"<>]*$/)?.[0] || '';
    if (/(?:https?:\/\/|^\/\/)/i.test(tokenPrefix)) continue;
    matches.push({ index: match.index || 0, value: match[0] });
  }

  matches.sort((left, right) => left.index - right.index).forEach((match) => addCandidate(result, match.value));

  return Array.from(result).slice(0, MAX_ARTIFACT_PATHS);
}

/** Convert an executor's absolute file path back to the current session's virtual UserFS path. */
export function normalizeChatFileArtifactPath(path: string, sessionId: string): string {
  const marker = `/by/.sessions/${sessionId}/`;
  const index = path.indexOf(marker);
  if (index <= 0) return path;
  return path.slice(index);
}
