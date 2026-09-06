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

interface IDesktopBridge {
  isDesktop?: boolean;
  platform?: string;
  chat?: {
    status?: () => Promise<{ running: boolean }>;
    config?: () => Promise<IDesktopChatConfig>;
  };
  models?: {
    local?: () => Promise<Array<{ id: string; name: string; provider: string; source: 'claude' | 'codex'; detail?: string }>>;
  };
  getLocalModels?: () => Promise<Array<{ id: string; name: string; provider: string; source: 'claude' | 'codex'; detail?: string }>>;
}

interface Window {
  byclawDesktop?: IDesktopBridge;
}
