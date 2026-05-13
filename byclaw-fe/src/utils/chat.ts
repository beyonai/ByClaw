/**
 * 获取聊天中显示的用户名（显示最后两个字符）
 */
export function getDisplayUserNameInChat(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name.substring(Math.max(0, name.length - 2)).toLocaleUpperCase();
}
