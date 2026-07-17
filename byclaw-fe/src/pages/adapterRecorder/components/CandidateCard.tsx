/* eslint-disable indent */
// 单个 RankCandidate 候选卡 —— 展示 score/confidence/risks/scoreExplanation/endpoint。
// 配色全走主题 token(theme.useToken),等宽字段用 Fira Code(.code class)。
import { CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Progress, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { CONFIDENCE_LABEL } from '../constants/recorder';
import type { Confidence, RankCandidate, VerifySummary } from '../types/recorder';
import { candidateScoreDimensions } from './candidateScore';

const { Text, Paragraph } = Typography;

interface Props {
  candidate: RankCandidate;
  selected: boolean;
  disabled?: boolean;

  /** 可选 verify 结果(若该候选已 verify)。rank 阶段无此数据 → 仅显示 Rank 置信。 */
  verify?: VerifySummary;
  onSelect: (id: string) => void;
}

export default function CandidateCard({ candidate, selected, disabled, verify, onSelect }: Props) {
  const {
    id,
    endpoint,
    confidence,
    reviewRequired,
    args,
    responseShape,
    scoreExplanation,
    risks,
    scoredBy,
    paramObservations,
    responseShapeVariants,
    mergedRequestIds,
    inferredFunction,
    paramUnion,
  } = candidate;
  const { token } = theme.useToken();
  // 双维评分:rank(权威,总有)+ utility(LLM 效用,可选)。见 candidateScoreDimensions。
  const { rank, utility } = candidateScoreDimensions(candidate);
  // 聚拢指示:该候选 = 一个 endpoint 被调用 N 次的并集(14-plan 第1步)。
  const mergedCount = mergedRequestIds?.length ?? 0;
  const aggregated = mergedCount > 1;
  // confidence → 主题 token 色(高=主色青 / 中=info 蓝 / 低=warning 琥珀 / 拒绝=error 红)
  const confidenceColor: Record<Confidence, string> = {
    high: token.colorPrimary,
    medium: token.colorInfo,
    low: token.colorWarning,
    rejected: token.colorError,
  };
  const color = confidenceColor[confidence];
  const selectable = !disabled && confidence !== 'rejected';

  // LLM paramUnion 的 exposeAsArg → 必填/可选/不暴露(语义层标签,优先于 paramObservations 事实)。
  const EXPOSE_LABEL: Record<'yes' | 'optional_candidate' | 'no', { text: string; tip: string; color?: string }> = {
    yes: { text: '必填', tip: '建议作为命令必填入参', color: token.colorPrimary },
    optional_candidate: { text: '可选', tip: '可作为命令可选入参', color: token.colorInfo },
    no: { text: '不暴露', tip: '基础设施/动态/鉴权参数,不建议暴露为入参' },
  };
  const usePU = !!paramUnion?.length; // 有 LLM 语义推断则优先展示它,否则回退 core 事实

  return (
    <Card
      size="small"
      onClick={() => selectable && onSelect(id)}
      style={{
        borderColor: selected ? color : undefined,
        borderWidth: selected ? 2 : 1,
        cursor: selectable ? 'pointer' : 'not-allowed',
        opacity: confidence === 'rejected' ? 0.6 : 1,
        transition: 'border-color 200ms, box-shadow 200ms',
        boxShadow: selected ? `0 0 0 2px ${color}33` : undefined,
      }}
      title={
        <Space size={8} wrap>
          <Tag color={color} style={{ marginInlineEnd: 0 }}>
            {CONFIDENCE_LABEL[confidence]}
          </Tag>
          <Text strong className="code">
            {endpoint.method} {endpoint.pathname}
          </Text>
          {aggregated && (
            <Tooltip title="同一接口在 A/B 录制里被多次调用,已按 endpoint 聚拢成一行,参数取并集">
              <Tag color={token.colorInfo} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                聚合 {mergedCount} 次调用
              </Tag>
            </Tooltip>
          )}
        </Space>
      }
      extra={
        <Space size={12} align="start">
          {/* Rank 置信:be 权威双轨分,决定排序/自动生成(录制阶段、可审计,非 verify 结果) */}
          <Tooltip title="系统基于可审计证据计算,决定排序与自动生成">
            <Space direction="vertical" size={2} align="center">
              <Progress
                type="circle"
                percent={Math.max(0, Math.min(100, rank.score))}
                size={40}
                strokeColor={confidenceColor[rank.band]}
                format={(p) => <span style={{ fontSize: 11 }}>{p}</span>}
              />
              <Text type="secondary" style={{ fontSize: 10, lineHeight: '12px' }}>
                Rank 置信
              </Text>
              <Tag
                color={scoredBy === 'llm' ? token.colorPrimary : undefined}
                style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}
              >
                {scoredBy === 'llm' ? 'LLM' : '规则'}
              </Tag>
            </Space>
          </Tooltip>
          {/* LLM 效用:模型自报「做成数据命令是否有用」的语义判断,仅供参考(可选,LLM-off 无此维度) */}
          {utility && (
            <Tooltip title="模型对『做成数据命令是否有用』的语义判断,仅供参考">
              <Space direction="vertical" size={2} align="center">
                <Progress
                  type="circle"
                  percent={Math.max(0, Math.min(100, utility.score))}
                  size={40}
                  strokeColor={confidenceColor[utility.band]}
                  format={(p) => <span style={{ fontSize: 11 }}>{p}</span>}
                />
                <Text type="secondary" style={{ fontSize: 10, lineHeight: '12px' }}>
                  LLM 效用
                </Text>
                <Tag
                  color={confidenceColor[utility.band]}
                  style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}
                >
                  {CONFIDENCE_LABEL[utility.band]}
                </Tag>
              </Space>
            </Tooltip>
          )}
        </Space>
      }
    >
      {inferredFunction && (
        <Paragraph style={{ marginBottom: 8, fontSize: 13, lineHeight: 1.5, color: token.colorText }}>
          <Text strong style={{ color }}>
            接口功能　
          </Text>
          {inferredFunction}
        </Paragraph>
      )}
      <Descriptions size="small" column={1} colon={false} styles={{ label: { width: 96 } }}>
        <Descriptions.Item label="URL 模板">
          <Text className="code" copyable style={{ fontSize: 12 }}>
            {endpoint.urlTemplate}
          </Text>
        </Descriptions.Item>
        {endpoint.queryParams && Object.keys(endpoint.queryParams).length > 0 && (
          <Descriptions.Item label="查询参数">
            <Space size={[4, 4]} wrap>
              {Object.entries(endpoint.queryParams).map(([k, v]) => (
                <Tag key={k} className="code" style={{ fontSize: 11 }}>
                  {k}={String(v).length > 24 ? String(v).slice(0, 24) + '…' : String(v)}
                </Tag>
              ))}
            </Space>
          </Descriptions.Item>
        )}
        {!!endpoint.dynamicParams?.length && (
          <Descriptions.Item label="动态参数">
            <Space size={[4, 4]} wrap>
              {endpoint.dynamicParams.map((p) => (
                <Tooltip key={p} title="时间戳/缓存破坏等动态参数,已排除出稳定 endpoint">
                  <Tag className="code" style={{ fontSize: 11 }}>
                    {p}
                  </Tag>
                </Tooltip>
              ))}
            </Space>
          </Descriptions.Item>
        )}
        {!!args?.length && (
          <Descriptions.Item label="参数映射">
            <Space size={[4, 4]} wrap>
              {args.map((a) => (
                <Tag key={a.argName} className="code" style={{ fontSize: 11 }}>
                  {a.argName} → {a.in}:{a.paramName}
                </Tag>
              ))}
            </Space>
          </Descriptions.Item>
        )}
        {usePU ? (
          <Descriptions.Item label="参数语义">
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {paramUnion!.map((p) => {
                const expose = p.exposeAsArg ? EXPOSE_LABEL[p.exposeAsArg] : undefined;
                return (
                  <Space key={`${p.in}:${p.name}`} size={[4, 2]} wrap style={{ fontSize: 11 }}>
                    <Tag className="code" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                      {p.name}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {p.in}
                    </Text>
                    {expose && (
                      <Tooltip title={expose.tip}>
                        <Tag color={expose.color} style={{ fontSize: 10, marginInlineEnd: 0 }}>
                          {expose.text}
                        </Tag>
                      </Tooltip>
                    )}
                    {p.paramRole && (
                      <Tooltip title={p.why || '参数语义角色(LLM 推断)'}>
                        <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{p.paramRole}</Tag>
                      </Tooltip>
                    )}
                    {p.inferredMeaning && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {p.inferredMeaning}
                      </Text>
                    )}
                  </Space>
                );
              })}
            </Space>
          </Descriptions.Item>
        ) : (
          !!paramObservations?.length && (
            <Descriptions.Item label="参数并集">
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                {paramObservations.map((p) => {
                  const flags: Array<{ text: string; tip: string }> = [];
                  if (p.dynamicLike) flags.push({ text: '动态', tip: '疑似时间戳/缓存破坏/签名等动态参数' });
                  if (p.cursorLike) flags.push({ text: '翻页', tip: '疑似 cursor/offset/page/limit 翻页参数' });
                  if (p.observedVariation === true)
                    flags.push({ text: '值有变化', tip: 'A/B 调用间该参数取值发生变化' });
                  else if (p.observedVariation === false)
                    flags.push({ text: '值固定', tip: 'A/B 调用间该参数取值未变(不等于一定是常量)' });
                  if (!p.observedAlways)
                    flags.push({ text: `${p.observedCount}/${p.totalCalls} 次出现`, tip: '该参数并非每次调用都出现' });
                  return (
                    <Space key={`${p.in}:${p.name}`} size={[4, 2]} wrap style={{ fontSize: 11 }}>
                      <Tag className="code" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                        {p.name}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {p.in}
                      </Text>
                      {flags.map((f) => (
                        <Tooltip key={f.text} title={f.tip}>
                          <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{f.text}</Tag>
                        </Tooltip>
                      ))}
                    </Space>
                  );
                })}
              </Space>
            </Descriptions.Item>
          )
        )}
        {responseShape && (
          <Descriptions.Item label="响应结构">
            <Text type="secondary" style={{ fontSize: 12 }}>
              {responseShape.kind}
              {responseShape.itemKeys?.length ? ` · ${responseShape.itemKeys.join(', ')}` : ''}
              {responseShape.count !== null && responseShape.count !== undefined ? ` · ${responseShape.count} 条` : ''}
            </Text>
            {responseShapeVariants && responseShapeVariants.length > 1 && (
              <Tooltip title="聚拢的多次调用返回过不同结构(已标记需复核)">
                <Tag color={token.colorWarning} style={{ marginInlineStart: 6, fontSize: 10 }}>
                  多形态 {responseShapeVariants.join('/')}
                </Tag>
              </Tooltip>
            )}
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* Q2b:Rank 置信(上方圆环,录制阶段)与 Verify 状态(下方,执行阶段)分离展示。
          verify 通过的候选不应因 rank 分低被当成垃圾;两者各自独立。仅在有 verify 结果时展示该行。 */}
      {verify !== null && verify !== undefined && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Verify 状态
          </Text>
          {verify.ok ? (
            <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginInlineEnd: 0, fontSize: 11 }}>
              通过{verify.rows !== null && verify.rows !== undefined ? ` · ${verify.rows} 行` : ''}
              {verify.fieldCount !== null && verify.fieldCount !== undefined ? ` / ${verify.fieldCount} 字段` : ''}
            </Tag>
          ) : (
            <Tooltip title={verify.error?.message || verify.stage || '验证未通过'}>
              <Tag icon={<WarningOutlined />} color={token.colorError} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                未通过{verify.stage ? ` · ${verify.stage}` : ''}
              </Tag>
            </Tooltip>
          )}
        </div>
      )}

      {!!scoreExplanation?.length && (
        <div style={{ marginTop: 8 }}>
          {scoreExplanation.map((s) => (
            <div
              key={s.signal}
              style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, lineHeight: 1.6 }}
            >
              <Tooltip title={s.detail}>
                <Text type="secondary">{s.signal}</Text>
              </Tooltip>
              <Text style={{ color: s.delta >= 0 ? token.colorSuccess : token.colorError }}>
                {s.delta >= 0 ? '+' : ''}
                {s.delta}
              </Text>
            </div>
          ))}
        </div>
      )}

      {!!risks?.length && (
        <Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
          <WarningOutlined /> {risks.join(';')}
        </Paragraph>
      )}

      <Button
        type={selected ? 'primary' : 'default'}
        size="small"
        block
        disabled={!selectable}
        aria-pressed={selected}
        aria-disabled={!selectable}
        icon={selected ? <CheckCircleOutlined /> : undefined}
        style={{ marginTop: 12 }}
        onClick={(e) => {
          e.stopPropagation();
          if (selectable) onSelect(id);
        }}
      >
        {confidence === 'rejected'
          ? '不可选(已拒绝)'
          : selected
          ? '已选定'
          : reviewRequired
          ? '选定(需复核)'
          : '选定此候选'}
      </Button>
    </Card>
  );
}
