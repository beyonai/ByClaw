/* eslint-disable indent */
// PipelineStep 三子页(评分候选 / 生成脚本 / 测试保存)共享的展示小组件:
// CandidateTable(候选表)、ProgressPanel(阶段进度)、DraftCard(脚本卡)、seedHit。
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { Alert, Card, Collapse, Input, Space, Table, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { PipelineDraft, RankCandidate } from '../types/recorder';
import { candidateScoreDimensions } from '../components/candidateScore';

const { Paragraph, Text } = Typography;

/** 从候选里推断 seed 是否命中参数:优先看 scoreExplanation 的 seed 信号,其次看 args 里 seed 派生的映射,
 *  再看 responseShape.echoesSeedArg。返回 {hit, label}——label 形如 "q / term"(命中的参数名)。 */
export function seedHit(c: RankCandidate): { hit: boolean; label: string } {
  const sig = (c.scoreExplanation ?? []).find((s) => /seed|echo/i.test(s.signal) && s.delta > 0);
  const seedArgs = (c.args ?? []).filter((a) => /seed|keyword|term|q\b/i.test(a.argName) || !!a.evidenceId);
  const params = seedArgs.map((a) => a.paramName).filter(Boolean);
  const hit = !!sig || params.length > 0 || c.responseShape?.echoesSeedArg === true;
  const label = params.length
    ? params.join(' / ')
    : sig
    ? sig.signal
    : c.responseShape?.echoesSeedArg
    ? '响应回显'
    : '—';
  return { hit, label };
}

/** 候选表格:按 rank 分降序列出每个候选接口 + 参数 + 分数(含来源) + seed→参数命中 + LLM 接口功能推断 + 手选传给 LLM。
 *  rowSelection 受控(selectedIds/onSelectChange);默认勾选 top-N(由父用 sentCandidateIds 初始化)。
 *  整体折叠 + 表格限高,避免长列表占屏。locked=运行后锁定选择(改用「送 AI」列标注)。 */
export function CandidateTable({
  candidates,
  selectedIds,
  onSelectChange,
  seedA,
  seedB,
  locked,
  llmSynthesis = true,
}: {
  candidates: RankCandidate[];
  selectedIds: string[];
  onSelectChange?: (ids: string[]) => void;
  seedA?: string;
  seedB?: string;
  locked?: boolean;
  llmSynthesis?: boolean;
}) {
  const { token } = theme.useToken();
  const rows = [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const hasAppliedLlmUtility = rows.some(
    (candidate) => candidate.scoredBy === 'llm' && typeof candidate.llmUtilityScore === 'number'
  );
  const seeds = [seedA, seedB].filter((s): s is string => !!s && !!s.trim());
  const sentSet = new Set(selectedIds);
  const columns: ColumnsType<RankCandidate> = [
    {
      title: '接口',
      key: 'endpoint',
      render: (_, c) => {
        const qp = c.endpoint?.queryParams ? Object.entries(c.endpoint.queryParams) : [];
        const dyn = c.endpoint?.dynamicParams ?? [];
        const mergedCount = c.mergedRequestIds?.length ?? 0;
        const params = c.paramObservations ?? [];
        return (
          <div>
            <Text
              className="code"
              style={{ fontSize: 12 }}
              ellipsis={{ tooltip: `${c.endpoint?.method} ${c.endpoint?.pathname || c.endpoint?.urlTemplate || ''}` }}
            >
              <Tag style={{ marginInlineEnd: 4 }}>{c.endpoint?.method}</Tag>
              {c.endpoint?.pathname || c.endpoint?.urlTemplate || '—'}
            </Text>
            {mergedCount > 1 && (
              <Tag
                color={token.colorInfo}
                style={{ marginInlineStart: 4, fontSize: 10 }}
                title="同一接口被多次调用,已按 endpoint 聚拢,参数取并集"
              >
                聚合 {mergedCount} 次调用
              </Tag>
            )}
            {/* LLM 接口功能推断:模型对该接口「做什么/返回什么」的一句话判断(rank 阶段 LLM 产出)。 */}
            {c.inferredFunction && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }} title="LLM 对该接口用途的推断(供理解,非 verify 结果)">
                  🤖 {c.inferredFunction}
                </Text>
              </div>
            )}
            {(qp.length > 0 || dyn.length > 0) && (
              <div style={{ marginTop: 4 }}>
                <Space size={[4, 4]} wrap>
                  {qp.map(([k, v]) => (
                    <Tag key={k} className="code" style={{ fontSize: 11 }}>
                      {k}={String(v).length > 20 ? String(v).slice(0, 20) + '…' : String(v)}
                    </Tag>
                  ))}
                  {dyn.map((p) => (
                    <Tag
                      key={p}
                      className="code"
                      style={{ fontSize: 11 }}
                      title="动态参数(时间戳/缓存破坏等,已排除出稳定 endpoint)"
                    >
                      {p}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
            {params.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <Space size={[4, 4]} wrap>
                  {params.map((p) => {
                    const tags: string[] = [];
                    if (p.dynamicLike) tags.push('动态');
                    if (p.cursorLike) tags.push('翻页');
                    if (p.observedVariation === true) tags.push('变');
                    const suffix = tags.length ? ` (${tags.join('/')})` : '';
                    return (
                      <Tag
                        key={`${p.in}:${p.name}`}
                        className="code"
                        style={{ fontSize: 10 }}
                        title={`并集参数 · ${p.in} · 出现 ${p.observedCount}/${p.totalCalls} 次`}
                      >
                        {p.name}
                        {suffix}
                      </Tag>
                    );
                  })}
                </Space>
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Rank 置信',
      key: 'score',
      width: 150,
      render: (_, c) => {
        const { rank } = candidateScoreDimensions(c);
        return (
          <Space size={4} wrap>
            <Text strong>{rank.score}</Text>
            <Tag color={rank.band === 'high' ? 'success' : rank.band === 'medium' ? token.colorPrimary : 'default'}>
              {rank.band}
            </Tag>
            <Tag
              color={c.scoredBy === 'llm' ? token.colorPrimary : undefined}
              style={{ fontSize: 10 }}
              title={
                c.scoredBy === 'llm'
                  ? 'LLM 评分(模型判定信号成立性,录制阶段证据置信,非 verify 结果)'
                  : '规则评分(LLM 不可用时的启发式兜底,非 verify 结果)'
              }
            >
              {c.scoredBy === 'llm' ? 'LLM' : '规则'}
            </Tag>
          </Space>
        );
      },
    },
    ...(hasAppliedLlmUtility
      ? [
          {
            title: 'LLM 效用',
            key: 'llmUtility',
            width: 130,
            render: (_: unknown, c: RankCandidate) => {
              const { utility } = candidateScoreDimensions(c);
              return utility && c.scoredBy === 'llm' ? (
                <Space size={4} wrap>
                  <Text strong>{utility.score}</Text>
                  <Tag
                    color={
                      utility.band === 'high' ? 'success' : utility.band === 'medium' ? token.colorPrimary : 'default'
                    }
                    title="模型对『做成数据命令是否有用』的语义判断；仅在评分响应成功解析并合并后显示"
                  >
                    {utility.band}
                  </Tag>
                </Space>
              ) : (
                <Text type="secondary">—</Text>
              );
            },
          },
        ]
      : []),
    {
      title: 'seed→参数',
      key: 'seed',
      width: 120,
      render: (_, c) => {
        const { hit, label } = seedHit(c);
        return hit ? (
          <Tag
            color={token.colorPrimary}
            title={`本次录制关键词映射到参数:${label}`}
            className="code"
            style={{ fontSize: 12 }}
          >
            {label}
          </Tag>
        ) : (
          <Text
            type="secondary"
            style={{ fontSize: 12 }}
            title="未检测到录制关键词映射到该接口参数(无参数据接口或未命中)"
          >
            未命中
          </Text>
        );
      },
    },
  ];
  // 运行后(locked):无 checkbox,改用「送 AI」列标注每个候选是否被送模型(未送 ≠ 被拒)。
  if (locked) {
    columns.push({
      title: '送 AI',
      key: 'sent',
      width: 88,
      render: (_, c) =>
        sentSet.has(c.id) ? (
          <Tag icon={<CheckCircleFilled />} color="success" title="本轮已把该接口元数据发送给 LLM 评分">
            已送
          </Tag>
        ) : (
          <Tag color="default" title="本轮未把该接口发送给 LLM(未勾选或超出 cap);未送 ≠ 被拒">
            未送 AI
          </Tag>
        ),
    });
  }
  const rowSelection = locked
    ? undefined
    : {
        selectedRowKeys: selectedIds,
        onChange: (keys: React.Key[]) => onSelectChange?.(keys.map(String)),
        getCheckboxProps: (c: RankCandidate) => ({ name: c.id }),
      };
  const table = (
    <Table
      size="small"
      rowKey="id"
      dataSource={rows}
      columns={columns}
      pagination={false}
      rowSelection={rowSelection}
      scroll={{ y: 320 }}
      title={() => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {locked
            ? `候选接口(已勾选的${llmSynthesis ? '参与 AI 评分' : '生成本地脚本'})`
            : llmSynthesis
            ? '勾选要交给 LLM 评审的接口（默认按评分选前若干；勾越多越慢）'
            : '勾选要生成本地脚本的接口'}
          {seeds.length ? (
            <>
              {' '}
              · 本次录制关键词:
              {seeds.map((s) => (
                <Tag key={s} className="code" style={{ fontSize: 12, marginInlineStart: 4 }}>
                  {s}
                </Tag>
              ))}
            </>
          ) : null}
        </Text>
      )}
    />
  );
  return (
    <Collapse
      size="small"
      defaultActiveKey={['cands']}
      style={{ marginBottom: 12 }}
      items={[
        {
          key: 'cands',
          label: `候选接口(${rows.length} 个${
            locked ? `,${llmSynthesis ? '已送 AI' : '已选择'} ${sentSet.size}` : `,已选 ${selectedIds.length}`
          })`,
          children: table,
        },
      ]}
    />
  );
}

/** pipeline 阶段进度:运行中实时展示 score/generate/verify 各阶段是否结束 + 耗时。 */
const STAGE_LABEL: Record<string, string> = {
  score: 'LLM 评分接口',
  generate: '生成 cli 脚本',
  verify: '验证脚本(verify)',
};
export function ProgressPanel({
  phases,
  loading,
}: {
  phases?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;
  loading: boolean;
}) {
  const { token } = theme.useToken();
  if (!phases?.length && !loading) return null;
  const list = phases ?? [];
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Text strong style={{ fontSize: 13 }}>
          生成进度
        </Text>
      }
    >
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        {list.map((p) => (
          <div key={p.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            {p.status === 'done' ? (
              <CheckCircleFilled style={{ color: token.colorSuccess }} />
            ) : (
              <LoadingOutlined style={{ color: token.colorPrimary }} />
            )}
            <Text>{STAGE_LABEL[p.stage] ?? p.stage}</Text>
            {p.detail ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {p.detail}
              </Text>
            ) : null}
            <span style={{ flex: 1 }} />
            {p.status === 'done' && p.durationMs !== null && p.durationMs !== undefined ? (
              <Text type="secondary" className="code" style={{ fontSize: 12 }}>
                {(p.durationMs / 1000).toFixed(1)}s
              </Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                进行中…
              </Text>
            )}
          </div>
        ))}
        {loading && !list.some((p) => p.status === 'running') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <LoadingOutlined style={{ color: token.colorPrimary }} />
            <Text type="secondary">准备中…</Text>
          </div>
        )}
      </Space>
    </Card>
  );
}

/** 单个脚本草稿卡:可编辑源码 + 自定义底部操作区(actions:测试/保存按钮由第三步注入)。
 *  verify 未跑时显示「尚未测试」中性态;跑过按 usable 显示 ✓/未通过。 */
export function DraftCard({
  draft,
  source,
  onSourceChange,
  actions,
}: {
  draft: PipelineDraft;
  source: string;
  onSourceChange: (src: string) => void;

  /** 卡片底部操作区(测试/保存按钮 + 状态);由调用方注入。 */
  actions?: React.ReactNode;
}) {
  const { token } = theme.useToken();
  const v = draft.verify;
  const untested = !draft.usable && v.reasons?.includes('尚未测试');
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space wrap>
          <Text strong className="code">
            {draft.site}/{draft.name}
          </Text>
          <Tag
            color={
              draft.confidence === 'high' ? 'success' : draft.confidence === 'medium' ? token.colorPrimary : 'default'
            }
            title="Rank 置信(录制阶段评分,非 verify 结果)"
          >
            Rank {draft.score} · {draft.confidence}
          </Tag>
          {untested ? (
            <Tag color="default" title="尚未测试(点「测试」跑 verify)">
              未测试
            </Tag>
          ) : draft.usable ? (
            <Tag icon={<CheckCircleFilled />} color="success" title="Verify 状态(脚本实跑结果)">
              Verify ✓ {v.rows} 行 / {v.fieldCount} 字段
            </Tag>
          ) : (
            <Tag icon={<CloseCircleFilled />} color={token.colorWarning} title="Verify 状态(脚本实跑结果)">
              Verify 未通过
            </Tag>
          )}
        </Space>
      }
    >
      {!!draft.reason && (
        <Paragraph type="secondary" style={{ marginBottom: 6 }}>
          {draft.reason}
        </Paragraph>
      )}
      {!draft.usable && !untested && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message="verify 未达标(静态检查或抽取不符),仍可保存,但建议修改后再存"
          description={[...draft.staticViolations, ...v.reasons].join(';') || undefined}
        />
      )}
      {!!draft.risks.length && (
        <Alert type="info" showIcon style={{ marginBottom: 8 }} message={`风险:${draft.risks.join(';')}`} />
      )}
      <Text type="secondary" style={{ fontSize: 12 }}>
        adapter 源码(可编辑后保存):
      </Text>
      <Input.TextArea
        className="code"
        value={source}
        onChange={(e) => onSourceChange(e.target.value)}
        autoSize={{ minRows: 6, maxRows: 18 }}
        style={{ fontSize: 12, marginTop: 4 }}
      />
      {actions && <div style={{ marginTop: 10 }}>{actions}</div>}
    </Card>
  );
}
