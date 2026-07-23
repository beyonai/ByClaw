// Recorder Local Service 客户端接缝(03 契约 + 04 安全模型 + 05 状态机)。
// UI 只依赖 RecorderClient 接口,不关心后端 transport;当前实现固定走 byclaw Java HTTP endpoint。
// init/verify 在契约上是 202 异步 + GET /recorder/requests/{id} 轮询,但接口层把轮询
// 封装在 HTTP 实现内部,统一返回最终 RequestEnvelope<T>,使 useRecorderSession 与 transport 解耦。
import type {
  CaptureSample,
  HealthReport,
  InitResult,
  PipelineDraft,
  PipelineResult,
  PipelinePrompts,
  RankCandidate,
  RequestEnvelope,
  SaveResult,
  SessionState,
  VerifySummary,
} from '../types/recorder';
import { createHttpRecorderClient } from './byclawRecorderClient';

/** init 写入策略(契约 InitRequest.writePolicy 字面量,连字符) */
export type WritePolicy = 'dry-run' | 'write';

/** bind 模式(05 章 Authentication Session Binding;映射到契约 mode 枚举) */
export type BindMode = 'existing' | 'await_login';

/** 产品录制形态(应用层策略,与 BindMode 区分;当前主路径缺省 vnc):
 *  - tab_projection:扩展真 tab + 投屏(对所有站通用,默认)。
 *  - embedded_iframe:dashboard 嵌跨源目标 iframe 录制(仅不反嵌的公开站,受 flag gate)。
 *  - vnc:浏览器+扩展+daemon 全在 podman 容器内,noVNC 投容器画面、用户操作容器 Chromium 录制(受 flag gate)。 */
export type RecordingMode = 'tab_projection' | 'embedded_iframe' | 'vnc';

/** pipeline 阶段进度项(score/generate/verify…):前端轮询途中实时展示每阶段是否结束 + 耗时。 */
export interface PipelineProgressPhase {
  stage: string;
  status: 'running' | 'done';
  durationMs?: number;
  detail?: string;
}

/** pipeline 阶段性 prompt:be 分阶段就绪(score 先出、score 完出 generate)时回调,供分析过渡页按阶段展示提示词。 */
export interface PipelinePartialPrompts {
  score?: string;
  generate?: string;
  screenshotCount?: number;
}

/** rank 结果:候选数组 + rank 阶段真正发给 LLM 的评分提示词(LLM-off 时 undefined)。 */
export interface RankResult {
  candidates: RankCandidate[];

  /** rank 阶段实际发给 LLM 的评分提示词(与 be buildScorePrompt 同源;LLM 未启用时缺省)。 */
  scorePrompt?: string;
}

/** 拆步①评分结果:候选、本地提示词、可选的 LLM 语义评分状态。 */
export interface PipelineScoreResult {
  candidates: RankCandidate[];
  rejected: Array<{ candidateId: string; reason: string }>;

  /** score 阶段发给 LLM 的评分提示词。 */
  scorePrompt: string;

  /** 本地确定性生成阶段的说明提示词。 */
  generatePrompt: string;
  screenshotCount: number;

  /** 本轮参与候选处理的接口。 */
  sentCandidateIds: string[];

  /** LLM 返回的原始 interfaces JSON 文本(透明展示;LLM-off/解析失败时缺省)。 */
  llmRawJson?: string;
  llmSynthesisUsed?: boolean;
  llmError?: string;
}

/** bind 返回:awaitingLogin=true 表示进入 awaiting_user_login 分支;vncUrl=vnc 模式容器 noVNC 画面地址 */
export interface BindResult {
  sessionId: string;
  contextId: string;
  targetId: string;
  awaitingLogin: boolean;
  recordingMode?: RecordingMode;

  /** vnc 模式:容器宿主映射的 noVNC 画面 URL(前端 iframe 直连)。其它模式 undefined。 */
  vncUrl?: string;
}

/** be 回的会话推进结果(side-effect 后的状态机快照)。对齐 be handleConfirmAuth/handleCaptureStart
 * 实际响应 {sessionId,state,stateVersion,...}(此前前端类型写的 {authConfirmed}/{capturing} 与 be 漂移)。 */
export interface SessionAdvanceResult {
  sessionId: string;
  state: SessionState;
  stateVersion: number;
}

/**
 * Recorder Local Service 的 UI 侧契约。所有 side-effect 方法对应 03 章 POST endpoint,
 * 返回统一响应包 RequestEnvelope<T>。错误以 envelope.error 回传(不抛),保持与 run() 兼容。
 */
export interface RecorderClient {
  health(): Promise<RequestEnvelope<HealthReport>>;

  /** url:await_login 模式下传目标 URL,be 会立刻开 byCLI tab 跳该 URL 供用户登录。
   *  recordingMode:产品录制形态(缺省 vnc);embedded_iframe 受 flag gate。 */
  bind(mode: BindMode, url?: string, recordingMode?: RecordingMode): Promise<RequestEnvelope<BindResult>>;
  confirmAuth(): Promise<RequestEnvelope<SessionAdvanceResult>>;
  navigate(url: string): Promise<RequestEnvelope<{ url: string }>>;
  captureStart(
    sample: 'A' | 'B'
  ): Promise<RequestEnvelope<SessionAdvanceResult & { sampleName: 'A' | 'B'; started: boolean }>>;

  /** seed:本次样本声明的搜索关键词(评分识别 seed→param;be 用它反推参数名后只存 HMAC 证据,raw 不落盘)。 */
  captureRead(sample: 'A' | 'B', seed?: string): Promise<RequestEnvelope<CaptureSample>>;

  /** 一体化录制(Phase 1):取目标页单帧投屏(base64 jpeg);前端轮询刷新预览。只读、不推进状态。 */
  screenshot(quality?: number): Promise<RequestEnvelope<{ format: string; data: string }>>;

  /** 一体化录制(Phase 2):把 canvas 上的输入经 CDP Input.* 回传到真 tab。
   *  cdpMethod 限 Input.dispatchMouseEvent/dispatchKeyEvent/insertText(be 侧白名单)。 */
  sendInput(cdpMethod: string, cdpParams: Record<string, unknown>): Promise<RequestEnvelope<{ dispatched: boolean }>>;

  /** rank(候选提取 + LLM 语义重打分,同步 200)。返回候选数组 + rank 阶段真正发给 LLM 的评分提示词
   *  (scorePrompt;LLM-off 时 undefined),供转场页/候选表透明展示。 */
  rank(): Promise<RequestEnvelope<RankResult>>;

  /**
   * select-only init(契约 InitRequest required: name + writePolicy + selectedCandidateId)。
   * be 端从选定候选服务端派生 domain/strategy/endpoint。dry-run 仅预览(不推进会话);
   * write 提交草稿并推进 ranked→draft_created,write 时必带 responsibleUseAcknowledgedAt(ADR-0005)。
   * be /recorder/init 是同步 200,直接回 InitResult{report,dryRun}(非 202 轮询)。
   */
  init(
    name: string,
    selectedCandidateId: string,
    writePolicy: WritePolicy,
    responsibleUseAcknowledgedAt?: number,

    /** P0-2 外发前置同意:带此戳才允许 LLM 合成(把截图+真实响应发往 Anthropic);不带则不外发、退回空模板。 */
    llmEgressAcknowledgedAt?: number
  ): Promise<RequestEnvelope<InitResult>>;

  /** verify(契约 VerifyRequest required: name);202 异步,内部轮询至 terminal 得 VerifySummary。 */
  verify(name: string): Promise<RequestEnvelope<VerifySummary>>;

  /** N4/N5 verify-then-save:从 ranked 跑 LLM 评分→多脚本→静态检查→草稿→verify→收集;带 egress 同意戳。
   *  candidateIds=用户手选要传 LLM 的候选(空→be 按 cap 自动 top-N)。
   *  onProgress=pipeline 异步轮询途中的阶段进度回调(score/generate/verify 耗时),用于页面实时展示。
   *  onPartial=阶段性 prompt 回调(be 在 score/generate 就绪时分阶段回),让分析过渡页按阶段展示提示词。 */
  pipeline(
    llmEgressAcknowledgedAt?: number,
    candidateIds?: string[],
    onProgress?: (phases: PipelineProgressPhase[]) => void,
    onPartial?: (prompts: PipelinePartialPrompts) => void
  ): Promise<RequestEnvelope<PipelineResult>>;

  /** 外发前预览:不调用 LLM、不外发、不改状态,只返回将要发送的提示词 + 截图张数 + 会被喂 LLM 的候选 id。
   *  candidateIds=用户在候选页选中要生成脚本的接口 → be 据此构建按选中的 generate 提示词预览(空→全部 genCands)。 */
  pipelinePreview(
    candidateIds?: string[]
  ): Promise<RequestEnvelope<{ prompts: PipelinePrompts; sentCandidateIds: string[] }>>;

  /** 拆步①评分:score-only。回候选(含 LLM inferredFunction/paramUnion)+ score/generate 提示词 + 送 LLM 候选 id。
   *  不生成、不产草稿。genCands 由 be 存 registry 供第②步生成复用。202 异步。 */
  pipelineScore(
    llmEgressAcknowledgedAt?: number,
    candidateIds?: string[],
    onProgress?: (phases: PipelineProgressPhase[]) => void,
    onPartial?: (prompts: PipelinePartialPrompts) => void
  ): Promise<RequestEnvelope<PipelineScoreResult>>;

  /** 拆步②生成:generate-only。读 be 存的 genCands 生成脚本+静态检查+写草稿(不 verify)。202 异步。
   *  candidateIds=用户在候选页选中要生成脚本的接口(be 只为选中且 decision==='generate' 的候选生成);
   *  空/未传 → be 用全部 genCands(向后兼容)。 */
  pipelineGenerate(
    llmEgressAcknowledgedAt: number,
    candidateIds?: string[],
    onProgress?: (phases: PipelineProgressPhase[]) => void
  ): Promise<RequestEnvelope<{ drafts: PipelineDraft[] }>>;

  /** 拆步③单草稿测试:draftId 对应草稿真 verify(daemon /v1/verify),回 verify 结果 + usable。202 异步。 */
  draftVerify(
    draftId: string,
    source?: string
  ): Promise<
    RequestEnvelope<{
      draftId: string;
      verify: PipelineDraft['verify'];
      usable: boolean;
      verifiedSourceHash?: string;
      verifiedAt?: number;
    }>
  >;

  /** 保存某个(可能编辑过的)草稿到 clis/;首次必须 overwrite=false,用户确认后才能传 true。 */
  saveAdapter(draftId: string, source?: string, overwrite?: boolean): Promise<RequestEnvelope<SaveResult>>;

  /** 多选保存:每个草稿独立声明是否覆盖;未声明一律按 false 处理。 */
  saveAdapters(
    drafts: Array<{ draftId: string; source?: string; overwrite?: boolean }>
  ): Promise<RequestEnvelope<SaveResult>>;
  cancel(): Promise<RequestEnvelope<{ cancelled: boolean }>>;
}

/**
 * transport 选择:
 * - 默认走 byclaw Java 后端 HTTP endpoint。
 * - bootstrap 仅用于覆盖 baseUrl/token/feature flags。
 */
export type RecorderTransport = 'http';

/**
 * bootstrap 配置(04 章 Token Lifecycle):localhost HTTP 形态下,Local Service 在启动时
 * 经 one-time bootstrap(loopback handshake / IPC / 单次 URL)把 token 注入到 sessionStorage,
 * token 只存内存/sessionStorage,绝不落日志。读不到则视为未启用 HTTP transport。
 */
export interface RecorderBootstrap {
  enabled: boolean;
  baseUrl: string;

  /** byclaw 后端默认走登录态鉴权；如后续需要独立 recorder token，可由后端注入。 */
  token?: string;

  /** 可选 CSRF token；byclaw-be 若启用双重提交时再注入。 */
  csrfToken?: string;

  /** embedded_iframe 录制模式是否可用(be FEATURE_EMBEDDED_IFRAME_RECORDING);决定 BindStep 是否显示「页内嵌入」。 */
  embeddedIframeRecording?: boolean;

  /** vnc 录制模式是否可用(be FEATURE_VNC_RECORDING);决定 BindStep 是否显示「VNC 容器」。 */
  vncRecording?: boolean;
}

export const BOOTSTRAP_KEY = '__byclaw_recorder_bootstrap__';
export const DEFAULT_RECORDER_BOOTSTRAP: RecorderBootstrap = {
  enabled: true,
  baseUrl: '/byaiService/recorder',
  embeddedIframeRecording: false,
  vncRecording: true,
};

/** 从 sessionStorage 读取 bootstrap(注入点;SSR/无 window 时回落未启用) */
export function readBootstrap(): RecorderBootstrap | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(BOOTSTRAP_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Partial<RecorderBootstrap>;
    if (!b.enabled) return null;
    return {
      enabled: true,
      baseUrl: b.baseUrl ?? '/byaiService/recorder',
      token: typeof b.token === 'string' ? b.token : undefined,
      csrfToken: typeof b.csrfToken === 'string' ? b.csrfToken : undefined,
      embeddedIframeRecording: b.embeddedIframeRecording === true,
      vncRecording: b.vncRecording === true,
    };
  } catch {
    return null;
  }
}

let cached: RecorderClient | null = null;

/** 解析当前应使用的 client。默认直接走 byclaw-be HTTP；bootstrap 只负责覆盖 baseUrl/token/flags。 */
export function getRecorderClient(): RecorderClient {
  if (cached) return cached;
  cached = createHttpRecorderClient(readBootstrap() ?? DEFAULT_RECORDER_BOOTSTRAP);
  return cached;
}

export function resetRecorderClient(): void {
  cached = null;
}

/** embedded_iframe 录制模式是否可用:读 bootstrap flag；默认关闭。 */
export function isEmbeddedIframeRecordingAvailable(): boolean {
  const bootstrap = readBootstrap();
  if (!bootstrap) return DEFAULT_RECORDER_BOOTSTRAP.embeddedIframeRecording === true;
  return bootstrap.embeddedIframeRecording === true;
}

/** vnc 录制模式是否可用:读 bootstrap flag；默认开启。 */
export function isVncRecordingAvailable(): boolean {
  const bootstrap = readBootstrap();
  if (!bootstrap) return DEFAULT_RECORDER_BOOTSTRAP.vncRecording === true;
  return bootstrap.vncRecording === true;
}
