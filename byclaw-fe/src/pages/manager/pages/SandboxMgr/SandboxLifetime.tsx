import { useIntl } from '@umijs/max';
import { useEffect, useState } from 'react';

type Timestamp = string | number | null | undefined;
export interface LifetimeRecord {
  createTime?: Timestamp;
  releaseTime?: Timestamp;
  status?: string;
}

type LifetimeIntl = {
  formatMessage: (descriptor: { id: string }, values: Record<string, number>) => string;
};

function timestamp(value: Timestamp): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return undefined;
  if (typeof raw === 'string') {
    const date = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
    if (date) {
      const [, year, month, day, hour = '0', minute = '0', second = '0'] = date;
      const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
      if (
        Number(month) < 1 ||
        Number(month) > 12 ||
        Number(day) < 1 ||
        Number(day) > days ||
        Number(hour) > 23 ||
        Number(minute) > 59 ||
        Number(second) > 59
      )
        return undefined;
    }
  }
  const parsed =
    typeof raw === 'number'
      ? new Date(raw).getTime()
      : new Date(/^\d+$/.test(raw) ? Number(raw) : raw.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hasReleaseTime(value: Timestamp): boolean {
  return (
    value !== null &&
    value !== undefined &&
    value !== 0 &&
    (typeof value !== 'string' || (value.trim() !== '' && value.trim() !== '0'))
  );
}

export function sandboxLifetime(record: LifetimeRecord, now = Date.now()): number | undefined {
  const start = timestamp(record.createTime);
  const released = record.status?.toUpperCase() === 'RELEASED';
  const end = released || hasReleaseTime(record.releaseTime) ? timestamp(record.releaseTime) : now;
  return start !== undefined && end !== undefined && Number.isFinite(end) && end >= start ? end - start : undefined;
}

export function formatSandboxLifetime(duration: number | undefined, intl: LifetimeIntl): string {
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) return '-';
  let seconds = Math.floor(duration / 1000);
  const units: Array<[string, number]> = [
    ['days', 86400],
    ['hours', 3600],
    ['minutes', 60],
    ['seconds', 1],
  ];
  const parts: string[] = [];
  for (const [unit, size] of units) {
    const value = Math.floor(seconds / size);
    seconds %= size;
    if (value || parts.length || unit === 'seconds') {
      parts.push(intl.formatMessage({ id: `sandboxMgr.lifetime.${unit}` }, { value }));
    }
  }
  return parts.join(' ');
}

export default function SandboxLifetime({ record }: { record: LifetimeRecord }) {
  const intl = useIntl();
  const [now, setNow] = useState(Date.now);
  const running = record.status?.toUpperCase() !== 'RELEASED' && !hasReleaseTime(record.releaseTime);
  useEffect(() => {
    setNow(Date.now());
    if (!running || timestamp(record.createTime) === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, record.createTime]);
  return <span>{formatSandboxLifetime(sandboxLifetime(record, now), intl)}</span>;
}
