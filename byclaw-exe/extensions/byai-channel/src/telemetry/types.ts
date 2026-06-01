export const TELEMETRY_BUSY_MARKER = "openclaw-busy-state";
export const TELEMETRY_BUSY_PREFIX = "[openclaw-busy-state]";
export const TELEMETRY_BUSY_VERSION = 1;

export type TelemetryLeaseAction = "extend" | "release_after_grace" | "hold" | "unknown";
export type TelemetryConfidence = "authoritative" | "best_effort" | "partial";
export type TelemetryEntrySource = "hook" | "agent_event";

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
};

export type TelemetryBusySnapshot = {
  busy: boolean;
  confidence: TelemetryConfidence;
  generatedAt: string;
  stale: boolean;
  reason: string[];
  reasonDetails: TelemetryBusyReasonDetails;
  lease: {
    recommendedAction: TelemetryLeaseAction;
    extendForMs: number;
    idleGraceMs: number;
    stopSafeAfter?: string;
    wakeRequired: boolean;
  };
  totals: {
    active: number;
    queued: number;
    running: number;
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
