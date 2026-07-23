/* eslint-disable indent, lines-around-comment */
// 录制会话状态机 model(@umijs/max model)。
// 持有 SessionState + stateVersion,每个动作按 05 State Machine 校验当前态,
// 非法转移返回 invalid_state(不调用后端),错误态走 failed。
import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal } from 'antd';
import { getRecorderClient, type RecordingMode } from '../services/recorderClient';
import { INVALID_STATE_HINT, isTerminalError } from '../constants/recorder';
import { deriveAdapterName } from './adapterName';
import { selectCandidateData } from './candidateSelection';
import { isActionAllowed, type RecorderAction } from './transitions';
import type {
  CaptureSample,
  HealthReport,
  InitResult,
  PipelineDraft,
  PipelinePrompts,
  RankCandidate,
  RecorderError,
  RequestEnvelope,
  SaveResult,
  SavedAdapter,
  SessionState,
  VerifySummary,
} from '../types/recorder';

interface SessionData {
  sessionId?: string;
  health?: HealthReport;
  targetUrl?: string;

  /** 产品录制形态(bind 时定):tab_projection(投屏,默认)/ embedded_iframe(页内嵌 iframe)/ vnc(容器 noVNC)。驱动 CaptureStep 渲染分支。 */
  recordingMode?: RecordingMode;

  /** vnc 模式:容器 noVNC 画面 URL(bind 返回);驱动 CaptureStep 的 VncFrame iframe src。 */
  vncUrl?: string;

  /** 当前正在录制的样本(captureStart 成功后置位、captureRead 成功后清空);驱动「开始/结束」按钮态 */
  recording?: 'A' | 'B' | null;
  sampleA?: CaptureSample;
  sampleB?: CaptureSample;

  /** A/B 各自声明的搜索关键词(评分识别 seed→param;结束录制时随 captureRead 下发,be 只存 HMAC 证据)。 */
  seedA?: string;
  seedB?: string;
  candidates?: RankCandidate[];

  /** rank 阶段真正发给 LLM 的评分提示词(透明展示:转场页 + 候选表回看;LLM-off 时 undefined)。 */
  rankScorePrompt?: string;
  selectedCandidateId?: string;

  /** 从选定候选派生并固化的 adapter 名(site/command);init 预览/写入与 verify 复用同一个 */
  adapterName?: string;

  /** dry-run 预览结果(不推进会话) */
  draftPreview?: InitResult;

  /** 用户明确同意候选元数据外发进行 LLM 评分的时刻。 */
  llmEgressAck?: number;

  /** N4/N5:LLM 流水线产出的脚本草稿(verify 后)+ 被拒候选 */
  pipelineDrafts?: PipelineDraft[];
  pipelineRejected?: Array<{ candidateId: string; reason: string }>;

  /** 透明展示:本轮实际发给 LLM 的提示词(score + generate)+ 截图张数 */
  pipelinePrompts?: PipelinePrompts;

  /** 会被喂 LLM 的候选 id(预览时拉取;候选表格据此标「是否传 LLM」) */
  pipelineSentIds?: string[];

  /** pipeline 异步轮询途中的阶段进度(score/generate/verify 耗时),驱动进度展示。 */
  pipelineProgress?: Array<{ stage: string; status: 'running' | 'done'; durationMs?: number; detail?: string }>;

  /** 拆步流程子步:candidates(评分候选)→ generate(生成脚本)→ scripts(测试保存)。默认 candidates。 */
  pipelineSubStep?: 'candidates' | 'generate' | 'scripts';

  /** 拆步①score 阶段回的 generate 提示词(第②步生成页折叠展示,点生成前先看)。 */
  generatePrompt?: string;

  /** 拆步①score 阶段 LLM 返回的原始 interfaces JSON(评分候选页折叠展示原始返回)。 */
  llmRawJson?: string;
  llmError?: string;

  /** 拆步③每个草稿的「测试中」标记(draftId → 是否 verify 进行中),驱动测试按钮 loading。 */
  draftVerifying?: Record<string, boolean>;

  /** 拆步③已保存的草稿 id 集合(单存后标记,停留本页可继续存其他)。 */
  savedDraftIds?: string[];

  /** 保存成功后的 adapter 路径(单存兼容字段) */
  savedAdapterPath?: string;

  /** 多选保存成功后的脚本列表(site/名/路径),驱动结果列表展示 */
  savedAdapters?: SavedAdapter[];

  /** write 写入结果(推进 ranked→draft_created) */
  draft?: InitResult;
  verifyResult?: VerifySummary;
}

type DraftVerificationResult = {
  draftId: string;
  verify: PipelineDraft['verify'];
  usable: boolean;
  verifiedSourceHash?: string;
  verifiedAt?: number;
};

/** 编辑源码会使最近一次 verify 证明立即失效，避免 UI 继续把旧源码标成可保存。 */
export function applyDraftSourceEdit(draft: PipelineDraft, source: string): PipelineDraft {
  return {
    ...draft,
    source,
    usable: false,
    verifiedSourceHash: undefined,
    verifiedAt: undefined,
  };
}

/** 只把终态结果绑定到实际送检的源码。 */
export function mergeDraftVerification(
  draft: PipelineDraft,
  verifiedSource: string,
  result: DraftVerificationResult
): PipelineDraft {
  return {
    ...draft,
    source: verifiedSource,
    verify: result.verify,
    usable: result.usable,
    verifiedSourceHash: result.verifiedSourceHash,
    verifiedAt: result.verifiedAt,
  };
}

/** 保存状态只认后端 saved[]，不能因请求发出就把失败项目标成已保存。 */
export function mergeSaveResult(
  savedDraftIds: string[],
  savedAdapters: SavedAdapter[],
  result: SaveResult
): Pick<SessionData, 'savedDraftIds' | 'savedAdapters' | 'savedAdapterPath'> {
  const adapterByDraft = new Map(savedAdapters.map((item) => [item.draftId, item]));
  for (const item of result.saved ?? []) adapterByDraft.set(item.draftId, item);
  const mergedAdapters = [...adapterByDraft.values()];
  return {
    savedDraftIds: [...new Set([...savedDraftIds, ...(result.saved ?? []).map((item) => item.draftId)])],
    savedAdapters: mergedAdapters,
    savedAdapterPath: result.adapterPath ?? result.saved?.[0]?.adapterPath ?? mergedAdapters[0]?.adapterPath,
  };
}

export interface OverwriteSaveOutcome {
  response: RequestEnvelope<SaveResult>;
  cancelled: boolean;
}

/** daemon/BE 可用错误 envelope 或批量 failed[] 表示冲突，两种形态都统一识别。 */
function isAdapterExists(response: RequestEnvelope<SaveResult>): boolean {
  return (
    response.error?.code === 'adapter_exists' ||
    Boolean(response.data?.failed?.some((failure) => failure.code === 'adapter_exists'))
  );
}

/**
 * 覆盖保护的唯一入口：第一次固定不覆盖；只有用户明确确认后，才以完全相同的草稿和已验证源码重试。
 * cancelled 单独返回，避免调用方把用户取消误记为保存成功或展示成系统错误。
 */
export async function saveWithOverwriteConfirmation(
  save: (overwrite: boolean) => Promise<RequestEnvelope<SaveResult>>,
  confirmOverwrite: () => Promise<boolean>
): Promise<OverwriteSaveOutcome> {
  const first = await save(false);
  if (!isAdapterExists(first)) return { response: first, cancelled: false };
  if (!(await confirmOverwrite())) return { response: first, cancelled: true };
  return { response: await save(true), cancelled: false };
}

function confirmAdapterOverwrite(): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: 'CLI 脚本已存在',
      content: '是否覆盖当前用户沙箱中同名的 CLI 脚本？',
      okText: '覆盖保存',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export default function useRecorderSession() {
  const [state, setState] = useState<SessionState>('idle');
  const [stateVersion, setStateVersion] = useState(0);
  const [data, setData] = useState<SessionData>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RecorderError | null>(null);
  const client = useMemo(() => getRecorderClient(), []);

  // patch 支持静态对象或函数式((最新 data)=>Partial)——后者用于依赖旧值的回写(单草稿 verify/save 交错并发时
  // 避免闭包快照互相覆盖)。
  type PatchArg = Partial<SessionData> | ((d: SessionData) => Partial<SessionData>);
  const advance = useCallback((next: SessionState, patch?: PatchArg) => {
    setState(next);
    setStateVersion((v) => v + 1);
    if (patch) setData((d) => ({ ...d, ...(typeof patch === 'function' ? patch(d) : patch) }));
  }, []);

  /** 统一动作执行:校验当前态 → 调后端 → 成功推进 / 失败转 failed */
  const run = useCallback(
    async <T>(
      action: RecorderAction,
      call: () => Promise<RequestEnvelope<T>>,
      onSuccess: (data: T) => { next: SessionState; patch?: PatchArg },
      fromStateOverride?: SessionState
    ) => {
      // 串联动作(如 startCaptureA = navigate→captureStart)串两步时,setState 异步、闭包 state 仍是旧值,
      // 故允许显式传入第二步的校验起点;默认用当前 state。
      if (!isActionAllowed(action, fromStateOverride ?? state)) {
        setError({ code: 'invalid_state', message: '非法状态转移', hint: INVALID_STATE_HINT });
        return false;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await call();
        if (!res.ok || res.data === null) {
          setError(res.error ?? { code: 'network_error', message: '未知错误' });
          // 终止性错误(page_lost 等租约丢失 / daemon 不可达)→ 会话终止为 failed(05 规则)。
          // 终态码清单是单一来源 isTerminalError(../constants/recorder),与 be 实际终态码契约对齐。
          if (res.error && isTerminalError(res.error.code)) {
            advance('failed');
          }
          return false;
        }
        const { next, patch } = onSuccess(res.data);
        advance(next, patch);
        return true;
      } catch (e) {
        setError({ code: 'network_error', message: e instanceof Error ? e.message : '请求异常' });
        return false;
      } finally {
        setLoading(false);
      }
    },
    [state, advance]
  );

  // 生成脚本页:按选中候选取 generate 提示词预览(不调 LLM、不改状态、不动 loading)。
  // **稳定引用**(useCallback):PipelineStep 的 effect 依赖它,inline 每次新引用会导致 setData→render→effect
  // 重复请求死循环(codex High)。**seq guard**:用户快速改选中 → 旧 preview 晚返回不覆盖新的(codex High)。
  const previewSeq = useRef(0);
  const previewGeneratePrompt = useCallback(
    async (candidateIds?: string[]) => {
      const seq = ++previewSeq.current;
      try {
        const res = await client.pipelinePreview(candidateIds);
        if (seq !== previewSeq.current) return; // 有更新的请求已发起 → 丢弃本次(防乱序覆盖)
        if (res.ok && res.data) {
          const gen = res.data.prompts.generate;
          setData((d) => (d.generatePrompt === gen ? d : { ...d, generatePrompt: gen })); // 相等不 setState(防无谓 render)
        }
      } catch {
        /* 预览失败不阻断生成(生成时 be 仍按选中过滤) */
      }
    },
    [client]
  );

  const actions = {
    health: () =>
      run(
        'health',
        () => client.health(),
        (d) => ({ next: 'health_checked', patch: { health: d } })
      ),
    // 新建录制会话:仅绑定浏览器 + 保存目标 URL,**不导航、不开 tab**(开 tab 推迟到「开始录制」)。
    // 若目标站点需要登录,用户在「开始录制」后打开的 byCLI 标签页内自行完成登录(Recorder 只绑定已有登录)。
    bind: (url: string, recordingMode?: RecordingMode) =>
      run(
        'bind',
        () => client.bind('existing', url, recordingMode),
        (d) => ({
          next: 'session_bound',
          patch: {
            sessionId: d.sessionId,
            targetUrl: url,
            recording: null,
            recordingMode: d.recordingMode ?? recordingMode ?? 'vnc',
            vncUrl: d.vncUrl,
          },
        })
      ),
    navigate: (url: string) =>
      run(
        'navigate',
        () => client.navigate(url),
        (d) => ({ next: 'page_ready', patch: { targetUrl: d.url || url } })
      ),
    // 「开始/结束」两步录制(治旧的 arm 完立刻 read 抓 0 条):
    // 开始 = navigate 新建 byCLI 标签页(A=页面 a / B=页面 b)→ captureStart 开窗;用户在该页操作。
    // 结束 = captureRead 读窗冻结,产出样本 list。captureStart 后状态留在 page_ready、置 recording 标记。
    startCaptureA: async () => {
      const url = data.targetUrl;
      if (!url) {
        setError({
          code: 'validation_failed',
          message: '缺少目标 URL,请返回上一步重新绑定会话',
          hint: INVALID_STATE_HINT,
        });
        return false;
      }
      // 从 session_bound 导航开页面 a(默认校验起点即当前 session_bound)。
      // 注:**不要用 navigate 返回的 d.url 覆盖 targetUrl** —— 新建 owned tab 落在 about:blank,
      // 返回的 d.url=about:blank 会污染 targetUrl,导致 B 录制 navigate 到 about:blank 被扩展拒(Blocked URL scheme)。
      const nav = await run(
        'navigate',
        () => client.navigate(url),
        () => ({ next: 'page_ready', patch: {} })
      );
      if (!nav) return false;
      return run(
        'captureStart',
        () => client.captureStart('A'),
        () => ({ next: 'page_ready', patch: { recording: 'A' } }),
        'page_ready'
      );
    },
    stopCaptureA: () =>
      run(
        'captureA',
        () => client.captureRead('A', data.seedA),
        (d) => ({ next: 'capture_a', patch: { sampleA: d, recording: null } })
      ),
    startCaptureB: async () => {
      const url = data.targetUrl;
      if (!url) {
        setError({
          code: 'validation_failed',
          message: '缺少目标 URL,请返回上一步重新绑定会话',
          hint: INVALID_STATE_HINT,
        });
        return false;
      }
      // 从 capture_a 重新导航开全新页面 b(navigate 已放开 capture_a 来源态)。同上:不覆盖 targetUrl。
      const nav = await run(
        'navigate',
        () => client.navigate(url),
        () => ({ next: 'page_ready', patch: {} }),
        'capture_a'
      );
      if (!nav) return false;
      return run(
        'captureStart',
        () => client.captureStart('B'),
        () => ({ next: 'page_ready', patch: { recording: 'B' } }),
        'page_ready'
      );
    },
    stopCaptureB: () =>
      run(
        'captureB',
        () => client.captureRead('B', data.seedB),
        (d) => ({ next: 'capture_b', patch: { sampleB: d, recording: null } })
      ),

    /** 设置 A/B 样本的搜索关键词(CaptureStep 输入框驱动;仅前端态,结束录制时随 captureRead 下发)。 */
    setSeed: (sample: 'A' | 'B', seed: string) =>
      setData((d) => (sample === 'A' ? { ...d, seedA: seed } : { ...d, seedB: seed })),
    rank: () =>
      run(
        'rank',
        () => client.rank(),
        (d) => ({
          next: 'ranked',
          patch: { candidates: d.candidates, rankScorePrompt: d.scorePrompt, pipelineSubStep: 'candidates' },
        })
      ),
    // 选定候选时即派生并固化 adapter 名(init 预览/写入与 verify 复用同一个,避免漂移)。
    selectCandidate: (id: string) => setData((d) => selectCandidateData(d, id, deriveAdapterName)),
    // dry-run 预览:不推进会话,产出 {report,dryRun} 供用户审阅。
    // egressConsent=true 时(用户点「用 AI 生成」)才带 egress 同意戳 → be 才会把痕迹发模型合成(P0-2);
    // 一旦同意即记入 session,后续重复预览/写入复用,无需再问。
    previewInit: (egressConsent?: boolean) => {
      const id = data.selectedCandidateId;
      const name = data.adapterName;
      if (!id || !name) {
        setError({ code: 'validation_failed', message: '请先选择一个候选', hint: INVALID_STATE_HINT });
        return Promise.resolve(false);
      }
      const egressAck = egressConsent ? Date.now() : data.llmEgressAck;
      return run(
        'previewInit',
        () => client.init(name, id, 'dry-run', undefined, egressAck),
        (d) => ({ next: 'ranked', patch: { draftPreview: d, ...(egressAck ? { llmEgressAck: egressAck } : {}) } })
      );
    },
    // 确认写入:带 ADR-0005 责任声明确认,推进 ranked→draft_created。复用已记的 egress 同意(若有)。
    writeInit: () => {
      const id = data.selectedCandidateId;
      const name = data.adapterName;
      if (!id || !name) {
        setError({ code: 'validation_failed', message: '请先选择一个候选', hint: INVALID_STATE_HINT });
        return Promise.resolve(false);
      }
      return run(
        'writeInit',
        () => client.init(name, id, 'write', Date.now(), data.llmEgressAck),
        (d) => ({ next: 'draft_created', patch: { draft: d } })
      );
    },
    // 拆步①评分:score-only。进 ranked 后自动触发(或用户重跑)。回候选(含 LLM 语义)+ 双提示词。不推进,停 candidates 子步。
    runScore: (candidateIds?: string[], llmSynthesis = true) => {
      const llmEgressAcknowledgedAt = llmSynthesis ? Date.now() : undefined;
      setData((d) => ({ ...d, pipelineProgress: [] }));
      return run(
        'pipelineScore',
        () =>
          client.pipelineScore(
            llmEgressAcknowledgedAt,
            candidateIds,
            (phases) => setData((d) => ({ ...d, pipelineProgress: phases })),
            (partial) =>
              setData((d) => ({
                ...d,
                pipelinePrompts: {
                  score: partial.score ?? d.pipelinePrompts?.score ?? '',
                  generate: partial.generate ?? d.pipelinePrompts?.generate ?? '',
                  screenshotCount: partial.screenshotCount ?? d.pipelinePrompts?.screenshotCount ?? 0,
                },
              }))
          ),
        (d) => ({
          next: 'ranked',
          patch: {
            candidates: d.candidates,
            pipelineRejected: d.rejected,
            pipelineSentIds: d.sentCandidateIds,
            pipelinePrompts: { score: d.scorePrompt, generate: d.generatePrompt, screenshotCount: d.screenshotCount },
            generatePrompt: d.generatePrompt,
            llmRawJson: d.llmRawJson,
            llmError: d.llmError,
            llmEgressAck: llmEgressAcknowledgedAt,
            pipelineSubStep: 'candidates',
          },
        })
      );
    },
    // 候选页「下一步」→ 进生成子步(纯前端切页,不调 be)。
    goToGenerate: () => setData((d) => ({ ...d, pipelineSubStep: 'generate', pipelineProgress: undefined })),
    // 候选页「上一步」/生成页返回 → 回候选子步。
    goToCandidates: () => setData((d) => ({ ...d, pipelineSubStep: 'candidates' })),
    // 拆步②生成:generate-only。点「生成 cli 脚本」触发。完成后自动进 scripts 子步展示脚本。
    runGenerate: (candidateIds?: string[]) => {
      setData((d) => ({ ...d, pipelineProgress: [] }));
      return run(
        'pipelineGenerate',
        () =>
          client.pipelineGenerate(undefined, candidateIds, (phases) =>
            setData((d) => ({ ...d, pipelineProgress: phases }))
          ),
        // 重新生成:清上一轮的草稿测试/保存痕迹(savedDraftIds/savedAdapters/draftVerifying),避免残留展示。
        (d) => ({
          next: 'ranked',
          patch: {
            pipelineDrafts: d.drafts,
            savedDraftIds: [],
            savedAdapters: [],
            draftVerifying: {},
            pipelineSubStep: 'scripts',
          },
        })
      );
    },
    // 拆步③单草稿测试:draftId 真 verify。回写该草稿 verify/usable(不推进、不切页)。draftVerifying 驱动按钮 loading。
    // patch 用函数式(基于最新 data)——测试与保存可交错并发,闭包快照回写会互相覆盖。
    verifyDraft: (draftId: string, currentSource?: string) => {
      const sourceToVerify = currentSource ?? data.pipelineDrafts?.find((draft) => draft.id === draftId)?.source;
      setData((d) => ({
        ...d,
        pipelineDrafts:
          sourceToVerify === undefined
            ? d.pipelineDrafts
            : d.pipelineDrafts?.map((draft) => {
                if (draft.id === draftId) return applyDraftSourceEdit(draft, sourceToVerify);
                return draft;
              }),
        draftVerifying: { ...d.draftVerifying, [draftId]: true },
      }));
      return run(
        'draftVerify',
        () => client.draftVerify(draftId, sourceToVerify),
        (d) => ({
          next: 'ranked',
          patch: (cur: SessionData) => ({
            pipelineDrafts: (cur.pipelineDrafts ?? []).map((dr) =>
              dr.id === d.draftId && (sourceToVerify === undefined || dr.source === sourceToVerify)
                ? mergeDraftVerification(dr, sourceToVerify ?? dr.source, d)
                : dr
            ),
            draftVerifying: { ...cur.draftVerifying, [d.draftId]: false },
          }),
        })
      ).then((okFlag) => {
        if (!okFlag) setData((d) => ({ ...d, draftVerifying: { ...d.draftVerifying, [draftId]: false } }));
        return okFlag;
      });
    },
    // 外发前预览将发送的提示词(不调 LLM、不外发、不改状态);存进 pipelinePrompts 供面板展示。
    previewPrompts: () =>
      run(
        'pipelinePreview',
        () => client.pipelinePreview(),
        (d) => ({ next: 'ranked', patch: { pipelinePrompts: d.prompts, pipelineSentIds: d.sentCandidateIds } })
      ),
    // 生成脚本页:按选中候选取 generate 提示词预览(稳定引用 + seq guard,定义见上方 previewGeneratePrompt)。
    previewGeneratePrompt,
    // 拆步③单草稿保存:首次固定 overwrite=false；仅遇到 adapter_exists 且用户确认后才用同一源码重试。
    // savedDraftIds 只表示本次会话成功过，不能据此跳过后续文件存在检查。
    saveDraft: async (draftId: string, source?: string) => {
      if (!isActionAllowed('saveAdapter', state)) {
        setError({ code: 'invalid_state', message: '非法状态转移', hint: INVALID_STATE_HINT });
        return false;
      }
      setLoading(true);
      setError(null);
      try {
        const outcome = await saveWithOverwriteConfirmation(
          (overwrite) => client.saveAdapter(draftId, source, overwrite),
          confirmAdapterOverwrite
        );
        if (outcome.cancelled) return false;

        const res = outcome.response;
        if (!res.ok || res.data === null) {
          setError(res.error ?? { code: 'network_error', message: '未知错误' });
          if (res.error && isTerminalError(res.error.code)) advance('failed');
          return false;
        }

        const failure = res.data.failed?.[0];
        if (!res.data.allSucceeded && failure) setError({ code: failure.code, message: failure.reason });
        advance('ranked', (cur: SessionData) => ({
          ...mergeSaveResult(cur.savedDraftIds ?? [], cur.savedAdapters ?? [], res.data as SaveResult),
          pipelineSubStep: 'scripts',
        }));
        return res.data.allSucceeded;
      } catch (e) {
        setError({ code: 'network_error', message: e instanceof Error ? e.message : '请求异常' });
        return false;
      } finally {
        setLoading(false);
      }
    },
    verify: () => {
      const name = data.adapterName;
      if (!name) {
        setError({ code: 'validation_failed', message: 'adapter 名缺失,请重新选择候选', hint: INVALID_STATE_HINT });
        return Promise.resolve(false);
      }
      return run(
        'verify',
        () => client.verify(name),
        (d) => ({ next: 'done', patch: { verifyResult: d } })
      );
    },
    reset: () => {
      setState('idle');
      setStateVersion(0);
      setData({});
      setError(null);
      setLoading(false);
    },
  };

  return { state, stateVersion, data, loading, error, actions };
}
