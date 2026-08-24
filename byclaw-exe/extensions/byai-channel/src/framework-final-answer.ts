/**
 * Framework finalAnswer ledger for one SDK business request.
 *
 * The SDK display stream contains reasoning, child-agent output and intermediate
 * root runs. A by-framework result must instead describe the terminal business
 * answer, so the ledger keeps root runs isolated until the completion gate closes.
 */
export interface RootRunFinalAnswerRecord {
  runId: string;
  streamAnswer: string;
  agentEndAnswer?: string;
  agentEndSuccess?: boolean;
  lifecyclePhase?: "end" | "error";
  overflowFragment: boolean;
}

export interface FrameworkFinalAnswerLedger {
  runs: Map<string, RootRunFinalAnswerRecord>;
}

export type FrameworkFinalAnswerTerminalOutcome = "success" | "failure" | "none";

function normalizeRunId(runId: string | undefined): string {
  return runId?.trim() ?? "";
}

function ensureRun(
  ledger: FrameworkFinalAnswerLedger,
  runId: string | undefined,
): RootRunFinalAnswerRecord | undefined {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) {
    return undefined;
  }
  let record = ledger.runs.get(normalizedRunId);
  if (!record) {
    record = {
      runId: normalizedRunId,
      streamAnswer: "",
      overflowFragment: false,
    };
    ledger.runs.set(normalizedRunId, record);
  }
  return record;
}

export function createFrameworkFinalAnswerLedger(): FrameworkFinalAnswerLedger {
  return { runs: new Map<string, RootRunFinalAnswerRecord>() };
}

export function recordRootRunStarted(
  ledger: FrameworkFinalAnswerLedger,
  runId: string | undefined,
): void {
  ensureRun(ledger, runId);
}

export function recordRootRunStreamAnswer(
  ledger: FrameworkFinalAnswerLedger,
  runId: string | undefined,
  answer: string,
): void {
  const record = ensureRun(ledger, runId);
  if (record) {
    // This is the current final assistant segment, not the whole run transcript.
    record.streamAnswer = answer;
  }
}

export function recordRootRunLifecycleTerminal(
  ledger: FrameworkFinalAnswerLedger,
  runId: string | undefined,
  phase: "end" | "error",
): void {
  const record = ensureRun(ledger, runId);
  if (record) {
    record.lifecyclePhase = phase;
  }
}

export function recordRootRunAgentEnd(
  ledger: FrameworkFinalAnswerLedger,
  params: {
    runId: string | undefined;
    success: boolean;
    messages: unknown[];
  },
): void {
  const record = ensureRun(ledger, params.runId);
  if (!record) {
    return;
  }
  record.agentEndSuccess = params.success;
  const answer = extractLastAssistantText(params.messages);
  if (answer !== undefined) {
    record.agentEndAnswer = answer;
  }
}

export function markRootRunOverflowFragment(
  ledger: FrameworkFinalAnswerLedger,
  runId: string | undefined,
): void {
  const record = ensureRun(ledger, runId);
  if (record) {
    record.overflowFragment = true;
  }
}

function textFromAssistantContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() === "NO_REPLY" ? "" : content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      continue;
    }
    const value = block as Record<string, unknown>;
    const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
    // Only visible text blocks are answer material. Thinking and tool blocks are excluded.
    if (type && type !== "text" && type !== "output_text") {
      continue;
    }
    if (typeof value.text === "string") {
      parts.push(value.text);
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  const text = parts.join("");
  return text.trim() === "NO_REPLY" ? "" : text;
}

export function extractLastAssistantText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }
    const value = message as Record<string, unknown>;
    if (value.role !== "assistant") {
      continue;
    }
    return textFromAssistantContent(value.content);
  }
  return undefined;
}

function isSuccessfulTerminalRun(record: RootRunFinalAnswerRecord): boolean {
  return record.agentEndSuccess ?? record.lifecyclePhase === "end";
}

function answerForRun(record: RootRunFinalAnswerRecord): string {
  const answer = record.agentEndAnswer ?? record.streamAnswer;
  return answer.trim() === "NO_REPLY" ? "" : answer;
}

function findTerminalRun(
  ledger: FrameworkFinalAnswerLedger,
): { record: RootRunFinalAnswerRecord; index: number } | undefined {
  const runs = [...ledger.runs.values()];
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const record = runs[index]!;
    if (record.agentEndSuccess !== undefined || record.lifecyclePhase !== undefined) {
      return { record, index };
    }
  }
  return undefined;
}

export function resolveFrameworkFinalAnswerTerminalOutcome(
  ledger: FrameworkFinalAnswerLedger,
): FrameworkFinalAnswerTerminalOutcome {
  const terminal = findTerminalRun(ledger);
  if (!terminal) {
    return "none";
  }
  return isSuccessfulTerminalRun(terminal.record) ? "success" : "failure";
}

/**
 * Resolve the business result after all completion gates have closed.
 * Normal multi-run sessions return only the last successful root run. When that
 * run continues an overflow-truncated answer, only the contiguous overflow chain
 * is concatenated; earlier business runs remain excluded.
 */
export function resolveFrameworkFinalAnswer(ledger: FrameworkFinalAnswerLedger): string {
  const runs = [...ledger.runs.values()];
  const terminal = findTerminalRun(ledger);
  if (!terminal || !isSuccessfulTerminalRun(terminal.record)) {
    return "";
  }
  const terminalIndex = terminal.index;

  let chainStart = terminalIndex;
  for (let index = terminalIndex - 1; index >= 0; index -= 1) {
    if (!runs[index]!.overflowFragment) {
      break;
    }
    chainStart = index;
  }
  return runs
    .slice(chainStart, terminalIndex + 1)
    .map(answerForRun)
    .join("");
}
