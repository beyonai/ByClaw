import type { ISandboxesInfo, ISandboxesInfoState } from '@/models/common/useAppStore';
import { get } from 'lodash';
import CookieUtil from '@/utils/cookie';

/**
 * 获取聊天中显示的用户名（显示最后两个字符）
 */
export function getDisplayUserNameInChat(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name.substring(Math.max(0, name.length - 2)).toLocaleUpperCase();
}

export function resolveSandboxesInfo(sandboxesInfo: ISandboxesInfoState) {
  return Promise.resolve(sandboxesInfo);
}

/**
 * Desktops a sandbox can declare in `instanceEndpoints`:
 * - `vnc`: the browser's desktop, opened when the agent uses the browser;
 * - `desktop`: a tool sandbox's own desktop (a game, a design tool), offered whenever that sandbox runs.
 */
export type DesktopInstance = 'vnc' | 'desktop';

export function getVNCUrl(sandboxesInfo: ISandboxesInfo[], instance: DesktopInstance = 'vnc') {
  const vncSandboxInst = sandboxesInfo.find(
    (item) => item.status === 'RUNNING' && get(item, ['instanceEndpoints', instance])
  );
  if (!vncSandboxInst) return '';

  // 使用后端端点，保留 token；代理目录补斜杠，使 noVNC 静态资源和 WebSocket 使用正确的相对路径。
  const endpoint = new URL(vncSandboxInst.instanceEndpoints![instance], window.location.origin);
  if (/\/proxy\/\d+$/.test(endpoint.pathname)) {
    endpoint.pathname += '/';
  }
  endpoint.searchParams.set('autoconnect', 'true');
  endpoint.searchParams.set('resize', 'scale');
  const url = endpoint.toString();

  CookieUtil.set('novncUrl', url);

  return url;
}

/** Whether a RUNNING sandbox declares its own desktop (`desktop`). */
export function hasRunningDesktop(sandboxesInfo: unknown): boolean {
  return (
    Array.isArray(sandboxesInfo) &&
    sandboxesInfo.some(
      (item: ISandboxesInfo) => item?.status === 'RUNNING' && Boolean(get(item, 'instanceEndpoints.desktop'))
    )
  );
}
