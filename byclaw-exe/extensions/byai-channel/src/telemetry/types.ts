export const TELEMETRY_BUSY_MARKER = "openclaw-busy-state";
export const TELEMETRY_BUSY_PREFIX = "[openclaw-busy-state]";
export const TELEMETRY_BUSY_VERSION = 1;

export type TelemetryLeaseAction = "extend" | "release_after_grace" | "hold" | "unknown";
export type TelemetryConfidence = "authoritative" | "best_effort" | "partial";
export type TelemetryEntrySource = "hook" | "agent_event";
export type TelemetryReasonState = "busy" | "hold" | "draining" | "wake" | "diagnostic";

export type TelemetryConfig = {
  enabled: boolean;
  consoleEnabled: boolean;
  redisEnabled: boolean;
  logIntervalMs: number;
  activeRunMaxAgeMs: number;
  activeToolCallMaxAgeMs: number;
  activeSubagentMaxAgeMs: number;
  activeLeaseMs: number;
  cautiousLeaseMs: number;
  idleGraceMs: number;
  maxAgeMs: number;
};

export type TelemetryActiveEntry = {
  id: string;
  source: TelemetryEntrySource;
  label?: string;
  kind?: string;
  startedAt: number;
  lastSeenAt: number;
};

export type TelemetryBusyActiveEntry = {
  id: string;
  source: TelemetryEntrySource;
  label?: string;
  kind?: string;
  startedAt: string;
  lastSeenAt: string;
};

export type TelemetryBusyReasonDetails = {
  activeAgentRuns: TelemetryBusyActiveEntry[];
  activeToolCalls: TelemetryBusyActiveEntry[];
  activeSubagents: TelemetryBusyActiveEntry[];
  activeHolds?: TelemetryBusyActiveEntry[];
  activeOutboundDeliveries?: TelemetryBusyActiveEntry[];
};

export type TelemetryStructuredReason = {
  id: string;
  kind: string;
  status: string;
  state: TelemetryReasonState;
  source: TelemetryEntrySource;
  label?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt?: string;
  confidence: Exclude<TelemetryConfidence, "authoritative">;
};

export type TelemetrySnapshotState = {
  busy: boolean;
  hold: boolean;
  draining: boolean;
  wakeRequired: boolean;
  releaseable: boolean;
  stale: boolean;
};

export type TelemetrySnapshotAuthority = {
  scope: "plugin_observed_with_ttl";
  confidence: TelemetryConfidence;
  sources: string[];
  missingSignals: string[];
};

export type TelemetryBusySnapshot = {
  busy: boolean;
  confidence: TelemetryConfidence;
  generatedAt: string;
  stale: boolean;
  reason: string[];
  reasonDetails: TelemetryBusyReasonDetails;
  state?: TelemetrySnapshotState;
  authority?: TelemetrySnapshotAuthority;
  reasons?: TelemetryStructuredReason[];
  lease: {
    recommendedAction: TelemetryLeaseAction;
    extendForMs: number;
    idleGraceMs: number;
    stopSafeAfter?: string;
    wakeRequired: boolean;
    reason?: string;
  };
  totals: {
    active: number;
    queued: number;
    running: number;
    hold?: number;
    draining?: number;
    wakeRequired?: number;
    stale?: number;
    failures: number;
    recentSessions: number;
    presenceEntries: number;
  };
  sources: {
    hooks?: {
      available: boolean;
      activeAgentRuns: number;
      activeToolCalls: number;
      activeSubagents: number;
      activeHolds?: number;
      activeOutboundDeliveries?: number;
      lastEventAt?: string;
      staleEntriesPruned: number;
    };
  };
  limits: {
    maxAgeMs: number;
    snapshotTimeoutMs: number;
    includesInteractiveRuns: boolean;
    includesHeartbeatRuns: boolean;
    includesGlobalTaskRegistry: boolean;
    includesQueueDepth?: boolean;
    includesDeliveryQueue?: boolean;
    includesOutboundDeliveryDraining?: boolean;
    containerLifecycleAware: boolean;
  };
};

export type TelemetryBusyLogEvent = "snapshot";

export type TelemetryBusyLogLine = TelemetryBusySnapshot & {
  marker: typeof TELEMETRY_BUSY_MARKER;
  version: typeof TELEMETRY_BUSY_VERSION;
  event: TelemetryBusyLogEvent;
};

export type AgentEventLike = {
  runId?: string;
  stream?: string;
  ts?: number;
  data?: Record<string, unknown>;
  sessionKey?: string;
};
