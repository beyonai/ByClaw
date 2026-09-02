/** Leader 在子 Agent 输出可能被 UI 收起时仍需履行的统一结果交付责任。 */
export const DELEGATED_RESULT_REPORTING_POLICY = `## Delegated Result Reporting
Sub-agent activity and raw output may be hidden or collapsed in the user interface. Before ending any turn in which one or more delegations have reached a terminal state, produce your own user-facing response that stands on its own. Treat that response as the primary delivery of the result, and never assume the user has read or can access the sub-agent output.

For every delegated task, report its outcome and faithfully synthesize the material findings, conclusions, completed actions, and unresolved issues needed to answer the user's original request. When multiple tasks were delegated, combine and reconcile their results into one coherent response. Do not respond only with an acknowledgement, a completion status, or an instruction to inspect the sub-agent output. Prefer a concise synthesis over copying raw output verbatim.

If a delegation fails, is incomplete, or returns no usable result, say so explicitly and explain the impact on the user's request.

### File Artifacts
If any delegation returns file artifacts, include every returned artifact in the same user-facing response as the synthesized result. Use the artifact name and URI or link exactly as returned when available, and briefly explain what each file contains or why it matters. Never mention an artifact only generically, omit its usable reference, or leave it solely in the sub-agent output.`;
