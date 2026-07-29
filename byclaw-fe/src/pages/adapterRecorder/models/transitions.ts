// model 动作的状态门禁(05 State Machine 的前端镜像)。抽成纯模块以便单测 + 单一来源。
// 注:be 侧 stateMachine 是**权威**门禁,前端这层是 UX 守卫(非法转移就地提示,不发请求)。
import type { SessionState } from '../types/recorder';

/** model 动作 → 允许触发的来源态。 */
export const ALLOWED_FROM = {
  health: ['idle', 'health_checked'],
  bind: ['health_checked'],
  confirmAuth: ['awaiting_user_login'],
  // 「开始录制」才导航开 byCLI tab:A 从 session_bound 开页面 a;B 从 capture_a 重新开页面 b。
  navigate: ['session_bound', 'auth_confirmed', 'page_ready', 'capture_a'],
  // 「开始/结束」两步录制:开始=navigate→page_ready 后 captureStart(开窗);
  // 结束=captureRead 读窗冻结。A、B 都先导航回 page_ready 再开窗,故读窗均自 page_ready。
  captureStart: ['page_ready'],
  captureA: ['page_ready'],
  captureB: ['page_ready'],
  rank: ['capture_b'],
  // init 拆两动作:dry-run 预览(不推进)与 write 写入(推进 ranked→draft_created),均自 ranked。
  previewInit: ['ranked'],
  writeInit: ['ranked'],
  // N4/N5 verify-then-save:pipeline 自 ranked 不推进(产草稿);saveAdapter 自 ranked 保存后停留 ranked(可继续存)。
  pipeline: ['ranked'],
  // 拆步流程(评分→生成→测试):三动作均自 ranked、均不推进状态(前端 subStep 控制三页)。
  pipelineScore: ['ranked'],
  pipelineGenerate: ['ranked'],
  draftVerify: ['ranked'],
  // 外发前预览提示词:自 ranked,不外发不推进。
  pipelinePreview: ['ranked'],
  saveAdapter: ['ranked'],
  verify: ['draft_created'],
} satisfies Record<string, SessionState[]>;

export type RecorderAction = keyof typeof ALLOWED_FROM;

/** 当前态能否触发该动作(model run() 的状态门禁)。 */
export const isActionAllowed = (action: RecorderAction, state: SessionState): boolean =>
  (ALLOWED_FROM[action] as SessionState[]).includes(state);
