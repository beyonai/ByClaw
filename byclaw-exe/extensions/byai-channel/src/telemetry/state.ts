import type {
  AgentEventLike,
  TelemetryActiveEntry,
  TelemetryBusyActiveEntry,
  TelemetryBusyReasonDetails,
  TelemetryBusySnapshot,
  TelemetryConfig,
  TelemetryEntrySource,
  TelemetryReasonState,
  TelemetryStructuredReason,
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
  private readonly activeHolds = new Map<string, TelemetryActiveEntry>();
  private readonly activeOutboundDeliveries = new Map<string, TelemetryActiveEntry>();
  private failures = 0;
  private lastEventAt?: number;
  private lastPrunedAt?: number;
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

  markHoldStarted(
    id: string | undefined,
    source: TelemetryEntrySource,
    metadata: ActiveEntryMetadata = {},
  ): void {
    this.upsert(this.activeHolds, stableKey("hold", id), source, metadata);
  }

  markHoldEnded(id: string | undefined, failed = false): void {
    this.remove(this.activeHolds, stableKey("hold", id));
    if (failed) {
      this.failures += 1;
    }
  }

  markOutboundDeliveryStarted(
    id: string | undefined,
    source: TelemetryEntrySource,
    metadata: ActiveEntryMetadata = {},
  ): void {
    this.upsert(this.activeOutboundDeliveries, stableKey("delivery", id), source, metadata);
  }

  markOutboundDeliveryEnded(id: string | undefined, failed = false): void {
    this.remove(this.activeOutboundDeliveries, stableKey("delivery", id));
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

    if (event.stream === "approval") {
      this.recordApprovalEvent(runId, data, phase);
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
    const activeHolds = this.activeHolds.size;
    const activeOutboundDeliveries = this.activeOutboundDeliveries.size;
    const activeWork = activeAgentRuns + activeToolCalls + activeSubagents;
    const hold = activeHolds > 0;
    const draining = activeOutboundDeliveries > 0;
    const wakeRequired = false;
    const stale = this.isRecentlyStale(generatedAtMs);
    const releaseable = activeWork === 0 && !hold && !draining && !wakeRequired && !stale;
    const active = activeWork + activeHolds + activeOutboundDeliveries;
    const stopSafeAfter = releaseable
      ? new Date(generatedAtMs + this.config.idleGraceMs).toISOString()
      : undefined;
    const recommendedAction = activeWork > 0 ? "extend" : releaseable ? "release_after_grace" : "hold";
    const extendForMs = activeWork > 0
      ? this.config.activeLeaseMs
      : releaseable
        ? 0
        : this.config.cautiousLeaseMs;

    return {
      busy: !releaseable,
      confidence: "best_effort",
      generatedAt: new Date(generatedAtMs).toISOString(),
      stale,
      reason: buildReasons({
        activeAgentRuns,
        activeToolCalls,
        activeSubagents,
        activeHolds,
        activeOutboundDeliveries,
        stale,
      }),
      reasonDetails: buildReasonDetails({
        activeRuns: this.activeRuns,
        activeToolCalls: this.activeToolCalls,
        activeSubagents: this.activeSubagents,
        activeHolds: this.activeHolds,
        activeOutboundDeliveries: this.activeOutboundDeliveries,
      }),
      state: {
        busy: activeWork > 0,
        hold,
        draining,
        wakeRequired,
        releaseable,
        stale,
      },
      authority: {
        scope: "plugin_observed_with_ttl",
        confidence: "best_effort",
        sources: ["plugin_hooks", "agent_event_subscription", "outbound_delivery_hooks"],
        missingSignals: [
          "session_lane_snapshot",
          "global_lane_snapshot",
          "delivery_queue_snapshot",
          "heartbeat_wake_snapshot",
        ],
      },
      reasons: buildStructuredReasons({
        activeRuns: this.activeRuns,
        activeToolCalls: this.activeToolCalls,
        activeSubagents: this.activeSubagents,
        activeHolds: this.activeHolds,
        activeOutboundDeliveries: this.activeOutboundDeliveries,
        config: this.config,
      }),
      lease: {
        recommendedAction,
        extendForMs,
        idleGraceMs: this.config.idleGraceMs,
        ...(stopSafeAfter ? { stopSafeAfter } : {}),
        wakeRequired,
        reason: resolveLeaseReason({
          busy: activeWork > 0,
          hold,
          draining,
          wakeRequired,
          stale,
        }),
      },
      totals: {
        active,
        queued: 0,
        running: activeWork,
        hold: activeHolds,
        draining: activeOutboundDeliveries,
        wakeRequired: 0,
        stale: stale ? this.staleEntriesPruned : 0,
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
          activeHolds,
          activeOutboundDeliveries,
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
        includesQueueDepth: false,
        includesDeliveryQueue: false,
        includesOutboundDeliveryDraining: true,
        containerLifecycleAware: false,
      },
    };
  }

  isBusy(): boolean {
    return (
      this.activeRuns.size +
      this.activeToolCalls.size +
      this.activeSubagents.size +
      this.activeHolds.size +
      this.activeOutboundDeliveries.size > 0 ||
      this.isRecentlyStale(this.now())
    );
  }

  private isRecentlyStale(now: number): boolean {
    return this.lastPrunedAt !== undefined && now - this.lastPrunedAt <= this.config.cautiousLeaseMs;
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

  private recordApprovalEvent(
    runId: string | undefined,
    data: Record<string, unknown>,
    phase: string | undefined,
  ): void {
    const status = normalizeId(data.status);
    const kind = normalizeId(data.kind);
    const approvalId =
      normalizeId(data.approvalId) ??
      normalizeId(data.id) ??
      normalizeId(data.approvalSlug);
    const itemKey = buildScopedWorkKey(runId, approvalId);
    if (isApprovalPending(phase, status, kind)) {
      this.markHoldStarted(itemKey, "agent_event", {
        label: firstNormalizedId(data.approvalKind, kind, approvalId, runId),
        kind: "approval",
      });
      return;
    }
    if (isApprovalTerminal(phase, status, kind)) {
      this.markHoldEnded(
        itemKey,
        status === "failed" || status === "expired" || status === "denied",
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
    const now = this.now();
    const pruned =
      pruneMap(this.activeRuns, this.config.activeRunMaxAgeMs, now) +
      pruneMap(this.activeToolCalls, this.config.activeToolCallMaxAgeMs, now) +
      pruneMap(this.activeSubagents, this.config.activeSubagentMaxAgeMs, now) +
      pruneMap(this.activeHolds, this.config.maxAgeMs, now) +
      pruneMap(this.activeOutboundDeliveries, this.config.idleGraceMs, now);
    if (pruned > 0) {
      this.staleEntriesPruned += pruned;
      this.lastPrunedAt = now;
      this.lastEventAt = now;
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
  activeHolds: number;
  activeOutboundDeliveries: number;
  stale: boolean;
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
  if (params.activeHolds > 0) {
    reason.push("active_holds");
  }
  if (params.activeOutboundDeliveries > 0) {
    reason.push("outbound_delivery_draining");
  }
  if (params.stale) {
    reason.push("recent_stale_prune");
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
  activeHolds: Map<string, TelemetryActiveEntry>;
  activeOutboundDeliveries: Map<string, TelemetryActiveEntry>;
}): TelemetryBusyReasonDetails {
  return {
    activeAgentRuns: summarizeEntries(params.activeRuns),
    activeToolCalls: summarizeEntries(params.activeToolCalls),
    activeSubagents: summarizeEntries(params.activeSubagents),
    activeHolds: summarizeEntries(params.activeHolds),
    activeOutboundDeliveries: summarizeEntries(params.activeOutboundDeliveries),
  };
}

function buildStructuredReasons(params: {
  activeRuns: Map<string, TelemetryActiveEntry>;
  activeToolCalls: Map<string, TelemetryActiveEntry>;
  activeSubagents: Map<string, TelemetryActiveEntry>;
  activeHolds: Map<string, TelemetryActiveEntry>;
  activeOutboundDeliveries: Map<string, TelemetryActiveEntry>;
  config: TelemetryConfig;
}): TelemetryStructuredReason[] {
  return [
    ...summarizeStructuredReasons(params.activeRuns, {
      kind: "agent_run",
      status: "running",
      state: "busy",
      ttlMs: params.config.activeRunMaxAgeMs,
    }),
    ...summarizeStructuredReasons(params.activeToolCalls, {
      kind: "tool_call",
      status: "running",
      state: "busy",
      ttlMs: params.config.activeToolCallMaxAgeMs,
    }),
    ...summarizeStructuredReasons(params.activeSubagents, {
      kind: "subagent_run",
      status: "running",
      state: "busy",
      ttlMs: params.config.activeSubagentMaxAgeMs,
    }),
    ...summarizeStructuredReasons(params.activeHolds, {
      kind: "approval_hold",
      status: "waiting",
      state: "hold",
      ttlMs: params.config.maxAgeMs,
    }),
    ...summarizeStructuredReasons(params.activeOutboundDeliveries, {
      kind: "outbound_delivery",
      status: "draining",
      state: "draining",
      ttlMs: params.config.idleGraceMs,
    }),
  ].sort((left, right) => left.id.localeCompare(right.id));
}

function summarizeStructuredReasons(
  entries: Map<string, TelemetryActiveEntry>,
  metadata: {
    kind: string;
    status: string;
    state: TelemetryReasonState;
    ttlMs: number;
  },
): TelemetryStructuredReason[] {
  return Array.from(entries.values()).map((entry) => ({
    id: entry.id,
    kind: metadata.kind,
    status: metadata.status,
    state: metadata.state,
    source: entry.source,
    ...(entry.label ? { label: entry.label } : {}),
    firstSeenAt: new Date(entry.startedAt).toISOString(),
    lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
    expiresAt: new Date(entry.lastSeenAt + metadata.ttlMs).toISOString(),
    confidence: "best_effort",
  }));
}

function resolveLeaseReason(params: {
  busy: boolean;
  hold: boolean;
  draining: boolean;
  wakeRequired: boolean;
  stale: boolean;
}): string {
  if (params.busy) {
    return "active_work";
  }
  if (params.hold) {
    return "hold";
  }
  if (params.draining) {
    return "draining";
  }
  if (params.wakeRequired) {
    return "wake_required";
  }
  if (params.stale) {
    return "recent_stale_prune";
  }
  return "idle";
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

function isApprovalPending(
  phase: string | undefined,
  status: string | undefined,
  kind: string | undefined,
): boolean {
  return (
    phase === "start" ||
    phase === "pending" ||
    status === "pending" ||
    status === "requested" ||
    status === "waiting" ||
    kind === "approval-pending"
  );
}

function isApprovalTerminal(
  phase: string | undefined,
  status: string | undefined,
  kind: string | undefined,
): boolean {
  return (
    phase === "end" ||
    phase === "result" ||
    status === "resolved" ||
    status === "approved" ||
    status === "allowed" ||
    status === "denied" ||
    status === "expired" ||
    status === "failed" ||
    status === "cancelled" ||
    kind === "approval-resolved" ||
    kind === "approval-expired"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
