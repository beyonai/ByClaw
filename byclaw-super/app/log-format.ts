/**
 * 日志文本裁剪工具：把长正文截断到上限，避免单条日志被超长消息/回答撑爆。
 * 仅用于日志输出，不改变业务数据。
 */

/** 截断到 max 字符，超长追加省略号；便于在日志里聚焦关键字段。 */
export function truncateForLog(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
