
export const DELEGATED_TASK_STATUS = "waiting_for_delegated_agent";

export function getDelegatedTaskToolDetails() {
  return {
    status: DELEGATED_TASK_STATUS,
    nextAction: "call_sessions_yield",
    yieldMessage: "Waiting for delegated agent task to complete.",
    instructions:
      "Call sessions_yield now. Do not poll, call more tools, or final-answer before the delegated task completes.",
    text: [
      "Delegated work has been started and is still running in another agent.",
      "              Next required action: call sessions_yield now with a short message such as:",
      "              \"Waiting for delegated agent task to complete.\"",
      "              Do not call subagents, do not poll for status, do not call more tools, and do not provide a final answer yet. The session will resume automatically when the delegated agent returns its completion event.",
    ].join("\n"),
  }
}
