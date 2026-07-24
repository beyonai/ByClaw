// A/B 样本的 endpoint 聚合视图：展示差异，并关联排序后的候选。
import { Empty, Tag, theme } from 'antd';
import type { CaptureSample, NetworkEntry, RankCandidate } from '../types/recorder';

interface Props {
  sampleA?: CaptureSample;
  sampleB?: CaptureSample;
  candidates?: RankCandidate[];
  selectedId?: string;
}

type Aggregate = {
  key: string;
  method: string;
  host: string;
  pathname: string;
  a: NetworkEntry[];
  b: NetworkEntry[];
  candidateIds: string[];
};

function endpointOf(entry: NetworkEntry) {
  let host = entry.host ?? '';
  let pathname = entry.pathname ?? '';
  try {
    const url = new URL(entry.url);
    host ||= url.host;
    pathname ||= url.pathname;
  } catch {
    // 保留扩展已解析的 host/path；无效 URL 不阻断诊断视图。
  }
  return { method: entry.method || 'GET', host, pathname: pathname || entry.url || '/' };
}

function endpointKey(method: string, host: string, pathname: string) {
  return `${method.toUpperCase()} ${host}${pathname}`;
}

function averageDuration(entries: NetworkEntry[]) {
  if (!entries.length) return 0;
  return Math.round(entries.reduce((total, entry) => total + (entry.timing?.durationMs ?? 0), 0) / entries.length);
}

function aggregates(sampleA?: CaptureSample, sampleB?: CaptureSample, candidates?: RankCandidate[]): Aggregate[] {
  const rows = new Map<string, Aggregate>();
  const addEntries = (entries: NetworkEntry[] | undefined, sample: 'a' | 'b') => {
    entries?.forEach((entry) => {
      const endpoint = endpointOf(entry);
      const key = endpointKey(endpoint.method, endpoint.host, endpoint.pathname);
      const row = rows.get(key) ?? {
        key,
        ...endpoint,
        a: [],
        b: [],
        candidateIds: [],
      };
      row[sample].push(entry);
      rows.set(key, row);
    });
  };
  addEntries(sampleA?.entries, 'a');
  addEntries(sampleB?.entries, 'b');

  const candidateIds = new Map<string, string[]>();
  candidates?.forEach((candidate) => {
    const key = endpointKey(candidate.endpoint.method, candidate.endpoint.host, candidate.endpoint.pathname);
    candidateIds.set(key, [...(candidateIds.get(key) ?? []), candidate.id]);
  });
  rows.forEach((row) => {
    row.candidateIds = candidateIds.get(row.key) ?? [];
  });

  return [...rows.values()];
}

export default function TraceChart({ sampleA, sampleB, candidates, selectedId }: Props) {
  const { token } = theme.useToken();
  const data = aggregates(sampleA, sampleB, candidates).sort((left, right) => {
    const leftSelected = left.candidateIds.includes(selectedId ?? '') ? 1 : 0;
    const rightSelected = right.candidateIds.includes(selectedId ?? '') ? 1 : 0;
    const leftCandidate = left.candidateIds.length ? 1 : 0;
    const rightCandidate = right.candidateIds.length ? 1 : 0;
    const leftShared = left.a.length && left.b.length ? 1 : 0;
    const rightShared = right.a.length && right.b.length ? 1 : 0;
    return (
      rightSelected - leftSelected ||
      rightCandidate - leftCandidate ||
      rightShared - leftShared ||
      right.a.length + right.b.length - (left.a.length + left.b.length) ||
      left.key.localeCompare(right.key)
    );
  });
  if (!data.length) return <Empty description="暂无 A/B 样本数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((item) => {
        const isSelected = item.candidateIds.includes(selectedId ?? '');
        const shared = item.a.length > 0 && item.b.length > 0;
        return (
          <div
            key={item.key}
            style={{
              display: 'grid',
              gap: 5,
              padding: '8px 10px',
              borderRadius: 8,
              background: token.colorFillQuaternary,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.method} {item.pathname}
              </strong>
              <span style={{ color: token.colorTextTertiary, fontSize: 11, whiteSpace: 'nowrap' }}>{item.host}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <Tag color={shared ? 'blue' : undefined}>{shared ? 'A/B 均出现' : item.a.length ? '仅 A' : '仅 B'}</Tag>
              <Tag>
                A {item.a.length} 次 · {averageDuration(item.a)} ms
              </Tag>
              <Tag>
                B {item.b.length} 次 · {averageDuration(item.b)} ms
              </Tag>
              {item.candidateIds.length > 0 && <Tag color="purple">候选</Tag>}
              {isSelected && <Tag color="green">已选定</Tag>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
