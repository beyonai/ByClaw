import dayjs from 'dayjs';
// @ts-ignore
import { getIntl } from '@umijs/max';

const intl = getIntl();

/**
 * 根据时间戳返回日期格式 yyyy-MM-dd hh:mm:ss
 * @param times 时间戳
 * @returns string
 */
export function formatDate(times: number) {
  const dateTime = new Date(times);
  const date: { [key: string]: string | number } = {
    yy: dateTime.getFullYear(),
    MM: dateTime.getMonth() + 1,
    dd: dateTime.getDate(),
    hh: dateTime.getHours(),
    mm: dateTime.getMinutes(),
    ss: dateTime.getSeconds(),
  };

  const arr = ['MM', 'hh', 'mm', 'ss'];
  arr.forEach((element: string) => {
    date[element] = Number(date[element]) < 10 ? `0${date[element]}` : date[element];
  });
  // 输出月、日、时、分、秒
  return `${Object.values(date).slice(0, 3).join('-')} ${Object.values(date).slice(3).join(':')}`;
}

/**
 * 获取时间间隔
 * @param dateTime 时间戳
 * @returns string
 */
export function getTimeGap(dateTime: number) {
  const intl = getIntl();
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - new Date(dateTime).getTime()) / (1000 * 60 * 60 * 24));

  let timeLabel = intl.formatMessage({ id: 'date.earlier' });
  if (diffDays === 0) {
    timeLabel = intl.formatMessage({ id: 'date.today' });
  } else if (diffDays < 7) {
    timeLabel = intl.formatMessage({ id: 'date.sevenDays' });
  }
  return timeLabel;
}

export function getFriendlyDate(time?: number | null) {
  if (!time) return '';
  return dayjs(time).format('YYYY-MM-DD HH:mm');
}

/**
 * 计算时间差并返回友好的时间描述
 * @param timeString 时间字符串，支持多种格式
 * @returns 友好的时间描述，如"5分钟前"、"2小时前"、"3天前"或具体日期
 */
export function getTimeAgo(timeString: string | number | Date): string {
  const targetTime = dayjs(timeString);
  const now = dayjs();

  // 如果目标时间大于当前时间，返回具体日期
  if (targetTime.isAfter(now)) {
    return targetTime.format('YYYY-MM-DD HH:mm');
  }

  // 计算时间差
  const diffSeconds = now.diff(targetTime, 'second');
  const diffMinutes = now.diff(targetTime, 'minute');
  const diffHours = now.diff(targetTime, 'hour');
  const diffDays = now.diff(targetTime, 'day');

  // 根据时间差返回相应的描述
  if (diffDays && diffDays < 7) {
    return intl.formatMessage({ id: 'date.daysAgo' }, { days: diffDays });
  }

  if (diffHours && diffHours < 24) {
    return intl.formatMessage({ id: 'date.hoursAgo' }, { hours: diffHours });
  }

  if (diffSeconds && diffSeconds < 60) {
    return intl.formatMessage({ id: 'date.secondsAgo' }, { seconds: diffSeconds });
  }

  if (diffMinutes && diffMinutes < 60) {
    return intl.formatMessage({ id: 'date.minutesAgo' }, { minutes: diffMinutes });
  }
  // 超过7天返回具体日期
  return targetTime.format('YYYY-MM-DD HH:mm');
}
