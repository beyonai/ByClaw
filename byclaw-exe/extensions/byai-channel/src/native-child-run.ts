import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { scheduleActiveSdkCompletionCheck } from "./sdk-session-completion.js";
import {
  markActiveSdkNativeChildRunTerminal,
  type NativeChildRunTerminalSource,
} from "./session-context.js";

/**
 * native subagent 终态的唯一上报入口。四个通道顺序不可控，因此登记、日志、完成检查调度
 * 都收在这里：调用方只负责把自己看到的 (childRunId, source) 交上来，去重与状态迁移由台账
 * 决定。分散在各 hook 里各写一遍，就会重新长出「谁先到谁的语义不同」的顺序依赖。
 */
export function reportNativeChildRunTerminal(
  api: OpenClawPluginApi,
  params: {
    childRunId: string | undefined;
    childSessionKey?: string;
    source: NativeChildRunTerminalSource;
  },
): void {
  const outcome = markActiveSdkNativeChildRunTerminal({
    childRunId: params.childRunId,
    childSessionKey: params.childSessionKey,
    source: params.source,
  });
  if (!outcome) {
    return;
  }
  if (!outcome.transitioned) {
    api.logger.debug?.(
      `[byai-channel] native child run terminal deduped: source=${params.source} childRunId=${params.childRunId ?? ""} requester=${outcome.request.sessionKey}`,
    );
    return;
  }
  api.logger.info(
    `[byai-channel] native child run terminal: source=${params.source} childRunId=${params.childRunId ?? ""} requester=${outcome.request.sessionKey} child=${outcome.childSessionKey} allChildRunsTerminal=${String(outcome.allChildRunsTerminal)} awaitingFollowup=${String(outcome.awaitingFollowupArmed)} rootLifecyclePhase=${outcome.request.rootLifecyclePhase ?? ""}`,
  );
  scheduleActiveSdkCompletionCheck(
    api,
    outcome.request.sessionKey,
    `native_child_run_terminal_${params.source}`,
  );
}
