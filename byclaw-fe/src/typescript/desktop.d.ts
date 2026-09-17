/**
 * 桌面外壳（Electron）注入的桥。
 *
 * 刻意不描述后端实现：具体用哪种 agent runtime 由桌面中间层自己决定，
 * 前端只需要知道「有没有本地聊天通道」以及连接地址/凭证。
 */
interface IDesktopChatConfig {
  baseUrl?: string | null;
  wsUrl?: string | null;
  token?: string;
}

interface IDesktopAppInfo {
  version: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

type IDesktopCapability =
  | 'chat'
  | 'models.local'
  | 'app.update'
  | 'dialog.selectDirectories'
  | 'local-files.v2'
  | 'files.attachments'
  | 'projects.local-directories'
  | 'sessions.local'
  | 'sessions.local-history';

interface IDesktopDirectorySelection {
  canceled: boolean;
  paths: string[];
}

interface IDesktopLocalSessionPage {
  list: Array<{
    sessionId: string;
    projectId?: string;
    sessionName: string;
    sessionContent?: string;
    objectId?: string;
    objectType?: string;
    createTime: string;
    updateTime: string;
  }>;
  total: number;
  pageNum: number;
  pageSize: number;
  totalPages: number;
}

type IDesktopLocalHistoryBlock =
  | { type: 'reasoning'; text: string; seq: number; truncated?: boolean }
  | {
      type: 'tool';
      callId: string;
      name: string;
      input?: unknown;
      output?: string;
      status: 'done' | 'error';
      seq: number;
      truncated?: boolean;
    }
  | { type: 'text'; text: string; seq: number; truncated?: boolean };

interface IDesktopLocalHistoryPage {
  list: Array<{
    id: string;
    role: 'user' | 'assistant';
    createdAt: string;
    queryId?: string;
    text?: string;
    blocks?: IDesktopLocalHistoryBlock[];
  }>;
  total: number;
  pageNum: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  warnings?: Array<{ code: string; segment?: string }>;
}

/**
 * 页面是远端加载的，版本和已安装的外壳互相独立：新页面经常跑在旧外壳上。
 * 所以调用任何成员前都要判空，或者先看 `capabilities` 里有没有对应能力，
 * 不要按 `bridgeVersion` 猜——它只在既有成员的返回结构破坏性变更时才加一。
 */
interface IDesktopBridge {
  isDesktop?: boolean;
  bridgeVersion?: number;
  platform?: string;
  capabilities?: IDesktopCapability[];
  app?: {
    info?: () => Promise<IDesktopAppInfo>;
    checkUpdate?: () => Promise<{
      available: boolean;
      currentVersion: string;
      latestVersion?: string;
      url?: string;
      updateType?: string;
      updateMsg?: string;
      updateStatus?: string;
      deviceType: string;
    }>;
    downloadUpdate?: (url: string) => Promise<{ path: string }>;
    installUpdate?: (path: string) => Promise<void>;
  };
  chat?: {
    status?: () => Promise<{ running: boolean }>;
    config?: () => Promise<IDesktopChatConfig>;
  };
  models?: {
    local?: () => Promise<Array<{ id: string; name: string; provider: string; source: 'claude' | 'codex'; detail?: string }>>;
  };
  dialog?: {
    /** 打开系统原生目录选择器，返回 Windows 或 macOS 的绝对路径。 */
    selectDirectories?: () => Promise<IDesktopDirectorySelection>;
  };
  projects?: {
    register?: (params: {
      projectId: string | number;
      projectName?: string;
      directories: Array<{ id?: string; name: string; path: string; primary: boolean }>;
    }) => Promise<void>;
    remove?: (params: { projectId: string | number }) => Promise<void>;
    rename?: (params: { projectId: string | number; projectName: string }) => Promise<void>;
    activate?: (params: { projectId?: string | number | null }) => Promise<void>;
    listLocal?: () => Promise<{ projects: Array<{ projectId: string; projectName?: string }> }>;
  };
  sessions?: {
    /** 仅返回由当前桌面外壳登记的本地会话；projectId=null 表示无项目会话。 */
    listLocal?: (params: {
      projectId?: string | number | null;
      pageNum?: number;
      pageSize?: number;
    }) => Promise<IDesktopLocalSessionPage>;
    /** 读取 agent provider 转换后的 ByClaw 本地历史页。 */
    readLocalHistory?: (params: {
      sessionId: string;
      pageNum?: number;
      pageSize?: number;
    }) => Promise<IDesktopLocalHistoryPage>;
  };
  files?: {
    registerAttachments?: (files: File[]) => Promise<Array<{
      attachmentId: string;
      name: string;
      size: number;
      contentType?: string;
    }>>;
  };
}

interface Window {
  byclawDesktop?: IDesktopBridge;
}
