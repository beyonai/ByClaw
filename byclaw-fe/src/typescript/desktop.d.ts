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

interface IDesktopFileBrowserItem {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  lastModified?: string;
}

interface IDesktopFileContent {
  name: string;
  path: string;
  size: number;
  contentEncoding: 'base64';
  content: string;
}

/** `cancelled` 是用户关掉保存框的正常结果，不是错误，调用方不要弹报错。 */
type IDesktopSaveResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

type IDesktopCapability =
  | 'chat'
  | 'models.local'
  | 'files.browse'
  | 'files.write'
  /** 增删改查一组一起给：不会出现只能重命名不能删除的外壳。 */
  | 'files.manage';

interface IDesktopUploadFile {
  name: string;
  bytes: Uint8Array;
}

/** 逐个文件报结果：一批里第三个失败，不该把前两个已落盘的也算失败。 */
interface IDesktopUploadResult {
  name: string;
  status: 'saved' | 'error';
  message?: string;
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
  };
  chat?: {
    status?: () => Promise<{ running: boolean }>;
    config?: () => Promise<IDesktopChatConfig>;
  };
  models?: {
    local?: () => Promise<Array<{ id: string; name: string; provider: string; source: 'claude' | 'codex'; detail?: string }>>;
  };

  /**
   * 本机工作区文件。
   *
   * 只覆盖桌面端自己托管的根目录（`/by/.sessions`、`/by/.shared`）；
   * 其它路径由服务端文件浏览接口负责，调用方按前缀决定走哪一边。
   */
  files?: {
    list?: (params: { path?: string }) => Promise<IDesktopFileBrowserItem[]>;
    read?: (params: { path: string }) => Promise<IDesktopFileContent>;
    /** 字节用 Uint8Array 过桥：File/Blob 过不了 contextBridge，调用方先自己读出来。 */
    write?: (params: { path: string; files: IDesktopUploadFile[] }) => Promise<IDesktopUploadResult[]>;
    /** 走系统保存框写盘，不回传字节，所以前端不要再走 a[download]。 */
    download?: (params: { path: string }) => Promise<IDesktopSaveResult>;
    /** 主进程打好 zip 再回 base64，和 read 一样由前端还原成 Blob。 */
    archive?: (params: { path: string }) => Promise<IDesktopFileContent>;
    delete?: (params: { paths: string[] }) => Promise<void>;
    rename?: (params: { path: string; newName: string }) => Promise<void>;
    move?: (params: { paths: string[]; targetDirectory: string }) => Promise<void>;
    copy?: (params: { path: string; targetDirectory: string }) => Promise<void>;
    /** 幂等：createFolder 和 ensureFolder 共用这一个。 */
    mkdir?: (params: { path: string }) => Promise<void>;
    search?: (params: { path?: string; keyword: string }) => Promise<IDesktopFileBrowserItem[]>;
  };
}

interface Window {
  byclawDesktop?: IDesktopBridge;
}
