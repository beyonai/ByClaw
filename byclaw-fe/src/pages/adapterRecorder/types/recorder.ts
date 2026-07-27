/* eslint-disable lines-around-comment */
// Adapter Recorder 契约类型 —— 对齐 dashboard/schemas/adapter-recorder.bundle.json ($defs)
// 修改本文件须同步 schema bundle(prose 与 schema 必须一起更新)。

/** 统一响应包(03 · Contracts) */
export interface RequestEnvelope<T = unknown> {
  ok: boolean;
  schemaVersion: 'recorder.v1';
  requestId: string;
  data: T | null;
  error: RecorderError | null;
}

/** 错误码枚举(schema $defs/ErrorCode) */
export type ErrorCode =
  | 'validation_failed'
  | 'invalid_state'
  | 'csrf_failed'
  | 'auth_failed'
  | 'auth_required'
  | 'authentication_required'
  | 'responsible_use_required'
  | 'network_error'
  | 'insufficient_samples'
  | 'daemon_unavailable'
  | 'daemon_timeout'
  | 'daemon_protocol_error'
  | 'extension_disconnected'
  | 'profile_busy'
  | 'queue_full'
  | 'page_lost'
  | 'navigation_url_forbidden'
  | 'navigation_redirect_requires_interception'
  | 'dns_resolution_failed'
  | 'request_not_found'
  | 'session_not_found'
  | 'idempotency_conflict'
  | 'temp_store_full'
  | 'verify_timeout'
  | 'pipeline_timeout'
  | 'analyze_timeout'
  | 'adapter_runtime_error'
  | 'runner_protocol_error'
  | 'shape_mismatch'
  | 'fixture_mismatch'
  | 'output_truncated'
  | 'feature_disabled'
  | 'ambiguous_iframe_target'
  | 'config_invalid'
  | 'verification_required'
  | 'source_changed_after_verify'
  | 'save_adapter_disabled'
  | 'adapter_exists'
  | 'bycli_storage_unavailable'
  | 'resource_save_failed';

export interface RecorderError {
  code: ErrorCode;
  message: string;
  hint?: string | null;
  details?: Record<string, unknown>;
}

/** 会话状态机(05 · State Machine) */
export type SessionState =
  | 'idle'
  | 'health_checked'
  | 'session_bound'
  | 'awaiting_user_login'
  | 'auth_confirmed'
  | 'page_ready'
  | 'capture_a'
  | 'capture_b'
  | 'ranked'
  | 'draft_created'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled';

/** EndpointDescriptor($defs) */
export interface EndpointDescriptor {
  method: string;
  urlTemplate: string;
  host: string;
  pathname: string;
  queryParams?: Record<string, unknown>;
  dynamicParams?: string[];
  excludedParams?: string[];
  requestBodyShape?: {
    type?: 'json' | 'form' | 'text' | 'empty';
    keys?: string[];
  };
  authRequired?: boolean;
}

/** ArgMapping($defs) */
export interface ArgMapping {
  argName: string;
  in: 'query' | 'body' | 'path' | 'header';
  paramName: string;
  valueType?: string;
  evidenceId?: string;
}

/** ResponseShape($defs) */
export interface ResponseShape {
  kind?: 'array' | 'object' | 'scalar' | 'html' | 'unknown';
  itemKeys?: string[];
  count?: number;
  shapeConfidence?: number;
  echoesSeedArg?: boolean;
}

/** ColumnDescriptor($defs) */
export interface ColumnDescriptor {
  name: string;
  path: string;
  type?: string;
}

/** ScoreExplanationItem($defs) */
export interface ScoreExplanationItem {
  signal: string;
  delta: number;
  detail?: string;
}

export type Confidence = 'high' | 'medium' | 'low' | 'rejected';

/**
 * ParamObservation($defs) —— recorder-core 聚拢出的**确定性参数事实**(14-plan 第1步)。
 * 只放观测事实,绝不含语义判断(paramRole/exposeAsArg 是 LLM 层的活,不在此契约)。
 */
export interface ParamObservation {
  name: string;
  in: 'query' | 'body';
  observedCount: number;
  totalCalls: number;
  observedSamples: Array<'A' | 'B'>;
  observedAlways: boolean;
  observedVariation: boolean | 'unknown';
  valueKinds: string[];
  dynamicLike: boolean;
  cursorLike: boolean;
}

/**
 * ParamUnionItem($defs) —— LLM 在 ParamObservation 事实之上推断的**参数语义角色**(14-plan 第2/5步)。
 * 由 dashboard-be/llm/score.ts 产出,be 在 /recorder/rank 合并到 RankCandidate;LLM-off 路径无此字段。
 * 与 core 不同:这里带语义判断(paramRole/exposeAsArg/inferredMeaning),是 LLM 层的活。
 */
export interface ParamUnionItem {
  name: string;
  in: 'query' | 'body' | 'path' | 'header';
  requiredness?: 'always' | 'optional';
  observedVariation?: boolean;
  paramRole?: string;
  exposeAsArg?: 'yes' | 'optional_candidate' | 'no';
  inferredMeaning?: string;
  why?: string;
}

/** RankCandidate($defs) —— rank 步骤核心输出 */
export interface RankCandidate {
  id: string;
  endpoint: EndpointDescriptor;
  score: number;
  confidence: Confidence;
  reviewRequired: boolean;
  args?: ArgMapping[];
  excludedParams?: string[];
  responseShape?: ResponseShape;
  columns?: ColumnDescriptor[];
  scoreExplanation?: ScoreExplanationItem[];
  risks?: string[];
  evidenceIds?: string[];

  /** 14-plan 第1步:聚拢后该 endpoint group 全部成员调用的请求参数并集(只放事实)。可选/向后兼容。 */
  paramObservations?: ParamObservation[];

  /** 成员调用里出现过的 distinct 响应 bodyShape.kind(如 ['array','object'])。可选/向后兼容。 */
  responseShapeVariants?: Array<'array' | 'object' | 'scalar' | 'html' | 'unknown'>;

  /** 聚拢进该候选的全部成员 entry 的 requestId(debug/provenance)。可选/向后兼容。 */
  mergedRequestIds?: string[];

  /** 打分来源:'llm'=LLM 判定信号后 be 求和;缺省=规则启发式打分(LLM 无 key/失败时的兜底)。 */
  scoredBy?: 'llm';

  /** LLM 自报效用分(0-100,辅助,非权威 —— be 用双轨重算权威分)。be 合并 LLM 结果时附加。 */
  llmUtilityScore?: number;

  /** LLM 一句话:这个接口做什么/返回什么数据(给用户看)。be 合并 LLM 结果时附加;LLM-off 无。 */
  inferredFunction?: string;

  /** LLM 参数语义推断(角色/是否暴露,叠在 paramObservations 事实之上)。be 合并时附加;LLM-off 无。 */
  paramUnion?: ParamUnionItem[];
}

/** WebSocket 数据帧(仅 kind='cdp-websocket';opcode 1=text/2=binary,binary 的 preview 带 base64: 前缀) */
export interface WsFrame {
  direction: 'sent' | 'received';
  opcode: number;
  payloadPreview: string;
  payloadFullSize?: number;
  payloadTruncated?: boolean;
}

/** capture 样本里的单条网络条目(精简自 RecorderNetworkEntry,用于 UI 展示) */
export interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  host?: string;
  pathname?: string;

  /** 原始扩展条目类型:'cdp'=HTTP(Fetch/XHR)、'cdp-websocket'=WebSocket 连接 */
  kind?: 'cdp' | 'cdp-websocket';
  response?: {
    status?: number;
    mime?: string;
    bodyShape?: { kind?: string; itemKeys?: string[] };
  };

  /** 扁平响应状态(原始扩展形状;与 response.status 二选一) */
  responseStatus?: number;
  timing?: { startedAt?: number; durationMs?: number };

  /** WebSocket 数据帧序列(仅 kind='cdp-websocket') */
  webSocketFrames?: WsFrame[];

  /** 背压溢出丢弃的帧数 */
  webSocketFramesDropped?: number;
}

/** M-UI 用户操作事件(user-action 轨;input 仅含 valueShape,绝无原始值) */
export interface UserAction {
  type: 'click' | 'input' | 'submit' | 'keydown';
  selector: string;
  tag?: string;
  role?: string;
  text?: string;
  valueShape?: { len: number; kind: string };
  key?: string;
}

export interface CaptureSample {
  sampleName: 'A' | 'B';
  entries: NetworkEntry[];

  /** M-UI:本样本录到的用户操作(可选;旧后端/未启用时无) */
  actions?: UserAction[];

  /** 录制窗口溢出丢弃的操作数(ring-cap) */
  actionsDropped?: number;
}

/** /recorder/health 返回 */
export interface HealthReport {
  localService: 'ok' | 'down';
  daemon: 'ok' | 'down';
  extension: 'ok' | 'disconnected';
  highLevel: 'ok' | 'down';

  /** 已配置默认 LLM 时为 true；不可用时仍可继续本地排序与本地脚本生成。 */
  llmSynthesis?: boolean;

  /** LLM 配置状态的非阻断说明（不包含模型地址或凭据）。 */
  llmSynthesisMessage?: string;

  /** LLM 配置可用性原因码；不包含模型地址、凭据或内部异常。 */
  llmSynthesisReason?: string;
}

/** RecorderReport(bundle $defs/RecorderReport)—— init 预览/写入产出的报告 */
export interface RecorderReport {
  adapterPath: string;
  reportPath: string;
  warnings?: string[];

  /** ADR-0005 责任声明确认时刻(write 时由客户端写入) */
  responsibleUseAcknowledgedAt: number;

  /** 09 配置快照:发布通道 / 实验 profile / 快照版本(config 驱动的字符串/数值) */
  releaseChannel: string;
  localExperimentProfile: string;
  configSnapshotVersion: number;
}

/** dry-run diff 摘要(daemon /v1/init 响应 dryRun;契约无 unified-diff 字符串) */
export interface DryRunDiff {
  exists: boolean;
  changedLines: number | null;
}

/** init 结果(be /recorder/init 200 同步响应:report + dryRun)——取代旧扁平 AdapterDraft */
export interface InitResult {
  report: RecorderReport;
  dryRun: DryRunDiff;

  /** 渲染好的 adapter 源码(供 dry-run 审阅);LLM 合成时含生成的 func/columns,否则为空骨架。 */
  generatedSource?: string;

  /** P0-2:AI 合成可用但尚未外发(无 egress 同意)→ true,前端据此显示「用 AI 生成(将发送痕迹)」同意 CTA。 */
  llmSynthesisOffered?: boolean;
}

/** N4/N5 · LLM 流水线产出的脚本草稿(评分 + verify 后) */
export interface PipelineDraft {
  id: string;
  candidateId: string;
  site: string;
  name: string;
  source: string;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'rejected';
  reason: string;
  risks: string[];
  notes: string[];
  staticOk: boolean;
  staticViolations: string[];
  verify: { ok: boolean; rows: number; fieldCount: number; reasons: string[] };

  /** 静态通过 + verify 达标 → 可保存 */
  usable: boolean;

  /** 最近一次成功 verify 对应的精确源码摘要与时间；编辑源码后必须清空并重新测试。 */
  verifiedSourceHash?: string;
  verifiedAt?: number;

  /** 拆步流程:0700 草稿文件路径(第三步单草稿 verify 用)。仅静态通过**且写盘成功**的草稿有;
   *  静态未过 / 写盘失败 → undefined(前端据此禁用「测试」,与 be draft/verify 的 filePath guard 对齐)。 */
  filePath?: string;
}
export interface PipelinePrompts {
  /** 评分阶段发给 LLM 的完整提示词文本。 */
  score: string;

  /** 生成脚本阶段发给 LLM 的完整提示词文本(无 generate 候选时为空串)。 */
  generate: string;

  /** 随提示词外发的页面截图张数(图片本身不在文本里,仅标注数量)。 */
  screenshotCount: number;
}
export interface PipelineResult {
  drafts: PipelineDraft[];
  rejected: Array<{ candidateId: string; reason: string }>;

  /** 透明展示:本轮实际发给 LLM 的提示词(score + generate)+ 截图张数。 */
  prompts?: PipelinePrompts;
}
export interface SavedAdapter {
  draftId: string;
  site: string;
  name: string;
  adapterPath: string;
  reportPath?: string;
}

export interface SaveResult {
  state: string;

  /** 单条保存响应同时在顶层保留成功项字段；批量响应只使用 saved[]。 */
  draftId?: string;
  site?: string;
  name?: string;
  reportPath?: string;

  /** 批量保存:成功落盘的脚本列表(site/名/路径);单存时为单元素。 */
  saved?: SavedAdapter[];

  /** 批量保存:失败的草稿 + 原因(部分成功时返回)。 */
  failed?: Array<{ draftId: string; code: ErrorCode; reason: string }>;

  /** true 仅表示本次请求的全部项目都已发布；partial failure 保持 ranked。 */
  allSucceeded: boolean;

  /** 向后兼容:首个成功脚本的路径(单存调用方仍读它)。 */
  adapterPath?: string;
}

/** verify runner 事件(JSONL) */
export interface VerifyEvent {
  type: 'started' | 'progress' | 'result' | 'error';
  requestId: string;
  stage?: string;
  message?: string;
}

/**
 * verify 结果摘要(bundle $defs/VerifySummary)。
 * 安全设计(M7c redaction):仅返回脱敏后的 shape —— 行数 + 字段**数**(非列名,列名可能是 seed 值),
 * **不含原始行数据**、无 stdout/stderr、trace 仅保留 retained 标志;execute 阶段错误只留安全 code +
 * 固定文案。取代旧 VerifyResult(rows 数组)。
 */
export interface VerifySummary {
  ok: boolean;
  stage?: string;

  /** 命中行数(非行数据) */
  rows?: number;

  /** 产出行的字段数(非列名 —— Codex M7c:列名可能被 adapter 用 seed 值当 key) */
  fieldCount?: number;
  fixture?: { status: string };
  trace?: { retained: boolean };
  error?: { code: ErrorCode; message: string; hint?: string };
}
