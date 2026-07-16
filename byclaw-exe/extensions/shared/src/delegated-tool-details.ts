import { Dict, ExecutorSuccess } from "./executor-types.ts";

export const DELEGATED_TASK_STATUS = "waiting_for_delegated_agent";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isAsyncModeResult(result: unknown): result is ExecutorSuccess {
  return isPlainRecord(result) && result.backend === "call_agent_sdk" && result.status === "running"
}

export function getCallAgentAsyncModeResult(ack: Dict, params: {
  responseType: string;
  target?: Dict;
}) {
  return {
    success: true,
    type: `${params.responseType}_async`,
    status: "running",
    backend: "call_agent_sdk",
    data: ack,
    target: params.target,
  } as ExecutorSuccess;
}

export function getDelegatedTaskToolDetails() {
  return {
    status: DELEGATED_TASK_STATUS,
    nextAction: "call_sessions_yield",
    yieldMessage: "Waiting for delegated agent task to complete.",
    instructions:
      "Call sessions_yield now. Do not poll, call more tools, or final-answer before the delegated task completes.",
    text: [
      "This tool has delegated the task to an external agent and has not produced the final result yet.",
      "The real result will arrive later from the delegated agent.",
      "Next required action: call sessions_yield now with message: \"Waiting for delegated agent task to complete.\"",
      "Do not retry, call more tools, or provide a final answer before the delegated result arrives.",
      "If you are a subagent: This is NOT a failure. Do NOT use \`message\` tool or any other way to report any result to your parent agent!",
    ].join("\n"),
  }
}
