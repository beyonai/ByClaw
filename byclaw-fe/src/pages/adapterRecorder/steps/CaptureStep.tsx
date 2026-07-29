/* eslint-disable lines-around-comment */
// Step 3 · 采集 A/B 样本 —— 「开始 / 结束」两步录制。
// 点「开始 X 录制」才新建 byCLI 标签页(A=页面 a / B=页面 b)+ 导航打开目标 URL + capture/start 开窗;
// 用户在该标签页操作,回来点「结束 X 录制」才 capture/read 冻结样本,并以 list 展示抓到的接口。
// 串行约束:同一会话只允许一个活动采集窗口,B 必须在 A 完成后才能开始。
import { CheckCircleFilled, GlobalOutlined, LoadingOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Input, Space, Table, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CaptureSample, NetworkEntry, SessionState } from '../types/recorder';
import LivePreview from './LivePreview';
import EmbeddedFrame from './EmbeddedFrame';
import VncFrame from './VncFrame';
import type { RecordingMode } from '../services/recorderClient';
import styles from './CaptureStep.module.less';

const { Paragraph, Text } = Typography;

interface ColumnProps {
  name: 'A' | 'B';
  sample?: CaptureSample;
  recording: boolean; // 此样本正在录制(窗口已开,等待结束)
  busy: boolean; // 此列有动作在飞(开始导航/开窗 或 结束读窗)
  canStart: boolean; // 可点「开始录制」
  locked: boolean; // B 在 A 完成前锁定
  recordingMode?: RecordingMode; // tab_projection(投屏)/ embedded_iframe(页内嵌入)/ vnc(容器 noVNC)
  targetUrl?: string; // embedded_iframe 模式下作为 iframe src
  vncUrl?: string; // vnc 模式下作为 noVNC iframe src
  seed?: string; // 本样本声明的搜索关键词(评分识别 seed→param)
  onSeedChange: (v: string) => void;
  onStart: () => void;
  onStop: () => void;
}

function SampleColumn({
  name,
  sample,
  recording,
  busy,
  canStart,
  locked,
  recordingMode,
  targetUrl,
  vncUrl,
  seed,
  onSeedChange,
  onStart,
  onStop,
}: ColumnProps) {
  const { token } = theme.useToken();
  const done = !!sample;
  const pageName = name.toLowerCase(); // 页面 a / 页面 b

  const entryColumns: ColumnsType<NetworkEntry> = [
    {
      title: '方法',
      dataIndex: 'method',
      width: 60,
      render: (m, r) =>
        r.kind === 'cdp-websocket' ? (
          <Tag color="purple" className="code">
            WS
          </Tag>
        ) : (
          <Tag className="code">{m}</Tag>
        ),
    },
    {
      title: 'Path',
      dataIndex: 'pathname',
      // WS / 扁平条目无 pathname → 回退展示完整 url。
      // 同 pathname 的多条请求靠 query 区分(如 recommend_feed 的 cursor/feed_type),故把 query string
      // 一并展示(灰色小字附在 path 后),tooltip 给完整 url —— 否则同地址多条看不出差异。
      render: (p, r) => {
        const qIdx = (r.url ?? '').indexOf('?');
        const query = qIdx >= 0 ? r.url.slice(qIdx) : '';
        return (
          <Text className="code" style={{ fontSize: 12 }} ellipsis={{ tooltip: r.url || p }}>
            {p || r.url}
            {query && p ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {query}
              </Text>
            ) : null}
          </Text>
        );
      },
    },
    {
      title: '状态',
      width: 64,
      // 兼容嵌套(canonical)与扁平(原始扩展)两种响应状态形状。
      render: (_, r) => {
        const s = r.response?.status ?? r.responseStatus;
        if (s === null || s === undefined) return null;
        return (
          <Tag color={s < 300 ? token.colorSuccess : token.colorWarning} className="code">
            {s}
          </Tag>
        );
      },
    },
    {
      title: '耗时',
      dataIndex: ['timing', 'durationMs'],
      width: 76,
      render: (d: number, r) =>
        r.kind === 'cdp-websocket' ? (
          <Text className="code" type="secondary">
            {r.webSocketFrames?.length ?? 0} 帧
          </Text>
        ) : (
          <Text className="code" type="secondary">
            {d}ms
          </Text>
        ),
    },
  ];

  // 标题状态徽标:已完成 / 录制中 / 待录制
  const wsCount = done ? sample!.entries.filter((e) => e.kind === 'cdp-websocket').length : 0;
  const httpCount = done ? sample!.entries.length - wsCount : 0;
  const statusTag = done ? (
    <Tag icon={<CheckCircleFilled />} color="success">
      已完成 · {httpCount} 个接口{wsCount ? ` · ${wsCount} 个 WS` : ''}
    </Tag>
  ) : recording ? (
    <Tag icon={<VideoCameraOutlined />} color="processing">
      录制中
    </Tag>
  ) : (
    <Tag color="default">待录制</Tag>
  );
  const seedInput = (
    <Input
      size="small"
      value={seed}
      onChange={(e) => onSeedChange(e.target.value)}
      placeholder="本次搜索的关键词(用于评分识别;A/B 填不同词更准,如 A=apple、B=banana)"
      prefix={
        <Text type="secondary" style={{ fontSize: 12 }}>
          关键词
        </Text>
      }
      allowClear
    />
  );

  // 录到的用户操作(user-action 轨):操作在前、接口在后(因果顺序)。
  const actions = sample?.actions ?? [];
  const actionGlyph = (t: string): string =>
    t === 'click' ? '🖱' : t === 'input' ? '⌨' : t === 'keydown' ? '⏎' : t === 'submit' ? '⤶' : '•';
  const actionsBlock =
    done && actions.length ? (
      <div style={{ marginBottom: 10 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          用户操作 · {actions.length}
          {sample?.actionsDropped ? ` (+${sample.actionsDropped} 溢出)` : ''}
        </Text>
        <div
          style={{
            maxHeight: 110,
            overflow: 'auto',
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadius,
            padding: '6px 8px',
          }}
        >
          {actions.map((a, i) => (
            <Text key={i} className="code" style={{ fontSize: 11 }} ellipsis>
              {actionGlyph(a.type)} {a.type} <Text type="secondary">{a.selector}</Text>
              {a.valueShape ? ` [${a.valueShape.kind}·${a.valueShape.len}]` : ''}
              {a.key ? ` «${a.key}»` : ''}
            </Text>
          ))}
        </div>
      </div>
    ) : null;

  // 主体:列表 / 录制中提示 / 正在打开 / 锁定 / 未录制
  let body: React.ReactNode;
  if (done) {
    // 真实站点可能抓到几百个接口 → 固定表头 + body 内滚动(最大高度),不撑爆页面。
    body = (
      <>
        {actionsBlock}
        <Table
          size="small"
          rowKey="requestId"
          dataSource={sample!.entries}
          columns={entryColumns}
          pagination={false}
          scroll={{ y: 280 }}
          expandable={{
            // 仅 WS 行可展开,展示抓到的数据帧(方向 / 文本·二进制 / payload 预览)。
            rowExpandable: (r) => r.kind === 'cdp-websocket' && !!r.webSocketFrames?.length,
            expandedRowRender: (r) => (
              <div style={{ maxHeight: 200, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(r.webSocketFrames ?? []).map((f, i) => {
                  const binary = f.opcode === 2;
                  return (
                    <Text key={i} className="code" style={{ fontSize: 11 }} ellipsis={{ tooltip: f.payloadPreview }}>
                      <Text type={f.direction === 'sent' ? 'warning' : 'success'}>
                        {f.direction === 'sent' ? '▲ 发送' : '▼ 接收'}
                      </Text>{' '}
                      <Tag color={binary ? 'geekblue' : 'default'} style={{ marginInlineEnd: 4 }}>
                        {binary ? 'binary' : 'text'}
                      </Tag>
                      {f.payloadPreview}
                      {f.payloadTruncated ? <Text type="secondary"> …(截断)</Text> : null}
                    </Text>
                  );
                })}
                {r.webSocketFramesDropped ? (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    +{r.webSocketFramesDropped} 帧溢出丢弃
                  </Text>
                ) : null}
              </div>
            ),
          }}
        />
      </>
    );
  } else if (recording) {
    body = (
      <>
        {recordingMode === 'vnc' ? (
          <VncFrame vncUrl={vncUrl} />
        ) : recordingMode === 'embedded_iframe' ? (
          <EmbeddedFrame src={targetUrl} />
        ) : (
          <LivePreview />
        )}
      </>
    );
  } else if (busy) {
    body = (
      <div style={{ padding: '24px 8px', textAlign: 'center' }}>
        <LoadingOutlined style={{ fontSize: 24, color: token.colorPrimary }} />
        <Paragraph type="secondary" style={{ margin: '12px 0 0' }}>
          正在打开页面 {pageName}…
        </Paragraph>
      </div>
    );
  } else if (locked) {
    body = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先完成 A 录制" />;
  } else {
    body = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`尚未录制,点下方「开始 ${name} 录制」`} />;
  }

  // 底部按钮:已完成(禁用) / 结束录制(danger) / 开始录制(primary)
  let footer: React.ReactNode;
  if (done) {
    footer = (
      <Button block disabled icon={<CheckCircleFilled />}>
        样本 {name} 已完成
      </Button>
    );
  } else if (recording) {
    footer = (
      <Button block danger type="primary" loading={busy} onClick={onStop}>
        结束 {name} 录制
      </Button>
    );
  } else {
    footer = (
      <Button block type="primary" icon={<VideoCameraOutlined />} loading={busy} disabled={!canStart} onClick={onStart}>
        开始 {name} 录制
      </Button>
    );
  }

  return (
    <Card
      size="small"
      className={recording ? styles.recordingCard : undefined}
      title={
        recording ? (
          <div className={styles.recordingHeader}>
            <Space className={styles.recordingHeaderMeta}>
              <span>样本 {name}</span>
              {statusTag}
            </Space>
            <div className={styles.recordingSeed}>{seedInput}</div>
          </div>
        ) : (
          <Space>
            <span>样本 {name}</span>
            {statusTag}
          </Space>
        )
      }
    >
      <div className={recording ? styles.recordingContent : undefined}>
        <div
          className={recording ? styles.recordingPreview : undefined}
          style={recording ? undefined : { minHeight: 132 }}
        >
          {body}
        </div>
        <div className={recording ? styles.recordingFooter : styles.footer}>{footer}</div>
      </div>
    </Card>
  );
}

interface Props {
  /** 当前录制阶段:A 或 B(A/B 已拆成独立向导步骤,本步只渲染对应一个 sample)。 */
  phase: 'A' | 'B';
  state: SessionState;
  loading: boolean;
  targetUrl?: string;
  recordingMode?: RecordingMode;
  vncUrl?: string;
  recording?: 'A' | 'B' | null;
  sampleA?: CaptureSample;
  sampleB?: CaptureSample;
  seedA?: string;
  seedB?: string;
  onSeedChange: (sample: 'A' | 'B', v: string) => void;
  onStartA: () => void;
  onStopA: () => void;
  onStartB: () => void;
  onStopB: () => void;
}

export default function CaptureStep({
  phase,
  state,
  loading,
  targetUrl,
  recordingMode,
  vncUrl,
  recording,
  sampleA,
  sampleB,
  seedA,
  seedB,
  onSeedChange,
  onStartA,
  onStopA,
  onStartB,
  onStopB,
}: Props) {
  const { token } = theme.useToken();
  const rec = recording ?? null;

  // 单飞模型(model 一次只跑一个动作):用全局 loading + recording + 已有样本推导每列忙碌态。
  const aBusy = rec === 'A' ? loading : rec === null && loading && !sampleA;
  const bBusy = rec === 'B' ? loading : rec === null && loading && !!sampleA && !sampleB;
  // 可开始:A 自 session_bound、B 自 capture_a(A 完成后),且无其它动作在飞。
  const canStartA = !sampleA && rec === null && state === 'session_bound' && !loading;
  const canStartB = !!sampleA && !sampleB && rec === null && state === 'capture_a' && !loading;

  // 本步只渲染当前阶段的 sample 列(A/B 已是独立向导步骤)。
  const column =
    phase === 'A' ? (
      <SampleColumn
        name="A"
        sample={sampleA}
        recording={rec === 'A'}
        busy={aBusy}
        canStart={canStartA}
        locked={false}
        recordingMode={recordingMode}
        targetUrl={targetUrl}
        vncUrl={vncUrl}
        seed={seedA}
        onSeedChange={(v) => onSeedChange('A', v)}
        onStart={onStartA}
        onStop={onStopA}
      />
    ) : (
      <SampleColumn
        name="B"
        sample={sampleB}
        recording={rec === 'B'}
        busy={bBusy}
        canStart={canStartB}
        locked={!sampleA && rec !== 'B'}
        recordingMode={recordingMode}
        targetUrl={targetUrl}
        vncUrl={vncUrl}
        seed={seedB}
        onSeedChange={(v) => onSeedChange('B', v)}
        onStart={onStartB}
        onStop={onStopB}
      />
    );

  return (
    <div className={rec ? styles.recordingStep : undefined}>
      {/* 单行紧凑头:阶段说明 + 目标 URL(去掉外层重复 Card 标题 + 大段说明 + 独立 URL 块)。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {phase === 'A' ? '录制第一段操作(开始→操作→结束冻结)' : '录制第二段操作(换不同关键词,便于 diff 识别动态参数)'}
        </Text>
        {targetUrl && (
          <>
            <GlobalOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />
            <Text
              className="code"
              type="secondary"
              style={{ fontSize: 12, maxWidth: 420 }}
              ellipsis={{ tooltip: targetUrl }}
            >
              {targetUrl}
            </Text>
          </>
        )}
      </div>
      {column}
    </div>
  );
}
