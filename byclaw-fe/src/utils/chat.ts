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

export function getVNCUrl(sandboxesInfo: ISandboxesInfo[]) {
  const vncSandboxInst = sandboxesInfo.find((item) => get(item, 'instanceEndpoints.vnc'));
  if (!vncSandboxInst) return '';

  const { sandboxId } = vncSandboxInst;

  // 生产由 Nginx、本地由 Umi 开发代理转发同一前缀，iframe 和 noVNC WebSocket 始终保持同源。
  const url = `${window.location.origin}/v1/sandboxes/${sandboxId}/proxy/8081/?autoconnect=true&resize=scale`;

  CookieUtil.set('novncUrl', url);

  return url;
}
