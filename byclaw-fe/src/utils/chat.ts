import { IState } from '@/models/common/useAppStore';

import { isDevelopment } from '@/utils/common';
import CookieUtil from '@/utils/cookie';

/**
 * 获取聊天中显示的用户名（显示最后两个字符）
 */
export function getDisplayUserNameInChat(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name.substring(Math.max(0, name.length - 2)).toLocaleUpperCase();
}

export function getVNCUrl(sandboxesInfo: IState['sandboxesInfo']) {
  const { sandboxId } = sandboxesInfo;

  let url = `/v1/sandboxes/${sandboxId}/proxy/8081/`;
  if (isDevelopment()) {
    url = `${URI_TARGET}${url}`;
  } else {
    url = `${window.location.origin}${url}`;
  }

  CookieUtil.set('novncUrl', url);

  return url;
}
