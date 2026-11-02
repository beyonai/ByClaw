import dayjs from 'dayjs';

/**
 * 统一会话接口的北京时间与实时消息的毫秒时间戳，避免浏览器时区影响显示和排序。
 * 无效值的回退时间由调用方决定，以保留会话降序、消息升序各自的缺失时间排序规则。
 */
export default function getSessionTimestamp(value?: string | number | null, fallbackTimestamp = 0): number {
  if (value === undefined || value === null || value === '') {
    return fallbackTimestamp;
  }

  let dateValue = value;
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (/^\d+$/.test(trimmedValue)) {
      dateValue = Number(trimmedValue);
    } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(trimmedValue)) {
      // Java 会话接口以 GMT+8 输出无时区日期；仅补全这类值，保留 ISO 日期自带的偏移。
      dateValue = `${trimmedValue.replace(' ', 'T')}+08:00`;
    } else {
      dateValue = trimmedValue;
    }
  }

  const timestamp = dayjs(dateValue).valueOf();
  return Number.isFinite(timestamp) ? timestamp : fallbackTimestamp;
}
