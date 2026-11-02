import { useIntl } from '@umijs/max';
// 拆步① 评分候选页:进入自动 score(评分)→ A/B 痕迹 + 评分完成后的 LLM 提示词+
// 候选表(含 LLM 接口功能推断)+ 底部「下一步」。评分运行中显示进度 + 实时分阶段提示词。
import { useEffect, useRef, useState } from 'react';
import { RobotOutlined, ArrowRightOutlined, LoadingOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Collapse, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import type { CaptureSample, PipelinePrompts, RankCandidate } from '../types/recorder';
import AnalysisEvidencePanel from '../components/AnalysisEvidencePanel';
import { CandidateTable } from './pipelineShared';

const { Paragraph, Text } = Typography;

function finalModelContent(raw?: string) {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const withoutCompleteThinking = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return /^<think>/i.test(withoutCompleteThinking) ? undefined : withoutCompleteThinking || undefined;
}

/** LLM 返回内容面板:区分已应用到候选的语义评分与过滤思考块后的最终模型输出。 */
function LlmReturnPanel({ candidates, llmRawJson }: { candidates?: RankCandidate[]; llmRawJson?: string }) {
  const intl = useIntl();
  const llmCands = (candidates ?? []).filter((c) => c.scoredBy === 'llm' || c.inferredFunction || c.paramUnion?.length);
  const finalContent = finalModelContent(llmRawJson);
  if (!llmCands.length && !finalContent) return null;
  const summary = (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Text strong>{intl.formatMessage({ id: 'adapterRecorder.score.applied' })}</Text>
      {llmCands.length ? (
        llmCands.map((c) => (
          <div key={c.id} style={{ borderInlineStart: '2px solid #d9d9d9', paddingInlineStart: 8 }}>
            <Text className="code" style={{ fontSize: 12 }}>
              {c.endpoint?.method} {c.endpoint?.pathname || c.endpoint?.urlTemplate || c.id}
            </Text>
            {c.inferredFunction && (
              <div>
                <Text style={{ fontSize: 12 }}>🤖 {c.inferredFunction}</Text>
              </div>
            )}
            {!!c.paramUnion?.length && (
              <div style={{ marginTop: 2 }}>
                <Space size={[4, 4]} wrap>
                  {c.paramUnion.map((p) => (
                    <Tag key={p.name} className="code" style={{ fontSize: 10 }} title={p.inferredMeaning}>
                      {p.name}:{p.paramRole}
                      {p.exposeAsArg === 'yes'
                        ? intl.formatMessage({ id: 'adapterRecorder.score.requiredArgs' })
                        : p.exposeAsArg === 'optional_candidate'
                          ? intl.formatMessage({ id: 'adapterRecorder.score.optionalArgs' })
                          : ''}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </div>
        ))
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {intl.formatMessage({ id: 'adapterRecorder.score.notApplied' })}
        </Text>
      )}
      {finalContent && (
        <Collapse
          size="small"
          items={[
            {
              key: 'raw',
              label: intl.formatMessage({ id: 'adapterRecorder.score.finalResponse' }),
              children: (
                <Input.TextArea
                  className="code"
                  value={finalContent}
                  readOnly
                  autoSize={{ minRows: 6, maxRows: 20 }}
                  style={{ fontSize: 11 }}
                />
              ),
            },
          ]}
        />
      )}
    </Space>
  );
  return (
    <Collapse
      size="small"
      style={{ marginBottom: 12 }}
      items={[
        { key: 'llm-return', label: intl.formatMessage({ id: 'adapterRecorder.score.results' }), children: summary },
      ]}
    />
  );
}

interface Props {
  loading: boolean;
  llmSynthesis: boolean;

  /** 已评分产出的候选(含 LLM inferredFunction/paramUnion);未评分时 undefined。 */
  candidates?: RankCandidate[];

  /** 被送 LLM 的候选 id(评分回)。 */
  sentCandidateIds?: string[];

  /** 本轮发给 LLM 的提示词(score + generate)。 */
  prompts?: PipelinePrompts;

  /** 评分异步进度。 */
  pipelineProgress?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;
  seedA?: string;
  seedB?: string;
  sampleA?: CaptureSample;
  sampleB?: CaptureSample;

  /** LLM 返回内容；展示时会过滤思考块。 */
  llmRawJson?: string;
  llmError?: string;

  /** 触发评分(score-only);candidateIds=手选传 LLM 的候选(空→be 按 cap 自动 top-N)。 */
  onRunScore: (candidateIds?: string[], egressConsent?: boolean) => void;

  /** 选中态变化上报容器(供 generate 子步只为选中接口生成脚本)。 */
  onSelectionChange?: (ids: string[]) => void;

  /** 进入下一步(生成脚本页)。 */
  onNext: () => void;
}

export default function ScoreCandidatesStep({
  loading,
  llmSynthesis,
  candidates,
  sentCandidateIds,
  prompts,
  pipelineProgress,
  seedA,
  seedB,
  sampleA,
  sampleB,
  llmRawJson,
  llmError,
  onRunScore,
  onSelectionChange,
  onNext,
}: Props) {
  const intl = useIntl();
  // 是否已跑过**拆步 score 阶段**:以 sentCandidateIds 是否存在为准(rank 阶段只填 candidates、不填
  // sentCandidateIds;只有 score/preview 才填)。不能用 candidates 判——rank 已提前填充候选,会导致
  // score 阶段被跳过 → genStage 从不写入 → generate 报 no genCands(本次拆步曾踩的坑)。
  const scoreRan = sentCandidateIds !== undefined;
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const selectionInit = useRef(false);
  const autoScoredRef = useRef(false);

  const confirmLlmRescore = () => {
    Modal.confirm({
      title: intl.formatMessage({ id: 'adapterRecorder.score.confirmTitle' }),
      content: intl.formatMessage({ id: 'adapterRecorder.score.confirmDescription' }),
      okText: intl.formatMessage({ id: 'adapterRecorder.score.confirm' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      onOk: () => onRunScore(selectedCandidateIds.length ? selectedCandidateIds : undefined, true),
    });
  };

  // 进入评分候选页即自动跑一次 score；LLM 流程会显式传入外发同意标记。
  // 关键:即使 rank 已产出候选(candidates 非空),只要 score 阶段没跑过就必须跑——它才写 genStage 供 generate 用。
  useEffect(() => {
    if (!scoreRan && !loading && !autoScoredRef.current) {
      autoScoredRef.current = true;
      onRunScore(undefined, llmSynthesis);
    }
  }, [scoreRan, loading, llmSynthesis, onRunScore]);

  // 评分回来后用 be 的 top-N 初始化默认勾选(仅一次,之后尊重用户改动)。
  useEffect(() => {
    if (!selectionInit.current && sentCandidateIds && sentCandidateIds.length) {
      setSelectedCandidateIds(sentCandidateIds);
      selectionInit.current = true;
    }
  }, [sentCandidateIds]);

  // 选中态上报容器,供 generate 子步只为选中接口生成脚本(修 bug:此前 generate 拿不到选中态)。
  useEffect(() => {
    onSelectionChange?.(selectedCandidateIds);
  }, [selectedCandidateIds, onSelectionChange]);

  return (
    <Card
      title={
        llmSynthesis
          ? intl.formatMessage({ id: 'adapterRecorder.score.title' })
          : intl.formatMessage({ id: 'adapterRecorder.score.localTitle' })
      }
      variant="borderless"
    >
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        {llmSynthesis
          ? intl.formatMessage({ id: 'adapterRecorder.score.description' })
          : intl.formatMessage({ id: 'adapterRecorder.score.localDescription' })}
      </Paragraph>

      {/* 仅在用户确认且 score 阶段完成后展示实际发给 LLM 的提示词。 */}
      {llmSynthesis && scoreRan && (
        <AnalysisEvidencePanel
          sampleA={sampleA}
          sampleB={sampleB}
          scorePrompt={prompts?.score}
          showScorePrompt
          defaultOpen={false}
        />
      )}

      {/* score(LLM 评分)未跑完:显示"评分中",**不展示 rank 规则分候选**(避免低分闪现误导,
          rank 只是转场过渡的规则分)。等 LLM 评分完(scoreRan)才展示带 LLM 分/推断的候选表。 */}
      {!scoreRan ? (
        loading || !!pipelineProgress?.length ? (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 20 }} spin />} />
            <Text type="secondary">
              {llmSynthesis
                ? intl.formatMessage({ id: 'adapterRecorder.score.loading' })
                : intl.formatMessage({ id: 'adapterRecorder.score.localLoading' })}
            </Text>
          </div>
        ) : (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            icon={llmSynthesis ? <RobotOutlined /> : undefined}
            message={
              llmSynthesis
                ? intl.formatMessage({ id: 'adapterRecorder.score.pending' })
                : intl.formatMessage({ id: 'adapterRecorder.score.localPending' })
            }
            description={
              llmSynthesis
                ? intl.formatMessage({ id: 'adapterRecorder.score.consentHint' })
                : intl.formatMessage({ id: 'adapterRecorder.score.localHint' })
            }
            action={
              <Button type="primary" onClick={() => onRunScore(undefined, llmSynthesis)}>
                {llmSynthesis
                  ? intl.formatMessage({ id: 'adapterRecorder.score.start' })
                  : intl.formatMessage({ id: 'adapterRecorder.score.load' })}
              </Button>
            }
          />
        )
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <CandidateTable
              candidates={candidates ?? []}
              selectedIds={selectedCandidateIds}
              onSelectChange={setSelectedCandidateIds}
              seedA={seedA}
              seedB={seedB}
              llmSynthesis={llmSynthesis}
            />
          </div>
          {llmSynthesis && <LlmReturnPanel candidates={candidates} llmRawJson={llmRawJson} />}
          {llmError && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={llmError} />}
          {/* score 提示词已由上方 AnalysisEvidencePanel 展示;generate 提示词移到生成脚本页按选中候选展示。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {intl.formatMessage({ id: 'adapterRecorder.score.selectedPrefix' })}
              {selectedCandidateIds.length}
              {intl.formatMessage({ id: 'adapterRecorder.score.selectedSuffix' })}
            </Text>
            <span style={{ flex: 1 }} />
            <Button
              size="small"
              loading={loading}
              onClick={() =>
                llmSynthesis
                  ? confirmLlmRescore()
                  : onRunScore(selectedCandidateIds.length ? selectedCandidateIds : undefined)
              }
            >
              {llmSynthesis
                ? intl.formatMessage({ id: 'adapterRecorder.score.again' })
                : intl.formatMessage({ id: 'employeePublication.reload' })}
            </Button>
            <Button
              type="primary"
              icon={<ArrowRightOutlined />}
              disabled={!selectedCandidateIds.length}
              onClick={onNext}
            >
              {intl.formatMessage({ id: 'adapterRecorder.score.next' })}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
