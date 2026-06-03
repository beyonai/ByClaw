import type {
  AgentEventLike,
  TelemetryActiveEntry,
  TelemetryBusyActiveEntry,
  TelemetryBusyReasonDetails,
  TelemetryBusySnapshot,
  TelemetryConfig,
  TelemetryEntrySource,
} from "./types.js";

type NowFn = () => number;
type ActiveEntryMetadata = {
  label?: string;
  kind?: string;
};

export class TelemetryRuntimeState {
  private readonly activeRuns = new Map<string, TelemetryActiveEntry>();
  private readonly activeToolCalls = new Map<string, TelemetryActiveEntry>();
  private readonly activeSubagents = new Map<string, TelemetryActiveEntry>();
  private failures = 0;
  private lastEventAt?: number;
  private staleEntriesPruned = 0;

  constructor(
    private readonly config: TelemetryConfig,
    private readonly now: NowFn = () => Date.now(),
  ) {}

  markRunStarted(
    id: string | undefined,
    source: TelemetryEntrySource,
    metadata: ActiveEntryMetadata = {},
  ): void {
    this.upsert(this.activeRuns, stableKey("run", id), source, metadata);
  }

  markRunEnded(id: string | undefined, failed = false): void {
    this.remove(this.activeRuns, stableKey("run", id));
    if (failed) {
      this.failures += 1;
    }
  }

  markToolCallStarted(
    id: string | undefined,
    source: TelemetryEntrySource,
    metadata: ActiveEntryMetadata = {},
  ): void {
    this.upsert(this.activeToolCalls, stableKey("tool", id), source, metadata);
  }

  markToolCallEnded(id: string | undefined, failed = false): void {
    this.remove(this.activeToolCalls, stableKey("tool", id));
    if (failed) {
      this.failures += 1;
    }
  }

  markSubagentStarted(
    id: string | undefined,
    source: TelemetryEntrySource,
    metadata: ActiveEntryMetadata = {},
  ): void {
    this.upsert(this.activeSubagents, stableKey("subagent", id), source, metadata);
  }

  markSubagentEnded(id: string | undefined, failed = false): void {
    this.remove(this.activeSubagents, stableKey("subagent", id));
    if (failed) {
      this.failures += 1;
    }
  }

  recordAgentEvent(event: AgentEventLike): void {
    const eventTime = typeof event.ts === "number" && Number.isFinite(event.ts)
      ? event.ts
      : this.now();
    this.lastEventAt = eventTime;

    const runId = normalizeId(event.runId);
    const data = isRecord(event.data) ? event.data : {};
    const phase = normalizeId(data.phase);

    if (event.stream === "lifecycle") {
      if (phase === "start") {
        this.markRunStarted(runId, "agent_event", {
          label: firstNormalizedId(data.agentName, data.agentId, data.sessionKey, event.sessionKey),
        });
      } else if (phase === "end" || phase === "error") {
        this.markRunEnded(runId, phase === "error");
      }
      return;
    }

    if (event.stream === "error") {
      this.failures += 1;
      return;
    }

    if (event.stream === "item") {
      this.recordItemEvent(runId, data, phase);
      return;
    }

    if (event.stream === "tool") {
      this.recordToolEvent(runId, data, phase);
      return;
    }

    this.touchRun(runId);
  }

  snapshot(): TelemetryBusySnapshot {
    this.pruneStaleEntries();

    const generatedAtMs = this.now();
    const activeAgentRuns = this.activeRuns.size;
    const activeToolCalls = this.activeToolCalls.size;
    const activeSubagents = this.activeSubagents.size;
    const active = activeAgentRuns + activeToolCalls + activeSubagents;
    const busy = active > 0;
    const stopSafeAfter = busy
      ? undefined
      : new Date(generatedAtMs + this.config.idleGraceMs).toISOString();

    return {
      busy,
      confidence: "best_effort",
      generatedAt: new Date(generatedAtMs).toISOString(),
      stale: false,
      reason: buildReasons({ activeAgentRuns, activeToolCalls, activeSubagents }),
      reasonDetails: buildReasonDetails({
        activeRuns: this.activeRuns,
        activeToolCalls: this.activeToolCalls,
        activeSubagents: this.activeSubagents,
      }),
      lease: {
        recommendedAction: busy ? "extend" : "release_after_grace",
        extendForMs: busy ? this.config.activeLeaseMs : 0,
        idleGraceMs: this.config.idleGraceMs,
        ...(stopSafeAfter ? { stopSafeAfter } : {}),
        wakeRequired: false,
      },
      totals: {
        active,
        queued: 0,
        running: active,
        failures: this.failures,
        recentSessions: 0,
        presenceEntries: 0,
      },
      sources: {
        hooks: {
          available: true,
          activeAgentRuns,
          activeToolCalls,
          activeSubagents,
          ...(this.lastEventAt ? { lastEventAt: new Date(this.lastEventAt).toISOString() } : {}),
          staleEntriesPruned: this.staleEntriesPruned,
        },
      },
      limits: {
        maxAgeMs: this.config.maxAgeMs,
        snapshotTimeoutMs: 0,
        includesInteractiveRuns: true,
        includesHeartbeatRuns: true,
        includesGlobalTaskRegistry: false,
        containerLifecycleAware: false,
      },
    };
  }

  isBusy(): boolean {
    return this.activeRuns.size + this.activeToolCalls.size + this.activeSubagents.size > 0;
  }

  private recordItemEvent(
    runId: string | undefined,
    data: Record<string, unknown>,
    phase: string | undefined,
  ): void {
    const kind = normalizeId(data.kind);
    if (kind !== "tool" && kind !== "command") {
      this.touchRun(runId);
      return;
    }

    const itemId = normalizeId(data.toolCallId) ?? normalizeId(data.itemId);
    const itemKey = buildScopedWorkKey(runId, itemId);
    if (phase === "start") {
      this.markToolCallStarted(itemKey, "agent_event", {
        label: firstNormalizedId(data.toolName, data.name, data.title, itemId),
        kind,
      });
      return;
    }
    if (phase === "end" || phase === "result") {
      const status = normalizeId(data.status);
      this.markToolCallEnded(itemKey, status === "failed" || status === "blocked");
      return;
    }
    this.touchRun(runId);
  }

  private recordToolEvent(
    runId: string | undefined,
    data: Record<string, unknown>,
    phase: string | undefined,
  ): void {
    const toolCallId = normalizeId(data.toolCallId) ?? normalizeId(data.itemId);
    const itemKey = buildScopedWorkKey(runId, toolCallId);
    if (phase === "start") {
      this.markToolCallStarted(itemKey, "agent_event", {
        label: firstNormalizedId(data.toolName, data.name, data.title, toolCallId),
        kind: "tool",
      });
      return;
    }
    if (phase === "end" || phase === "result") {
      const status = normalizeId(data.status);
      this.markToolCallEnded(
        itemKey,
        data.isError === true || status === "failed" || status === "blocked",
      );
      return;
    }
    this.touchRun(runId);
  }

  private upsert(
    entries: Map<string, TelemetryActiveEntry>,
    id: string,
    source: TelemetryEntrySource,
    metadata: ActiveEntryMetadata,
  ): void {
    const timestamp = this.now();
    const existing = entries.get(id);
    this.lastEventAt = timestamp;
    if (!existing) {
      entries.set(id, {
        id,
        source,
        ...(metadata.label ? { label: metadata.label } : {}),
        ...(metadata.kind ? { kind: metadata.kind } : {}),
        startedAt: timestamp,
        lastSeenAt: timestamp,
      });
      return;
    }
    existing.lastSeenAt = timestamp;
    existing.source = source;
    if (metadata.label) {
      existing.label = metadata.label;
    }
    if (metadata.kind) {
      existing.kind = metadata.kind;
    }
  }

  private remove(entries: Map<string, TelemetryActiveEntry>, id: string): void {
    this.lastEventAt = this.now();
    entries.delete(id);
  }

  private touchRun(id: string | undefined): void {
    this.lastEventAt = this.now();
    const key = stableKey("run", id);
    const existing = this.activeRuns.get(key);
    if (existing) {
      existing.lastSeenAt = this.now();
    }
  }

  private pruneStaleEntries(): void {
    const pruned =
      pruneMap(this.activeRuns, this.config.activeRunMaxAgeMs, this.now()) +
      pruneMap(this.activeToolCalls, this.config.activeToolCallMaxAgeMs, this.now()) +
      pruneMap(this.activeSubagents, this.config.activeSubagentMaxAgeMs, this.now());
    if (pruned > 0) {
      this.staleEntriesPruned += pruned;
      this.lastEventAt = this.now();
    }
  }
}

export function buildScopedWorkKey(
  runId: string | undefined,
  itemId: string | undefined,
): string | undefined {
  const normalizedRunId = normalizeId(runId);
  const normalizedItemId = normalizeId(itemId);
  if (!normalizedItemId) {
    return normalizedRunId;
  }
  if (!normalizedRunId || normalizedItemId.startsWith(`${normalizedRunId}:`)) {
    return normalizedItemId;
  }
  return `${normalizedRunId}:${normalizedItemId}`;
}

function pruneMap(entries: Map<string, TelemetryActiveEntry>, maxAgeMs: number, now: number): number {
  let pruned = 0;
  for (const [id, entry] of entries.entries()) {
    if (now - entry.lastSeenAt > maxAgeMs) {
      entries.delete(id);
      pruned += 1;
    }
  }
  return pruned;
}

function buildReasons(params: {
  activeAgentRuns: number;
  activeToolCalls: number;
  activeSubagents: number;
}): string[] {
  const reason: string[] = [];
  if (params.activeAgentRuns > 0) {
    reason.push("active_agent_runs");
  }
  if (params.activeToolCalls > 0) {
    reason.push("active_tool_calls");
  }
  if (params.activeSubagents > 0) {
    reason.push("active_subagents");
  }
  if (reason.length === 0) {
    reason.push("idle");
  }
  return reason;
}

function buildReasonDetails(params: {
  activeRuns: Map<string, TelemetryActiveEntry>;
  activeToolCalls: Map<string, TelemetryActiveEntry>;
  activeSubagents: Map<string, TelemetryActiveEntry>;
}): TelemetryBusyReasonDetails {
  return {
    activeAgentRuns: summarizeEntries(params.activeRuns),
    activeToolCalls: summarizeEntries(params.activeToolCalls),
    activeSubagents: summarizeEntries(params.activeSubagents),
  };
}

function summarizeEntries(entries: Map<string, TelemetryActiveEntry>): TelemetryBusyActiveEntry[] {
  return Array.from(entries.values())
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => ({
      id: entry.id,
      source: entry.source,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.kind ? { kind: entry.kind } : {}),
      startedAt: new Date(entry.startedAt).toISOString(),
      lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
    }));
}

function stableKey(prefix: string, id: string | undefined): string {
  return `${prefix}:${normalizeId(id) ?? "unknown"}`;
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function firstNormalizedId(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeId(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
