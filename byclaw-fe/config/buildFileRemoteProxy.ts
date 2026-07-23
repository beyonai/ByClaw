/**
 * 文件型存储（FILE_STORAGE_TYPE=file）下的“读远程文件”特殊代理。
 *
 * 背景：file 模式的后端直接读服务器本地文件系统（生产是 NFS 挂载点）。本地开发时
 * BE 跑在 127.0.0.1 且没有挂 NFS，所有依赖文件/文件夹的接口（文件浏览、下载、
 * 会话空间、任务 diff 等）都会返回空。为此把这批接口单独代理到远程有 NFS 的后端，
 * 其余流量仍走本地 BE，方便本地调试业务逻辑。
 *
 * 仅在同时满足以下条件时启用，避免影响远程/生产构建：
 *   1. FILE_STORAGE_TYPE=file
 *   2. 本地 BE（BE_HOST 为 127.0.0.1 / localhost / 未设置）
 *   3. 存在远程后端地址（BYCLAW_REMOTE_BE_HOST，来自 .env 的 HOST），且不等于本地
 */

type ProxyEntry = {
  target: string;
  changeOrigin: boolean;
  ws?: boolean;
};

// 研发项目/文件浏览等需要读取远程文件与文件夹内容的接口前缀。
// 命中即整棵子路径转发到远程后端。
// 仅代理真正读取远程文件/文件夹内容的接口。
// 注意粒度：像 devloop/task/list、devloop/task/detail 是数据库数据，必须走本地后端，
// 不能用 devloop/task 这种宽前缀，否则会把任务列表也代理到远程旧服务。
const REMOTE_FILE_PATH_PREFIXES = [
  // 通用文件浏览器：list / download / downloadFolder / search / defaultPath 等（直接读文件系统）
  'fileBrowser',
  // 研发任务文件内容：整体变更明细 / 单文件 diff（读宿主机工作区 git）
  'devloop/task/changes',
  'devloop/task/file-diff',
  // 通用文件下载（读文件系统流）
  'commonFile/download',
];

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '', undefined as unknown as string]);

function normalizeHost(raw?: string): string {
  return (raw || '').trim();
}

export function buildFileRemoteProxy(routerBase: string): Record<string, ProxyEntry> {
  const fileStorageType = normalizeHost(process.env.FILE_STORAGE_TYPE).toLowerCase();
  const beHost = normalizeHost(process.env.BE_HOST);
  const remoteHost = normalizeHost(process.env.BYCLAW_REMOTE_BE_HOST);
  const bePort = normalizeHost(process.env.BE_SERVER_PORT) || '8086';

  const isFileStorage = fileStorageType === 'file';
  const isLocalBe = LOCAL_HOSTS.has(beHost);
  const hasRemote = remoteHost.length > 0 && !LOCAL_HOSTS.has(remoteHost) && remoteHost !== beHost;

  if (!isFileStorage || !isLocalBe || !hasRemote) {
    return {};
  }

  const remoteTarget = `http://${remoteHost}:${bePort}`;
  const proxy: Record<string, ProxyEntry> = {};
  for (const prefix of REMOTE_FILE_PATH_PREFIXES) {
    proxy[`${routerBase}byaiService/${prefix}`] = {
      target: remoteTarget,
      changeOrigin: true,
    };
  }

  // eslint-disable-next-line no-console
  console.log(
    `[proxy] file-remote enabled -> ${remoteTarget} for: ${REMOTE_FILE_PATH_PREFIXES.join(', ')}`,
  );

  return proxy;
}
