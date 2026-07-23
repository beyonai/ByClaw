/* eslint-disable indent */
// 录制工作台主框架 —— 全屏单页:标题 + 会话状态带、青色进度轨(StepRail)、当前 step 操作区。
// 失败态切 ErrorRecovery;完成态显示 Result。数据/状态机走 useRecorderSession model。
import { useRef, useEffect } from 'react';
import { Result, Spin, Typography } from 'antd';
import { CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSelector } from '@umijs/max';
import useRecorderSession from './models/useRecorderSession';
import styles from './index.module.less';
import StepRail from './components/StepRail';
import UserIdentityBar from './components/UserIdentityBar';
import ErrorRecovery from './components/ErrorRecovery';
import AnalysisEvidencePanel from './components/AnalysisEvidencePanel';
import HealthStep from './steps/HealthStep';
import BindStep from './steps/BindStep';
import CaptureStep from './steps/CaptureStep';
import RankStep from './steps/RankStep';
import PipelineStep from './steps/PipelineStep';
import InitStep from './steps/InitStep';
import VerifyStep from './steps/VerifyStep';
import { FLOW_STEPS, flowStepsFor, STATE_ORDER, PIPELINE_SUBSTEP_OFFSET, isFailed } from './constants/recorder';
import { isActiveRecordingLayout } from './recordingLayout';

const { Text } = Typography;

export default function Workbench() {
  const userInfo = useSelector(({ user }) => user.userInfo);
  const { state, data, loading, error, actions } = useRecorderSession();

  const llmOn = !!data.health?.llmSynthesis;
  const order = STATE_ORDER[state];
  const failed = isFailed(state);

  // LLM 路径:进入 capture_b 自动跑 rank(候选提取,纯本地不外发)→ 用户无需手动「执行排序」,
  // 直接到 PipelineStep 的外发同意闸。ref 防重复触发;离开 capture_b 即复位以便重录。
  const autoRankedRef = useRef(false);
  useEffect(() => {
    if (state === 'capture_b' && llmOn && !loading && !error && !autoRankedRef.current) {
      autoRankedRef.current = true;
      actions.rank();
    }
    if (state !== 'capture_b') autoRankedRef.current = false;
  }, [state, llmOn, loading, error, actions]);
  // 记录已到达的最高 step:失败态 order=-1,用它把"失败"定位到失败前所在步骤,而非错误落到步骤 0。
  const lastReachedRef = useRef(0);
  // A/B 拆成独立步骤后,page_ready 在 B 段(已有 sampleA)应定位到「录制 B」步,而非「录制 A」(STATE_ORDER
  // 静态 map 给的是 A 段的 2)。用 sampleA 是否存在校正。
  const effectiveOrder = state === 'page_ready' && data.sampleA ? STATE_ORDER.capture_a : order;
  if (effectiveOrder >= 0) lastReachedRef.current = effectiveOrder;
  // 当前活动 step 序号(0-based);done=全完成;failed=定位失败前步骤;其余=effectiveOrder。
  const currentStep =
    state === 'done' ? FLOW_STEPS.length : failed ? lastReachedRef.current : Math.max(0, effectiveOrder);
  // LLM 路径步骤栏:去掉「排序候选」,并把「生成并保存」拆成三子步(评分候选/生成脚本/测试保存)。
  // capture_b(rank 运行中)/ranked 都落到三子步区:三子步起点 = 前置步数(head=health/bind/captureA/captureB);
  // ranked 态按 pipelineSubStep 映射到对应子步,capture_b 落到第一子步(评分)。done 落到末尾。
  const railSteps = flowStepsFor(llmOn);
  const subStepBase = railSteps.findIndex((s) => s.key === 'score'); // 三子步起点索引
  const railCurrent = !llmOn
    ? currentStep
    : state === 'done'
    ? railSteps.length
    : state === 'ranked'
    ? subStepBase + PIPELINE_SUBSTEP_OFFSET[data.pipelineSubStep ?? 'candidates']
    : state === 'capture_b'
    ? subStepBase // rank 运行中 → 评分子步
    : Math.min(currentStep, railSteps.length - 1);

  const renderActiveStep = () => {
    switch (state) {
      case 'idle':
        return <HealthStep health={data.health} loading={loading} done={false} onRun={actions.health} />;
      case 'health_checked':
        return <BindStep loading={loading} onBind={actions.bind} />;
      // 绑定后进录制 A 步;A 完成(capture_a)进录制 B 步。page_ready 按 sampleA 区分在 A 还是 B 段。
      case 'session_bound':
      case 'page_ready':
      case 'capture_a': {
        const phase: 'A' | 'B' = state === 'capture_a' || (state === 'page_ready' && !!data.sampleA) ? 'B' : 'A';
        return (
          <CaptureStep
            phase={phase}
            state={state}
            loading={loading}
            targetUrl={data.targetUrl}
            recordingMode={data.recordingMode}
            vncUrl={data.vncUrl}
            recording={data.recording}
            sampleA={data.sampleA}
            sampleB={data.sampleB}
            seedA={data.seedA}
            seedB={data.seedB}
            onSeedChange={actions.setSeed}
            onStartA={actions.startCaptureA}
            onStopA={actions.stopCaptureA}
            onStartB={actions.startCaptureB}
            onStopB={actions.stopCaptureB}
          />
        );
      }
      case 'ranked':
        // N5 verify-then-save:LLM 可用 → 走 pipeline(评分+多脚本+verify+选/改/存);
        // LLM 未启用 → 兜底回退到手动流程(选候选 + dry-run 预览 + 写入,旧 init/verify 链)。
        if (data.health?.llmSynthesis) {
          return (
            <PipelineStep
              loading={loading}
              subStep={data.pipelineSubStep ?? 'candidates'}
              drafts={data.pipelineDrafts}
              prompts={data.pipelinePrompts}
              candidates={data.candidates}
              sentCandidateIds={data.pipelineSentIds}
              pipelineProgress={data.pipelineProgress}
              seedA={data.seedA}
              seedB={data.seedB}
              sampleA={data.sampleA}
              sampleB={data.sampleB}
              rankScorePrompt={data.rankScorePrompt}
              generatePrompt={data.generatePrompt}
              llmRawJson={data.llmRawJson}
              draftVerifying={data.draftVerifying}
              savedDraftIds={data.savedDraftIds}
              savedAdapters={data.savedAdapters}
              onRunScore={actions.runScore}
              onGoToGenerate={actions.goToGenerate}
              onGoToCandidates={actions.goToCandidates}
              onRunGenerate={actions.runGenerate}
              onPreviewGenerate={actions.previewGeneratePrompt}
              onVerifyDraft={actions.verifyDraft}
              onSaveDraft={actions.saveDraft}
            />
          );
        }
        return (
          <>
            <RankStep
              loading={loading}
              candidates={data.candidates}
              selectedId={data.selectedCandidateId}
              sampleA={data.sampleA}
              onRank={actions.rank}
              onSelect={actions.selectCandidate}
            />
            <div className={styles.nextStep}>
              <InitStep
                loading={loading}
                selectedCandidate={data.candidates?.find((c) => c.id === data.selectedCandidateId)}
                adapterName={data.adapterName}
                preview={data.draftPreview}
                onPreview={actions.previewInit}
                onWrite={actions.writeInit}
              />
            </div>
          </>
        );
      case 'draft_created':
      case 'verifying':
        // 草稿已写入 → 在此触发 verify(draft_created→verifying);verifying/结果同屏展示。
        return <VerifyStep loading={loading} draft={data.draft} result={data.verifyResult} onVerify={actions.verify} />;
      default:
        return null;
    }
  };

  // 当处于 capture_b 但还没排序时,需要一个「执行排序」入口 → 进 RankStep
  const renderByStage = () => {
    if (failed && error) {
      return <ErrorRecovery error={error} terminal onRetry={actions.reset} onReset={actions.reset} />;
    }
    if (state === 'done') {
      return (
        <Result
          status="success"
          icon={<CheckCircleOutlined />}
          title="录制完成"
          subTitle="adapter 草稿已生成并通过 verify。raw capture 与临时文件已清理,仅保留脱敏报告。"
        />
      );
    }
    // capture_b → 候选提取。LLM 路径自动跑 rank,只显示分析中(无手动「排序候选」步);
    // LLM-off 兜底仍走手动 RankStep(选候选)。
    if (state === 'capture_b') {
      if (llmOn) {
        return (
          <div>
            <div style={{ padding: '32px 8px 24px', textAlign: 'center' }}>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 28 }} spin />} />
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">正在分析录制痕迹、提取候选接口…</Text>
              </div>
            </div>
            {/* 透明展示:本次分析用的 A/B 痕迹 + rank 阶段发给 LLM 的评分提示词(运行中提示词未回 → 占位)。 */}
            <AnalysisEvidencePanel
              sampleA={data.sampleA}
              sampleB={data.sampleB}
              scorePrompt={data.rankScorePrompt}
              defaultOpen
            />
          </div>
        );
      }
      return (
        <RankStep
          loading={loading}
          candidates={data.candidates}
          selectedId={data.selectedCandidateId}
          sampleA={data.sampleA}
          onRank={actions.rank}
          onSelect={actions.selectCandidate}
        />
      );
    }
    return renderActiveStep();
  };

  // 非终止错误(如 invalid_state / validation_failed)就地提示,不替换整个操作区
  const inlineError = error && !failed ? error : null;

  return (
    <div
      className={`${styles.workbench} ${
        isActiveRecordingLayout(state, data.recording) ? styles.recordingWorkbench : ''
      }`}
    >
      <div className={styles.shell}>
        <header className={styles.head}>
          <div className={styles.heading}>
            <h1 className={styles.title}>录制工作台</h1>
            <p className={styles.subtitle}>把浏览器操作整理成可复用的 OpenCLI adapter</p>
          </div>
        </header>

        <div className={styles.body}>
          <aside className={styles.sidebar} aria-label="录制流程和用户信息">
            <div className={styles.sidebarIntro}>
              <span className={styles.sidebarEyebrow}>WORKFLOW</span>
              <span className={styles.sidebarHint}>按步骤完成一次录制</span>
            </div>
            <StepRail steps={railSteps} current={railCurrent} failed={failed} />
            <UserIdentityBar userInfo={userInfo} />
          </aside>

          <main className={styles.stage} data-testid="recorder-work-surface">
            <div className={data.recording ? styles.recordingStage : styles.stepStage}>
              {inlineError && (
                <ErrorRecovery
                  error={inlineError}
                  terminal={false}
                  onRetry={() => {
                    // 非终止错误:清错由下一次动作触发,这里仅提供重置兜底
                  }}
                  onReset={actions.reset}
                />
              )}
              {renderByStage()}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
