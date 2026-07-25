/* eslint-disable indent, lines-around-comment */
// byclaw Java backend transport.
// Browser-visible endpoints are /byaiService/recorder/*, while the UI keeps the recorder envelope unchanged.
import type {
  CaptureSample,
  ErrorCode,
  HealthReport,
  InitResult,
  NetworkEntry,
  PipelineDraft,
  PipelineResult,
  PipelinePrompts,
  RankCandidate,
  RequestEnvelope,
  SaveResult,
  VerifySummary,
} from '../types/recorder';
import type {
  BindMode,
  BindResult,
  PipelineScoreResult,
  RankResult,
  RecorderBootstrap,
  RecorderClient,
  RecordingMode,
  SessionAdvanceResult,
  WritePolicy,
} from './recorderClient';

/**
 * be /recorder/capture/read 透传 daemon 原始抓包条目(非契约 RecorderNetworkEntry,见 #8 BE↔契约 gap),
 * 这里仅做 transport→UI 展示映射(rank 在服务端做,展示丢失字段不影响链路)。
 */
function mapRawEntry(e: Record<string, unknown>): NetworkEntry {
  const url = typeof e.url === 'string' ? e.url : '';
  let host: string | undefined;
  let pathname: string | undefined;
  try {
    const u = new URL(url);
    host = u.host;
    pathname = u.pathname;
  } catch {
    /* 非绝对 URL 时跳过 */
  }
  const status =
    typeof e.responseStatus === 'number' ? e.responseStatus : typeof e.status === 'number' ? e.status : undefined;
  const mime =
    typeof e.responseContentType === 'string'
      ? e.responseContentType
      : typeof e.contentType === 'string'
      ? e.contentType
      : undefined;
  return {
    requestId: typeof e.requestId === 'string' ? e.requestId : '',
    method: typeof e.method === 'string' ? e.method : 'GET',
    url,
    host,
    pathname,
    response: status !== undefined || mime !== undefined ? { status, mime } : undefined,
    timing: {
      startedAt: typeof e.startedAt === 'number' ? e.startedAt : undefined,
      durationMs: typeof e.durationMs === 'number' ? e.durationMs : undefined,
    },
  };
}

interface RequestStatus<T = unknown> {
  requestId: string;
  type: 'analyze' | 'init' | 'verify' | 'capture' | 'rank' | 'pipeline';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  startedAt: number;
  updatedAt: number;
  expiresAt?: number | null;
  pollAfterMs?: number | null;
  result?: T | null;
  error?: RequestEnvelope['error'];

  /** pipeline 阶段进度(score/generate/verify…),轮询时实时更新。 */
  progress?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;

  /** 阶段性结果(pipeline 分阶段提示词):score 完先出 generate prompt,让分析过渡页按阶段展示提示词。 */
  partialResult?: { prompts?: { score?: string; generate?: string; screenshotCount?: number } };
}

/** pipeline 阶段进度回调类型(对外导出供 client 签名复用)。 */
export type ProgressPhase = { stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string };

/** pipeline 阶段性 prompt(be 分阶段写:score 先出、score 完出 generate),供分析过渡页实时展示。 */
export type PartialPrompts = { score?: string; generate?: string; screenshotCount?: number };

/** mode → 契约枚举(03/05 章 SessionBindRequest.mode) */
const BIND_MODE_MAP: Record<BindMode, string> = {
  existing: 'bind_existing_page',
  await_login: 'create_page_await_user_login',
};

const POLL_FALLBACK_MS = 1000;
// 双阈值超时(Codex 裁定):固定总 deadline 会把长 pipeline(rank+score+generate ~224s)误报超时。
// 改成:只要后端 progress/updatedAt 在推进就重置 idle 计时;连续 IDLE 无进展才判超时;ABSOLUTE 兜底防永不结束。
// score 阶段是**单次长 LLM 调用**(候选分批 + 每批经 Cloudflare 120s/批 + 重试),be 端一次跑完才回结果,
// 期间 request 的 progress/updatedAt/status 都不推进 → 旧 150s idle 会把正常的长评分误报成"长时间无进展"
// pipeline_timeout(真机 25 候选实测:单批 LLM 往返 230s)。idle 提到 10min 覆盖最慢分批;绝对上限同步抬到
// 20min 防被 idle 反超(否则 15min 绝对会先于 10min idle 触发,idle 形同虚设)。
const POLL_IDLE_TIMEOUT_MS = 600_000; // 连续 10min 无任何进展(progress/updatedAt/status 都不变)才超时
const POLL_ABSOLUTE_TIMEOUT_MS = 1_200_000; // 20min 总兜底,无条件超时

let seq = 0;
const clientRequestId = () => `cli_${Date.now().toString(36)}_${(++seq).toString(36)}`;
export const DEFAULT_RECORDER_API_ROOT = '/byaiService/recorder';

export function buildRecorderEndpoint(apiRoot: string | undefined, path: string): string {
  const root = (apiRoot || DEFAULT_RECORDER_API_ROOT).replace(/\/$/, '');
  const endpoint = path.startsWith('/recorder/') ? path.slice('/recorder'.length) : path;
  return `${root}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

function envelopeError(code: ErrorCode, message: string): RequestEnvelope<never> {
  return { ok: false, schemaVersion: 'recorder.v1', requestId: '', data: null, error: { code, message } };
}

function isRecorderEnvelope(value: unknown): value is RequestEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = value as Record<string, unknown>;
  if (
    typeof envelope.ok !== 'boolean' ||
    envelope.schemaVersion !== 'recorder.v1' ||
    typeof envelope.requestId !== 'string' ||
    !('data' in envelope) ||
    !('error' in envelope)
  ) {
    return false;
  }
  return (
    typeof envelope.error === 'object' &&
    envelope.error !== null &&
    typeof (envelope.error as Record<string, unknown>).code === 'string' &&
    typeof (envelope.error as Record<string, unknown>).message === 'string'
  );
}

type RawSaveResult = Omit<SaveResult, 'allSucceeded'> & { allSucceeded?: boolean };

/** 单存成功没有 allSucceeded；统一补 true，并从首个成功项派生旧 UI 使用的 adapterPath。 */
function normalizeSaveResult(result: RequestEnvelope<RawSaveResult>): RequestEnvelope<SaveResult> {
  if (!result.ok || result.data === null) return result as RequestEnvelope<SaveResult>;
  const hasSavedItem = Boolean(result.data.draftId) || Boolean(result.data.saved?.length);
  return {
    ...result,
    data: {
      ...result.data,
      adapterPath: result.data.adapterPath ?? result.data.saved?.[0]?.adapterPath,
      allSucceeded: result.data.allSucceeded ?? (hasSavedItem && !(result.data.failed?.length ?? 0)),
    },
  };
}

export function createHttpRecorderClient(bootstrap: RecorderBootstrap): RecorderClient {
  const apiRoot = bootstrap.baseUrl || DEFAULT_RECORDER_API_ROOT;
  // RecorderClient 接口不暴露 sessionId;真实 be 每个 body 要求 sessionId,
  // 故在 client 内部持有 bind 返回的 sessionId,后续 side-effect 自动注入。bind 失败/reset 前为 null。
  let sessionId: string | null = null;

  /** 统一请求:注入 04 门禁 header,返回解析后的 envelope(网络异常映射为 network_error) */
  async function call<T>(
    path: string,
    opts: { method?: 'GET' | 'POST'; body?: unknown; idempotent?: boolean } = {}
  ): Promise<RequestEnvelope<T>> {
    const method = opts.method ?? 'POST';
    const headers: Record<string, string> = {
      'X-Byclaw-Recorder': '1',
    };
    if (bootstrap.token) headers['X-Byclaw-Recorder-Token'] = bootstrap.token;
    if (bootstrap.csrfToken) headers['X-CSRF-Token'] = bootstrap.csrfToken;
    // side-effect POST 带幂等键(03 章 Idempotency)
    if (method === 'POST' && opts.idempotent !== false) headers['Idempotency-Key'] = clientRequestId();

    // 自动注入 sessionId:真实 be 每个 side-effect body required sessionId(OpenAPI),
    // 而 RecorderClient 接口不暴露它 → bind 后由 client 持有并补入(已显式给的不覆盖)。
    const body =
      method === 'POST' && sessionId && typeof opts.body === 'object' && opts.body !== null
        ? { sessionId, ...(opts.body as Record<string, unknown>) }
        : opts.body;

    try {
      const { GET, POST } = await import('@/service/common/request');
      const requestConfig = {
        headers,
        languageConf: false,
        responseCfg: {
          customHandle: true,
          hideErrorTips: true,
        },
      };
      const url = buildRecorderEndpoint(apiRoot, path);
      const json =
        method === 'GET'
          ? await GET<RequestEnvelope<T>>(url, {}, requestConfig)
          : await POST<RequestEnvelope<T>>(url, body ?? {}, requestConfig);
      return json;
    } catch (e) {
      const responseData = (e as { response?: { data?: unknown } } | null)?.response?.data;
      if (isRecorderEnvelope(responseData)) return responseData as RequestEnvelope<T>;
      return envelopeError('network_error', e instanceof Error ? e.message : '请求失败') as RequestEnvelope<T>;
    }
  }

  /**
   * 202 异步轮询(03 章):init/verify 返回 requestId 后,轮询 GET /recorder/requests/{id}
   * 至 terminal,再把 result/error 还原成 RequestEnvelope<T>,对上层抹平同步/异步差异。
   */
  async function poll<T>(
    requestId: string,
    onProgress?: (phases: ProgressPhase[]) => void,
    onPartial?: (prompts: PartialPrompts) => void
  ): Promise<RequestEnvelope<T>> {
    const start = Date.now();
    let idleDeadline = start + POLL_IDLE_TIMEOUT_MS;
    const absoluteDeadline = start + POLL_ABSOLUTE_TIMEOUT_MS;
    // 进展指纹:后端 updatedAt / progress 阶段数 / status / 各阶段 stage+status+detail 任一变化即视为"有进展",重置 idle 计时。
    let lastFingerprint = '';
    // partialResult 去重指纹:be 每轮都回同一份 prompts,只在内容变化时才回调上层(避免重复 setState)。
    let lastPartialFp = '';
    const fingerprintOf = (st: RequestStatus<T>): string => {
      const phases = (st.progress ?? [])
        .map((p) => `${p.stage}:${p.status}:${p.detail ?? ''}:${p.durationMs ?? ''}`)
        .join('|');
      return `${(st as { updatedAt?: unknown }).updatedAt ?? ''}#${st.status}#${(st.progress ?? []).length}#${phases}`;
    };
    while (Date.now() < absoluteDeadline && Date.now() < idleDeadline) {
      const res = await call<RequestStatus<T>>(`/recorder/requests/${encodeURIComponent(requestId)}`, {
        method: 'GET',
      });
      // 状态查询本身失败(如 404 request_not_found)直接透传
      if (!res.ok || res.data === null) return res as unknown as RequestEnvelope<T>;
      const st = res.data as unknown as RequestStatus<T>;
      if (onProgress && st.progress) onProgress(st.progress);
      // 阶段性 prompt:be 在 score/generate 阶段就绪时写 partialResult.prompts,变化即回调上层实时展示(不必等终态)。
      if (onPartial && st.partialResult?.prompts) {
        const p = st.partialResult.prompts;
        const fp = `${p.score ?? ''}#${p.generate ?? ''}#${p.screenshotCount ?? ''}`;
        if (fp !== lastPartialFp) {
          lastPartialFp = fp;
          onPartial(p);
        }
      }
      // 有进展 → 重置 idle deadline(只要后端在推进阶段就不算超时;真卡死才靠 idle/absolute 兜底)。
      const fp = fingerprintOf(st);
      if (fp !== lastFingerprint) {
        lastFingerprint = fp;
        idleDeadline = Date.now() + POLL_IDLE_TIMEOUT_MS;
      }
      if (st.status === 'succeeded') {
        return { ok: true, schemaVersion: 'recorder.v1', requestId, data: (st.result ?? null) as T, error: null };
      }
      if (st.status === 'failed' || st.status === 'timeout' || st.status === 'cancelled') {
        return {
          ok: false,
          schemaVersion: 'recorder.v1',
          requestId,
          data: null,
          error: st.error ?? { code: 'adapter_runtime_error', message: `请求 ${st.status}` },
        };
      }
      await new Promise((r) => {
        setTimeout(r, st.pollAfterMs ?? POLL_FALLBACK_MS);
      });
    }
    // 区分 idle 卡死 vs 绝对上限;错误码用 pipeline_timeout(不再复用误导性的 verify_timeout)。
    const reason = Date.now() >= absoluteDeadline ? '总时长超过上限' : '长时间无进展';
    return envelopeError('pipeline_timeout', `轮询超时(${reason})`) as RequestEnvelope<T>;
  }

  /** 发起 202 异步请求并轮询到最终结果(onProgress:轮询途中实时回调阶段进度;onPartial:阶段性 prompt 回调,用于 pipeline 展示)。 */
  async function callAsync<T>(
    path: string,
    body: unknown,
    onProgress?: (phases: ProgressPhase[]) => void,
    onPartial?: (prompts: PartialPrompts) => void
  ): Promise<RequestEnvelope<T>> {
    const accepted = await call<unknown>(path, { body });
    if (!accepted.ok || !accepted.requestId) return accepted as RequestEnvelope<T>;
    return poll<T>(accepted.requestId, onProgress, onPartial);
  }

  return {
    health: () => call<HealthReport>('/recorder/health', { method: 'GET' }),
    bind: async (mode: BindMode, url?: string, recordingMode?: RecordingMode) => {
      // 不硬编码 contextId:'default'(真扩展常注册在生成的 profile id,如 'xhz62x7b';写死 'default'
      // → daemon profile_disconnected,真扩展实测踩过)。不传 → be 留空 → daemon 单连接回退路由到
      // 唯一连着的扩展。多 profile 选择是后续 UI 工作(届时显式传 contextId)。
      // url:await_login 模式带目标 URL → be 立刻开 byCLI tab 跳该 URL 供用户登录。
      // recordingMode:当前主路径显式传 vnc;保留其它模式用于后续兼容。
      const res = await call<BindResult>('/recorder/session/bind', {
        body: { mode: BIND_MODE_MAP[mode], ...(url ? { url } : {}), ...(recordingMode ? { recordingMode } : {}) },
      });
      // 捕获 sessionId 供后续 side-effect 自动注入(bind 是会话起点)
      if (res.ok && res.data?.sessionId) sessionId = res.data.sessionId;
      return res;
    },
    confirmAuth: () => call<SessionAdvanceResult>('/recorder/session/confirm-auth', { body: {} }),
    navigate: (url: string) => call<{ url: string }>('/recorder/navigate', { body: { url } }),
    // 契约 CaptureStartRequest required: [sessionId, sampleName, trigger]。UI 即手动触发 → user_manual。
    captureStart: (sample) =>
      call<SessionAdvanceResult & { sampleName: 'A' | 'B'; started: boolean }>('/recorder/capture/start', {
        body: { sampleName: sample, trigger: 'user_manual' },
      }),
    captureRead: async (sample, seed) => {
      const res = await call<{
        sampleName?: 'A' | 'B';
        entries?: unknown[];
        actions?: unknown[];
        actionsDropped?: number;
      }>('/recorder/capture/read', { body: { sampleName: sample, ...(seed ? { seed } : {}) } });
      if (!res.ok || res.data === null) return res as unknown as RequestEnvelope<CaptureSample>;
      const raw = Array.isArray(res.data.entries) ? (res.data.entries as Record<string, unknown>[]) : [];
      const actions = Array.isArray(res.data.actions) ? (res.data.actions as CaptureSample['actions']) : undefined;
      return {
        ...res,
        data: {
          sampleName: sample,
          entries: raw.map(mapRawEntry),
          ...(actions && actions.length ? { actions } : {}),
          ...(typeof res.data.actionsDropped === 'number' ? { actionsDropped: res.data.actionsDropped } : {}),
        },
      };
    },
    screenshot: (quality?: number) =>
      call<{ format: string; data: string }>('/recorder/screenshot', {
        body: quality !== undefined ? { quality } : {},
      }),
    sendInput: (cdpMethod: string, cdpParams: Record<string, unknown>) =>
      call<{ dispatched: boolean }>('/recorder/input', { body: { cdpMethod, cdpParams } }),
    rank: async () => {
      // rank 仅返回本地规则排序的候选；实际 LLM 评分提示词由 pipeline/score 返回。
      const res = await call<{ candidates?: RankCandidate[] }>('/recorder/rank', { body: {} });
      if (!res.ok || res.data === null) return res as unknown as RequestEnvelope<RankResult>;
      const candidates = Array.isArray(res.data.candidates) ? res.data.candidates : [];
      return { ...res, data: { candidates } };
    },
    // be /recorder/init 是同步 200,直接回 InitResult{report,dryRun}(不建 request、非 202 轮询)。
    init: (
      name: string,
      selectedCandidateId: string,
      writePolicy: WritePolicy,
      responsibleUseAcknowledgedAt?: number,
      llmEgressAcknowledgedAt?: number
    ) => {
      const body: Record<string, unknown> = { name, selectedCandidateId, writePolicy };
      if (responsibleUseAcknowledgedAt !== undefined) body.responsibleUseAcknowledgedAt = responsibleUseAcknowledgedAt;
      if (llmEgressAcknowledgedAt !== undefined) body.llmEgressAcknowledgedAt = llmEgressAcknowledgedAt;
      return call<InitResult>('/recorder/init', { body });
    },
    // verify 是 202 异步:内部轮询 GET /recorder/requests/{id} 至 terminal 得 VerifySummary。
    verify: (name: string) => callAsync<VerifySummary>('/recorder/verify', { name }),
    // N5:pipeline 改 202 异步(score~90s+generate+verify 耗时长);callAsync 轮询到终态,onProgress 实时回阶段耗时,onPartial 分阶段回 prompt。
    pipeline: (
      llmEgressAcknowledgedAt: number | undefined,
      candidateIds?: string[],
      onProgress?: (phases: ProgressPhase[]) => void,
      onPartial?: (prompts: PartialPrompts) => void
    ) =>
      callAsync<PipelineResult>(
        '/recorder/pipeline',
        {
          ...(llmEgressAcknowledgedAt !== undefined ? { llmEgressAcknowledgedAt } : {}),
          ...(candidateIds?.length ? { candidateIds } : {}),
        },
        onProgress,
        onPartial
      ),
    pipelinePreview: (candidateIds?: string[]) =>
      call<{ prompts: PipelinePrompts; sentCandidateIds: string[] }>('/recorder/pipeline/preview', {
        body: candidateIds && candidateIds.length ? { candidateIds } : {},
      }),
    // 拆步①评分:score-only,202 异步。回候选(含 LLM 语义)+ 双提示词 + 送 LLM 候选 id。
    pipelineScore: (
      llmEgressAcknowledgedAt: number | undefined,
      candidateIds?: string[],
      onProgress?: (phases: ProgressPhase[]) => void,
      onPartial?: (prompts: PartialPrompts) => void
    ) =>
      callAsync<PipelineScoreResult>(
        '/recorder/pipeline/score',
        {
          ...(llmEgressAcknowledgedAt !== undefined ? { llmEgressAcknowledgedAt } : {}),
          ...(candidateIds?.length ? { candidateIds } : {}),
        },
        onProgress,
        onPartial
      ),
    // 拆步②生成:generate-only,202 异步。读 be 存的 genCands 生成脚本+静态检查+写草稿(不 verify)。
    pipelineGenerate: (
      llmEgressAcknowledgedAt: number | undefined,
      candidateIds?: string[],
      onProgress?: (phases: ProgressPhase[]) => void
    ) =>
      callAsync<{ drafts: PipelineDraft[] }>(
        '/recorder/pipeline/generate',
        {
          ...(llmEgressAcknowledgedAt !== undefined ? { llmEgressAcknowledgedAt } : {}),
          ...(candidateIds && candidateIds.length ? { candidateIds } : {}),
        },
        onProgress
      ),
    // 拆步③单草稿测试:draftId 真 verify,202 异步。回 verify 结果 + usable。
    draftVerify: (draftId: string, source?: string) =>
      callAsync<{
        draftId: string;
        verify: PipelineDraft['verify'];
        usable: boolean;
        verifiedSourceHash?: string;
        verifiedAt?: number;
      }>('/recorder/draft/verify', {
        draftId,
        ...(source !== undefined ? { source } : {}),
      }),
    saveAdapter: async (draftId: string, source?: string, overwrite = false) => {
      const body: Record<string, unknown> = { draftId, overwrite };
      if (source !== undefined) body.source = source;
      return normalizeSaveResult(await call<RawSaveResult>('/recorder/save', { body }));
    },
    saveAdapters: async (drafts: Array<{ draftId: string; source?: string; overwrite?: boolean }>) =>
      normalizeSaveResult(
        await call<RawSaveResult>('/recorder/save', {
          body: { drafts: drafts.map((draft) => ({ ...draft, overwrite: draft.overwrite ?? false })) },
        })
      ),
    cancel: async () => {
      const res = await call<{ cancelled: boolean }>('/recorder/cancel', {
        body: { scope: 'session' },
        idempotent: false,
      });
      sessionId = null; // 会话结束,清空持有的 sessionId
      return res;
    },
  };
}
