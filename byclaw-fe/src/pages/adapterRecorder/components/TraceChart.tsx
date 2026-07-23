// Lightweight request-duration bars without adding a chart dependency.
import { Empty, theme } from 'antd';
import type { NetworkEntry } from '../types/recorder';

interface Props {
  entries?: NetworkEntry[];
}

export default function TraceChart({ entries }: Props) {
  const { token } = theme.useToken();
  if (!entries?.length) return <Empty description="暂无 trace 数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const data = entries
    .map((entry, index) => ({
      key: entry.requestId ? `${entry.requestId}-${index}` : `${entry.method}-${entry.pathname ?? entry.url}-${index}`,
      name: `${entry.method} ${entry.pathname ?? entry.url}`,
      ms: entry.timing?.durationMs ?? 0,
    }))
    .sort((a, b) => b.ms - a.ms);
  const maxMs = Math.max(...data.map((item) => item.ms), 1);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((item) => {
        const width = `${Math.max(6, Math.round((item.ms / maxMs) * 100))}%`;
        const slow = item.ms > 250;
        return (
          <div key={item.key} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
              <span
                style={{
                  color: token.colorTextSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.name}
              </span>
              <span style={{ color: slow ? token.colorWarning : token.colorText, fontVariantNumeric: 'tabular-nums' }}>
                {item.ms} ms
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: token.colorFillTertiary, overflow: 'hidden' }}>
              <div
                style={{
                  width,
                  height: '100%',
                  borderRadius: 999,
                  background: slow ? token.colorWarning : token.colorPrimary,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
