import { useIntl, getIntl } from '@umijs/max';
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
    ? getIntl().formatMessage({ id: 'adapterRecorder.candidate.responseEcho' })
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
  const intl = useIntl();
  const { token } = theme.useToken();
  const rows = [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const hasAppliedLlmUtility = rows.some(
    (candidate) => candidate.scoredBy === 'llm' && typeof candidate.llmUtilityScore === 'number'
  );
  const seeds = [seedA, seedB].filter((s): s is string => !!s && !!s.trim());
  const sentSet = new Set(selectedIds);
  const columns: ColumnsType<RankCandidate> = [
    {
      title: intl.formatMessage({ id: 'adapterRecorder.candidate.api' }),
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
                title={intl.formatMessage({ id: 'adapterRecorder.candidate.groupedHint' })}
              >
                {intl.formatMessage({ id: 'adapterRecorder.candidate.merged' })}
                {mergedCount}
                {intl.formatMessage({ id: 'adapterRecorder.candidate.calls' })}
              </Tag>
            )}
            {/* LLM 接口功能推断:模型对该接口「做什么/返回什么」的一句话判断(rank 阶段 LLM 产出)。 */}
            {c.inferredFunction && (
              <div style={{ marginTop: 4 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 11 }}
                  title={intl.formatMessage({ id: 'adapterRecorder.candidate.purposeHint' })}
                >
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
                      title={intl.formatMessage({ id: 'adapterRecorder.candidate.dynamicSummary' })}
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
                    if (p.dynamicLike) tags.push(intl.formatMessage({ id: 'adapterRecorder.parameter.dynamic' }));
                    if (p.cursorLike) tags.push(intl.formatMessage({ id: 'adapterRecorder.parameter.pagination' }));
                    if (p.observedVariation === true)
                      tags.push(intl.formatMessage({ id: 'adapterRecorder.parameter.changedShort' }));
                    const suffix = tags.length ? ` (${tags.join('/')})` : '';
                    return (
                      <Tag
                        key={`${p.in}:${p.name}`}
                        className="code"
                        style={{ fontSize: 10 }}
                        title={intl.formatMessage(
                          { id: 'adapterRecorder.parameter.summary' },
                          { v0: p.in, v1: p.observedCount, v2: p.totalCalls }
                        )}
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
      title: intl.formatMessage({ id: 'adapterRecorder.candidate.rankConfidence' }),
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
                  ? intl.formatMessage({ id: 'adapterRecorder.score.modelHint' })
                  : intl.formatMessage({ id: 'adapterRecorder.score.ruleHint' })
              }
            >
              {c.scoredBy === 'llm' ? 'LLM' : intl.formatMessage({ id: 'adapterRecorder.candidate.rules' })}
            </Tag>
          </Space>
        );
      },
    },
    ...(hasAppliedLlmUtility
      ? [
          {
            title: intl.formatMessage({ id: 'adapterRecorder.candidate.utility' }),
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
                    title={intl.formatMessage({ id: 'adapterRecorder.score.utilityHint' })}
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
      title: intl.formatMessage({ id: 'adapterRecorder.candidate.seedMapping' }),
      key: 'seed',
      width: 120,
      render: (_, c) => {
        const { hit, label } = seedHit(c);
        return hit ? (
          <Tag
            color={token.colorPrimary}
            title={intl.formatMessage({ id: 'adapterRecorder.candidate.seedMatched' }, { v0: label })}
            className="code"
            style={{ fontSize: 12 }}
          >
            {label}
          </Tag>
        ) : (
          <Text
            type="secondary"
            style={{ fontSize: 12 }}
            title={intl.formatMessage({ id: 'adapterRecorder.candidate.seedUnmatchedHint' })}
          >
            {intl.formatMessage({ id: 'adapterRecorder.candidate.seedUnmatched' })}
          </Text>
        );
      },
    },
  ];
  // 运行后(locked):无 checkbox,改用「送 AI」列标注每个候选是否被送模型(未送 ≠ 被拒)。
  if (locked) {
    columns.push({
      title: intl.formatMessage({ id: 'adapterRecorder.score.sendToAi' }),
      key: 'sent',
      width: 88,
      render: (_, c) =>
        sentSet.has(c.id) ? (
          <Tag
            icon={<CheckCircleFilled />}
            color="success"
            title={intl.formatMessage({ id: 'adapterRecorder.score.sentHint' })}
          >
            {intl.formatMessage({ id: 'adapterRecorder.score.sent' })}
          </Tag>
        ) : (
          <Tag color="default" title={intl.formatMessage({ id: 'adapterRecorder.score.notSentHint' })}>
            {intl.formatMessage({ id: 'adapterRecorder.score.notSent' })}
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
            ? intl.formatMessage(
                { id: 'adapterRecorder.candidate.selectedCount' },
                {
                  v0: llmSynthesis
                    ? intl.formatMessage({ id: 'adapterRecorder.score.include' })
                    : intl.formatMessage({ id: 'adapterRecorder.generate.localScripts' }),
                }
              )
            : llmSynthesis
            ? intl.formatMessage({ id: 'adapterRecorder.score.selectionHint' })
            : intl.formatMessage({ id: 'adapterRecorder.generate.selectionHint' })}
          {seeds.length ? (
            <>
              {' '}
              {intl.formatMessage({ id: 'adapterRecorder.capture.keywords' })}
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
          label: intl.formatMessage(
            { id: 'adapterRecorder.candidate.count' },
            {
              v0: rows.length,
              v1: locked
                ? `,${
                    llmSynthesis
                      ? intl.formatMessage({ id: 'adapterRecorder.score.sentToAi' })
                      : intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selected' })
                  } ${sentSet.size}`
                : intl.formatMessage({ id: 'adapterRecorder.candidate.selectedSuffix' }, { v0: selectedIds.length }),
            }
          ),
          children: table,
        },
      ]}
    />
  );
}

/** pipeline 阶段进度:运行中实时展示 score/generate/verify 各阶段是否结束 + 耗时。 */
const STAGE_LABEL: Record<string, string> = {
  get score() {
    return getIntl().formatMessage({ id: 'adapterRecorder.score.apiStage' });
  },
  get generate() {
    return getIntl().formatMessage({ id: 'adapterRecorder.generate.action' });
  },
  get verify() {
    return getIntl().formatMessage({ id: 'adapterRecorder.verify.scriptStage' });
  },
};
export function ProgressPanel({
  phases,
  loading,
}: {
  phases?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;
  loading: boolean;
}) {
  const intl = useIntl();
  const { token } = theme.useToken();
  if (!phases?.length && !loading) return null;
  const list = phases ?? [];
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Text strong style={{ fontSize: 13 }}>
          {intl.formatMessage({ id: 'adapterRecorder.generate.progress' })}
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
                {intl.formatMessage({ id: 'adapterRecorder.progress.running' })}
              </Text>
            )}
          </div>
        ))}
        {loading && !list.some((p) => p.status === 'running') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <LoadingOutlined style={{ color: token.colorPrimary }} />
            <Text type="secondary">{intl.formatMessage({ id: 'adapterRecorder.progress.preparing' })}</Text>
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
  const intl = useIntl();
  const { token } = theme.useToken();
  const v = draft.verify;
  // 保留新旧接口的待验证标记，状态判断不能依赖当前显示语言。
  const untested = !draft.usable && (v.reasons?.includes('尚未测试') || v.reasons?.includes('pending verification'));
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
            title={intl.formatMessage({ id: 'adapterRecorder.score.confidenceHint' })}
          >
            Rank {draft.score} · {draft.confidence}
          </Tag>
          {untested ? (
            <Tag color="default" title={intl.formatMessage({ id: 'adapterRecorder.verify.notTestedHint' })}>
              {intl.formatMessage({ id: 'adapterRecorder.verify.untested' })}
            </Tag>
          ) : draft.usable ? (
            <Tag
              icon={<CheckCircleFilled />}
              color="success"
              title={intl.formatMessage({ id: 'adapterRecorder.verify.statusHint' })}
            >
              {intl.formatMessage({ id: 'adapterRecorder.verify.summary' }, { rows: v.rows, fields: v.fieldCount })}
            </Tag>
          ) : (
            <Tag
              icon={<CloseCircleFilled />}
              color={token.colorWarning}
              title={intl.formatMessage({ id: 'adapterRecorder.verify.statusHint' })}
            >
              {intl.formatMessage({ id: 'adapterRecorder.verify.notPassed' })}
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
          message={intl.formatMessage({ id: 'adapterRecorder.verify.belowStandard' })}
          description={[...draft.staticViolations, ...v.reasons].join(';') || undefined}
        />
      )}
      {!!draft.risks.length && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message={intl.formatMessage({ id: 'adapterRecorder.candidate.risks' }, { v0: draft.risks.join(';') })}
        />
      )}
      <Text type="secondary" style={{ fontSize: 12 }}>
        {intl.formatMessage({ id: 'adapterRecorder.scripts.source' })}
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
