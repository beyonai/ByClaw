const HIDDEN_TOOL_CARD_NAMES = new Set(["updatetaskplan"]);

/** Tool execution still runs; this only controls whether its lifecycle is projected to the UI. */
export function shouldEmitToolCard(toolName: unknown): boolean {
  const normalized = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
  return !HIDDEN_TOOL_CARD_NAMES.has(normalized);
}
