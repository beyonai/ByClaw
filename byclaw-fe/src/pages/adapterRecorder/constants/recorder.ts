// 状态机常量、step 顺序、颜色映射 —— 对齐 05 State Machine + MASTER.md 图表语义
import type { SessionState, Confidence, ErrorCode } from '../types/recorder';

/** 8 步主流程(capture→rank→init→verify 链),用于 Steps 进度与 FlowGraph */
export const FLOW_STEPS: Array<{
  key: string;
  title: string;

  /** 进入该 step 前应处的状态 */
  enterState: SessionState;

  /** 完成后应到达的状态 */
  doneState: SessionState;
}> = [
  { key: 'health', title: '健康检查', enterState: 'idle', doneState: 'health_checked' },
  { key: 'bind', title: '绑定会话', enterState: 'health_checked', doneState: 'session_bound' },
  // 采集拆成 A、B 两个独立向导步骤(用户要求):先走完 A 录制(session_bound→capture_a),
  // 再进 B 录制(capture_a→capture_b)。点「开始录制」才新建标签页导航。
  { key: 'captureA', title: '录制 A', enterState: 'session_bound', doneState: 'capture_a' },
  { key: 'captureB', title: '录制 B', enterState: 'capture_a', doneState: 'capture_b' },
  { key: 'rank', title: '排序候选', enterState: 'capture_b', doneState: 'ranked' },
  // N5 verify-then-save:ranked 起 LLM 评分→多脚本→verify→保存(原 init/verify 两步合一)。
  { key: 'generate', title: '生成并保存', enterState: 'ranked', doneState: 'done' },
];

/**
 * LLM 路径的步骤栏:rank 已不再是用户手动步(候选提取自动跑、纯本地不外发),并入生成流程;
 * 且「生成并保存」拆成三子步(评分候选 → 生成脚本 → 测试保存),都停留后端 ranked 态,由前端 subStep 切换。
 * LLM-off 兜底仍用完整 FLOW_STEPS(手动选候选 + init/verify)。
 */
export function flowStepsFor(llmSynthesis: boolean | undefined): typeof FLOW_STEPS {
  if (!llmSynthesis) return FLOW_STEPS;
  const head = FLOW_STEPS.filter((s) => s.key !== 'rank' && s.key !== 'generate');
  // 三子步:enterState/doneState 都停在 ranked(仅用于 StepRail 展示,不驱动真实状态机)。
  const subSteps: typeof FLOW_STEPS = [
    { key: 'score', title: '评分候选', enterState: 'capture_b', doneState: 'ranked' },
    { key: 'genScripts', title: '生成脚本', enterState: 'ranked', doneState: 'ranked' },
    { key: 'testSave', title: '测试保存', enterState: 'ranked', doneState: 'done' },
  ];
  return [...head, ...subSteps];
}

/** 拆步流程子步 → StepRail 三子步在(LLM 路径)步骤栏里的相对偏移(相对三子步起点)。 */
export const PIPELINE_SUBSTEP_OFFSET: Record<'candidates' | 'generate' | 'scripts', number> = {
  candidates: 0,
  generate: 1,
  scripts: 2,
};

/** 状态在主流程中的序号(= 当前活动 step 索引,用于 StepRail current 计算);终态/分支态返回特殊值 */
export const STATE_ORDER: Record<SessionState, number> = {
  idle: 0,
  health_checked: 1,
  // 录制 A 步(索引2):session_bound 待录 A、page_ready A 录制窗口已开。
  // ⚠️ page_ready 在 A/B 两段都会出现(静态 map 无法区分),index.tsx 按 sampleA 是否存在把 B 段的
  // page_ready 调到录制 B 步(索引3)。这里按 A 段给 2。
  session_bound: 2,
  awaiting_user_login: 2,
  auth_confirmed: 2,
  page_ready: 2,
  capture_a: 3, // A 完成 → 录制 B 步(索引3)active
  capture_b: 4, // 采集完成 → 排序步(索引4)active
  ranked: 5, // 生成并保存步(索引5)active
  draft_created: 5,
  verifying: 5,
  done: 6, // 全完成(6 步,索引 0..5)
  failed: -1,
  cancelled: -1,
};

/** 终态判定 */
export const TERMINAL_STATES: SessionState[] = ['done', 'failed', 'cancelled'];
export const isTerminal = (s: SessionState) => TERMINAL_STATES.includes(s);
export const isFailed = (s: SessionState) => s === 'failed';

/**
 * 终止性错误码:收到即会话不可恢复,model 推进 failed(单一来源,勿在 model 内联重复)。
 * **必须与 be 实际对前端发的终态 ErrorCode 一致**——be 已把所有 lease-loss(页面/扩展/会话丢失,
 * 含 daemon 侧 command_result_unknown/extension_not_connected/profile_disconnected 等)统一归成
 * `page_lost`、daemon 不可达归 `daemon_unavailable`(见 be mapDaemonError / isLeaseLossCode)。故这里
 * 只列前端真会收到的终态码,不重复 be 的内部 daemon 码清单(那是 be 侧职责)。
 */
export const TERMINAL_ERROR_CODES: ErrorCode[] = ['page_lost', 'daemon_unavailable', 'verify_timeout'];
export const isTerminalError = (code: string): boolean => (TERMINAL_ERROR_CODES as string[]).includes(code);

// confidence → 主题 token 配色已下放到 CandidateCard(theme.useToken),不再在此硬编码 hex。
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: '高',
  medium: '中',
  low: '低',
  rejected: '已拒绝',
};

/** 状态机非法转移时的统一文案 */
export const INVALID_STATE_HINT = '当前会话状态不允许此操作,请按流程顺序推进。';
