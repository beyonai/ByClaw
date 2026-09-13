import type { Method } from 'axios';

let configPromise: Promise<IDesktopChatConfig | undefined> | undefined;

const LOCAL_ROUTES = new Set([
  'POST /byaiService/fileBrowser/list',
  'POST /byaiService/fileBrowser/upload',
  'GET /byaiService/fileBrowser/defaultPath',
  'GET /byaiService/fileBrowser/getChangedFileDiff',
  'GET /byaiService/fileBrowser/download',
  'GET /byaiService/fileBrowser/downloadFolder',
  'POST /byaiService/fileBrowser/delete',
  'POST /byaiService/fileBrowser/rename',
  'POST /byaiService/fileBrowser/move',
  'POST /byaiService/fileBrowser/copy',
  'POST /byaiService/fileBrowser/createFolder',
  'POST /byaiService/fileBrowser/ensureFolder',
  'POST /byaiService/fileBrowser/search',
  'POST /byaiService/chat/file-artifacts/resolve',
  'POST /byaiService/chat/uploadFiles',
  'GET /byaiService/chat/file-artifacts/download',
  'GET /byaiService/chat/preview/html',
  'GET /byaiService/commonFile/preview',
  'POST /byaiService/project/repo/available-list',
  'POST /byaiService/project/repo/session-worktree',
  'POST /byaiService/project/repo/tree',
  'POST /byaiService/project/repo/tree/search',
  'POST /byaiService/project/repo/file/content',
  'POST /byaiService/project/repo/local-changes',
  'POST /byaiService/project/repo/local-file-diff',
  'POST /byaiService/devloop/task/changes',
  'POST /byaiService/devloop/task/file-diff',
  'GET /byaiService/assiman/removeConversation',
]);

function routeKey(url: string, method: Method): string {
  return `${String(method).toUpperCase()} ${url.split('?')[0]}`;
}

export function hasDesktopLocalFiles(): boolean {
  return Boolean(window.byclawDesktop?.capabilities?.includes('local-files.v2'));
}

/** 新旧 Desktop 与远端页面独立发布，历史能力必须同时检查 token 和 member。 */
export function hasDesktopLocalHistory(): boolean {
  return Boolean(
    window.byclawDesktop?.capabilities?.includes('sessions.local-history') &&
      window.byclawDesktop?.sessions?.readLocalHistory
  );
}

export function readDesktopLocalHistory(params: { sessionId: string; pageNum: number; pageSize: number }) {
  if (!hasDesktopLocalHistory()) {
    return Promise.reject(new Error('当前 Desktop 版本不支持本地会话历史，请升级后重试'));
  }
  return window.byclawDesktop!.sessions!.readLocalHistory!(params);
}

export async function getDesktopLocalRequest(url: string, method: Method, data: any) {
  if (!hasDesktopLocalFiles() || !LOCAL_ROUTES.has(routeKey(url, method))) return undefined;
  // Shared drives, knowledge bases and other virtual roots still belong to the Web
  // backend in this phase. Only the former per-session namespace maps to Desktop cwd.
  const pathValues = [
    data?.path,
    data?.sourcePath,
    data?.targetDirectory,
    ...(data?.paths || []),
    ...(data?.sourcePaths || []),
  ];
  if (
    pathValues.some((value) =>
      /\/(?:by\/)?\.(?:shared|bykc|project|log|openclaw|uiagent)(?:\/|$)/u.test(String(value ?? ''))
    )
  ) {
    return undefined;
  }
  if (url.includes('/commonFile/preview') && !String(data?.filePath ?? data?.path ?? '').trim()) return undefined;
  configPromise ??= window.byclawDesktop?.chat?.config?.().catch(() => undefined);
  const config = await configPromise;
  if (!config?.baseUrl || !config.token) return undefined;
  return { baseURL: config.baseUrl, token: config.token };
}

export async function registerDesktopProject(
  projectId: string | number,
  directories: Array<{ name: string; path: string; primary: boolean }>,
  projectName?: string
) {
  return window.byclawDesktop?.projects?.register?.({ projectId, projectName, directories });
}

export function activateDesktopProject(projectId?: string | number | null) {
  return window.byclawDesktop?.projects?.activate?.({ projectId });
}

export function removeDesktopProject(projectId: string | number) {
  return window.byclawDesktop?.projects?.remove?.({ projectId });
}

export function renameDesktopProject(projectId: string | number, projectName: string) {
  return window.byclawDesktop?.projects?.rename?.({ projectId, projectName });
}
