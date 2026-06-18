import type { OpenClawConfig } from "openclaw/plugin-sdk";

export const MANAGED_BAIYING_AGENT_PREFIX = "baiying-agent-" as const;

const DEFAULT_WAIT_MS = 15_000;
const DEFAULT_POLL_MS = 100;

type RuntimeConfigReader = {
  config?: {
    current?: () => OpenClawConfig | undefined;
    loadConfig?: () => OpenClawConfig | undefined;
  };
};

type Logger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
};

export type ManagedAgentConfigReadiness = {
  ready: boolean;
  agentId: string;
  primary?: string;
  providerId?: string;
  modelId?: string;
  reason?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRuntimeConfig(
  runtime: RuntimeConfigReader,
  fallback: OpenClawConfig,
): OpenClawConfig {
  try {
    const current = runtime.config?.current?.();
    if (current) {
      return current;
    }
  } catch {
    // Fall through to loadConfig/fallback.
  }

  try {
    return runtime.config?.loadConfig?.() ?? fallback;
  } catch {
    return fallback;
  }
}

function resolvePrimaryModelRef(agent: Record<string, unknown>): string {
  const model = agent.model;
  if (typeof model === "string") {
    return model.trim();
  }
  if (isRecord(model)) {
    const primary = model.primary;
    if (typeof primary === "string") {
      return primary.trim();
    }
  }
  return "";
}

function splitPrimaryModelRef(primary: string): { providerId: string; modelId: string } | null {
  const separator = primary.indexOf("/");
  if (separator <= 0 || separator >= primary.length - 1) {
    return null;
  }
  return {
    providerId: primary.slice(0, separator),
    modelId: primary.slice(separator + 1),
  };
}

function providerHasModel(provider: unknown, modelId: string): boolean {
  if (!isRecord(provider)) {
    return false;
  }
  const models = provider.models;
  if (Array.isArray(models)) {
    return models.some((model) => {
      if (typeof model === "string") {
        return model === modelId;
      }
      return isRecord(model) && model.id === modelId;
    });
  }
  if (!isRecord(models)) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(models, modelId);
}

export function resolveManagedBaiyingAgentConfigReadiness(
  cfg: OpenClawConfig,
  agentId: string,
): ManagedAgentConfigReadiness {
  if (!agentId.startsWith(MANAGED_BAIYING_AGENT_PREFIX)) {
    return { ready: true, agentId, reason: "not_managed_baiying_agent" };
  }

  const agent = cfg.agents?.list?.find((candidate) => candidate.id === agentId) as
    | Record<string, unknown>
    | undefined;
  if (!agent) {
    return { ready: false, agentId, reason: "agent_missing" };
  }

  const primary = resolvePrimaryModelRef(agent);
  if (!primary) {
    return { ready: false, agentId, reason: "primary_model_missing" };
  }

  const parsed = splitPrimaryModelRef(primary);
  if (!parsed) {
    return { ready: false, agentId, primary, reason: "primary_model_invalid" };
  }

  const provider = cfg.models?.providers?.[parsed.providerId];
  if (!provider) {
    return {
      ready: false,
      agentId,
      primary,
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      reason: "provider_missing",
    };
  }

  if (!providerHasModel(provider, parsed.modelId)) {
    return {
      ready: false,
      agentId,
      primary,
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      reason: "model_missing",
    };
  }

  return {
    ready: true,
    agentId,
    primary,
    providerId: parsed.providerId,
    modelId: parsed.modelId,
  };
}

export async function waitForManagedBaiyingAgentConfig(params: {
  runtime: RuntimeConfigReader;
  cfg: OpenClawConfig;
  agentId: string;
  log?: Logger;
  waitMs?: number;
  pollMs?: number;
}): Promise<OpenClawConfig> {
  const waitMs = params.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = params.pollMs ?? DEFAULT_POLL_MS;
  const start = Date.now();
  let cfg = readRuntimeConfig(params.runtime, params.cfg);
  let readiness = resolveManagedBaiyingAgentConfigReadiness(cfg, params.agentId);

  if (readiness.ready) {
    return cfg;
  }

  params.log?.info?.(
    `[diagnose-sdk] waiting for managed agent config before dispatch: agent=${params.agentId}, reason=${readiness.reason ?? "unknown"}, waitMs=${waitMs}`,
  );

  while (Date.now() - start < waitMs) {
    await sleep(pollMs);
    cfg = readRuntimeConfig(params.runtime, params.cfg);
    readiness = resolveManagedBaiyingAgentConfigReadiness(cfg, params.agentId);
    if (readiness.ready) {
      params.log?.info?.(
        `[diagnose-sdk] managed agent config ready before dispatch: agent=${params.agentId}, model=${readiness.primary ?? "unknown"}, waitedMs=${Date.now() - start}`,
      );
      return cfg;
    }
  }

  params.log?.warn?.(
    `[diagnose-sdk] managed agent config still not ready before dispatch: agent=${params.agentId}, reason=${readiness.reason ?? "unknown"}, waitedMs=${Date.now() - start}`,
  );
  return cfg;
}
