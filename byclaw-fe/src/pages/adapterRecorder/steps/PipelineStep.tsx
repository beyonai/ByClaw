// 拆步流程容器:按 pipelineSubStep 路由到三子页(评分候选 → 生成脚本 → 测试保存)。
// 三子页均停留后端 ranked 态(pipeline 不推进状态),仅前端 subStep 控制切换。
import type { CaptureSample, PipelineDraft, PipelinePrompts, RankCandidate, SavedAdapter } from '../types/recorder';
import { useState, useEffect } from 'react';
import ScoreCandidatesStep from './ScoreCandidatesStep';
import GenerateStep from './GenerateStep';
import ScriptsStep from './ScriptsStep';

interface Props {
  loading: boolean;
  llmSynthesis: boolean;

  /** 当前子步:candidates(评分候选)/ generate(生成脚本)/ scripts(测试保存)。 */
  subStep: 'candidates' | 'generate' | 'scripts';
  drafts?: PipelineDraft[];
  prompts?: PipelinePrompts;
  candidates?: RankCandidate[];
  sentCandidateIds?: string[];
  pipelineProgress?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;
  seedA?: string;
  seedB?: string;
  sampleA?: CaptureSample;
  sampleB?: CaptureSample;
  generatePrompt?: string;
  llmRawJson?: string;
  llmError?: string;
  draftVerifying?: Record<string, boolean>;
  savedDraftIds?: string[];
  savedAdapters?: SavedAdapter[];
  onRunScore: (candidateIds?: string[]) => void;
  onGoToGenerate: () => void;
  onGoToCandidates: () => void;
  onRunGenerate: (candidateIds?: string[]) => void;

  /** 生成子步:按选中候选取 generate 提示词预览(不调 LLM)。 */
  onPreviewGenerate?: (candidateIds?: string[]) => void;
  onVerifyDraft: (draftId: string, source?: string) => void;
  onSaveDraft: (draftId: string, source?: string) => void;
}

export default function PipelineStep(props: Props) {
  const { subStep, onPreviewGenerate } = props;
  // 用户在候选页勾选要生成脚本的接口 —— 提升到容器级,让 generate 子步也拿得到(修 bug:此前
  // 选中态只活在 ScoreCandidatesStep 内,generate 拿不到 → be 为所有 decision==='generate' 候选生成)。
  const [genSelectedIds, setGenSelectedIds] = useState<string[]>([]);
  const selectedCandidates = (props.candidates ?? []).filter((candidate) => genSelectedIds.includes(candidate.id));

  // 进入生成子步 / 选中变化 → 按选中候选取 generate 提示词预览(与实际生成一致的透明预览)。
  useEffect(() => {
    if (subStep === 'generate') onPreviewGenerate?.(genSelectedIds.length ? genSelectedIds : undefined);
  }, [subStep, genSelectedIds, onPreviewGenerate]);

  if (subStep === 'generate') {
    return (
      <GenerateStep
        loading={props.loading}
        llmSynthesis={props.llmSynthesis}
        pipelineProgress={props.pipelineProgress}
        selectedCandidates={selectedCandidates}
        onRunGenerate={() => props.onRunGenerate(genSelectedIds.length ? genSelectedIds : undefined)}
        onBack={props.onGoToCandidates}
      />
    );
  }

  if (subStep === 'scripts') {
    return (
      <ScriptsStep
        loading={props.loading}
        drafts={props.drafts}
        draftVerifying={props.draftVerifying}
        savedDraftIds={props.savedDraftIds}
        savedAdapters={props.savedAdapters}
        onVerifyDraft={props.onVerifyDraft}
        onSaveDraft={props.onSaveDraft}
        onBack={props.onGoToGenerate}
      />
    );
  }

  // 默认:评分候选页
  return (
    <ScoreCandidatesStep
      loading={props.loading}
      llmSynthesis={props.llmSynthesis}
      candidates={props.candidates}
      sentCandidateIds={props.sentCandidateIds}
      prompts={props.prompts}
      pipelineProgress={props.pipelineProgress}
      seedA={props.seedA}
      seedB={props.seedB}
      sampleA={props.sampleA}
      sampleB={props.sampleB}
      llmRawJson={props.llmRawJson}
      llmError={props.llmError}
      onRunScore={props.onRunScore}
      onSelectionChange={setGenSelectedIds}
      onNext={props.onGoToGenerate}
    />
  );
}
