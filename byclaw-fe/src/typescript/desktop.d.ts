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

type IDesktopCapability = 'chat' | 'models.local' | 'app.update';

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
}

interface Window {
  byclawDesktop?: IDesktopBridge;
}
