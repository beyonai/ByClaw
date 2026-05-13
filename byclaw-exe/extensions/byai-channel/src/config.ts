import { DEFAULT_ACCOUNT_ID, type OpenClawConfig } from "openclaw/plugin-sdk";
import { ByaiChannelConfigSchema } from "./config-schema.js";
import type { ByaiChannelConfig, ResolvedByaiAccount } from "./types.js";

const CHANNEL_KEY = "byai-channel";

function extractChannelConfig(cfg: OpenClawConfig): ByaiChannelConfig | undefined {
  const channelCfg = cfg.channels?.[CHANNEL_KEY];
  if (!channelCfg) return undefined;

  const parseResult = ByaiChannelConfigSchema.safeParse(channelCfg);
  return parseResult.success ? parseResult.data : undefined;
}

function resolveSingleAccount(
  cfg: OpenClawConfig,
  accountId: string,
  channelConfig: ByaiChannelConfig,
): ResolvedByaiAccount {
  const name = accountId === DEFAULT_ACCOUNT_ID ? "Default" : accountId;

  return {
    accountId,
    name,
    enabled: channelConfig.enabled ?? true,
    configured: true,
    config: channelConfig,
  };
}

export function listByaiAccountIds(cfg: OpenClawConfig): string[] {
  const channelCfg = extractChannelConfig(cfg);
  if (!channelCfg) return [];

  const ids: string[] = [];

  // 默认账户
  if (channelCfg.enabled !== false) {
    ids.push(DEFAULT_ACCOUNT_ID);
  }

  // 多账户支持（预留）
  const accounts = cfg.channels?.[CHANNEL_KEY]?.accounts as Record<string, unknown> | undefined;
  if (accounts) {
    for (const id of Object.keys(accounts)) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
}

export function resolveByaiAccount({
  cfg,
  accountId,
}: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedByaiAccount {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
  const channelConfig = extractChannelConfig(cfg);

  if (!channelConfig) {
    return {
      accountId: resolvedAccountId,
      name: resolvedAccountId === DEFAULT_ACCOUNT_ID ? "Default" : resolvedAccountId,
      enabled: false,
      configured: false,
      config: ByaiChannelConfigSchema.parse({}),
    };
  }

  return resolveSingleAccount(cfg, resolvedAccountId, channelConfig);
}

export function resolveDefaultByaiAccountId(cfg: OpenClawConfig): string {
  const ids = listByaiAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}
