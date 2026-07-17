// 分析证据面板 —— 透明展示两块内容,转场页(rank 运行中)与 ranked 候选表都复用:
//   1. A/B 两次录制的请求痕迹(按 sample 分组,method/host+path/状态/耗时;WS 帧单独标注)
//   2. rank 阶段真正发给 LLM 的评分提示词(scorePrompt;运行中未回则占位)
// 配色全走主题 token,等宽字段用 .code class(与 CandidateCard 一致)。
import { Collapse, Empty, Input, Space, Tag, Typography, theme } from 'antd';
import type { CaptureSample, NetworkEntry } from '../types/recorder';

const { Text } = Typography;

/** 单条痕迹行:method 标签 + host/pathname(截断)+ 状态码 + 耗时;WS 连接额外标注帧数。 */
function EntryRow({ e }: { e: NetworkEntry }) {
  const { token } = theme.useToken();
  const status = e.response?.status ?? e.responseStatus;
  const ms = e.timing?.durationMs;
  const isWs = e.kind === 'cdp-websocket';
  const path = e.pathname || e.url || '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: 1.9 }}>
      <Tag style={{ marginInlineEnd: 0, fontSize: 10 }}>{e.method || (isWs ? 'WS' : '—')}</Tag>
      <Text className="code" style={{ flex: 1, minWidth: 0 }} ellipsis={{ tooltip: `${e.host ?? ''}${path}` }}>
        {e.host ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {e.host}
          </Text>
        ) : null}
        {path}
      </Text>
      {isWs && (
        <Tag color={token.colorInfo} style={{ fontSize: 10 }} title="WebSocket 连接(数据帧单独捕获,打分排除)">
          WS · {e.webSocketFrames?.length ?? 0} 帧
        </Tag>
      )}
      {status !== null && status !== undefined && (
        <Text type={status >= 400 ? 'danger' : 'secondary'} className="code" style={{ fontSize: 11 }}>
          {status}
        </Text>
      )}
      {ms !== null && ms !== undefined && (
        <Text type="secondary" className="code" style={{ fontSize: 11, width: 56, textAlign: 'right' }}>
          {Math.round(ms)}ms
        </Text>
      )}
    </div>
  );
}

/** 单个样本(A/B)的痕迹分组:标题带条数,列表限高滚动。 */
function SampleBlock({ sample }: { sample: CaptureSample }) {
  const entries = sample.entries ?? [];
  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        样本 {sample.sampleName} · {entries.length} 条请求
        {sample.actionsDropped ? (
          <Text type="warning" style={{ fontSize: 11 }}>
            {' '}
            (操作溢出丢弃 {sample.actionsDropped})
          </Text>
        ) : null}
      </Text>
      <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
        {entries.length ? (
          entries.map((e, i) => <EntryRow key={`${sample.sampleName}-${i}`} e={e} />)
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            无痕迹
          </Text>
        )}
      </div>
    </div>
  );
}

interface Props {
  sampleA?: CaptureSample;
  sampleB?: CaptureSample;

  /** rank 阶段真正发给 LLM 的评分提示词;运行中未回时 undefined → 占位提示。 */
  scorePrompt?: string;

  /** 默认是否展开(转场页可展开吸睛;ranked 候选表默认折叠避免占屏)。 */
  defaultOpen?: boolean;
}

/** A/B 痕迹 + rank LLM 提示词的透明展示面板。两处复用(转场页 / ranked 候选表)。 */
export default function AnalysisEvidencePanel({ sampleA, sampleB, scorePrompt, defaultOpen }: Props) {
  const samples = [sampleA, sampleB].filter((s): s is CaptureSample => !!s);
  const items = [
    {
      key: 'evidence',
      label: '本次分析的录制痕迹(A/B 请求)',
      children: samples.length ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {samples.map((s) => (
            <SampleBlock key={s.sampleName} sample={s} />
          ))}
        </Space>
      ) : (
        <Empty description="暂无痕迹" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ),
    },
    {
      key: 'prompt',
      label: scorePrompt ? '发给 AI 的评分提示词(rank 阶段)' : '发给 AI 的评分提示词(评分完成后展示)',
      children: (
        <Input.TextArea
          className="code"
          value={scorePrompt || '(评分进行中,提示词稍后展示)'}
          readOnly
          autoSize={{ minRows: 4, maxRows: 16 }}
          style={{ fontSize: 12 }}
        />
      ),
    },
  ];
  return <Collapse size="small" defaultActiveKey={defaultOpen ? ['evidence', 'prompt'] : []} items={items} />;
}
