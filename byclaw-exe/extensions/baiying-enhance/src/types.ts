import type { OpenClawConfig } from "openclaw/plugin-sdk/compat";

export type AgentListEntry = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

export type BaiyingEnhancePluginConfig = {
  /** @deprecated Ignored for Baiying resource snapshots; associated resources are read from Redis. */
  executorResourcesDir?: string;
  /** @deprecated Ignored; digital employees are read from Redis key `DIG_EMPLOYEE_{resourceId}`. */
  agentConfigDir?: string;
  /** Debounce (ms) for coalescing dig-employee Redis flush triggers. */
  watchDebounceMs?: number;
  mainParentAgentId?: string;
  mergeAllowSpawnForMain?: boolean;
  embedApiKeysFromJson?: boolean;
  envApiKeyTemplate?: string;
  /**
   * When true (default), after each successful config sync, create/update the per-agent workspace
   * under the OpenClaw state dir and seed SOUL.md / AGENTS.md / … from the JSON export.
   */
  workspaceAutoSeed?: boolean;
  /**
   * When true (default), move unauthorized managed digital employee workspaces out of the
   * OpenClaw state dir so stale prompts/resources are not discoverable from `.openclaw`.
   */
  workspaceArchiveOnUnauthorized?: boolean;
  /**
   * Archive root for unauthorized managed workspaces. Absolute paths and `~` are honored;
   * relative paths resolve under the parent of `OPENCLAW_STATE_DIR`.
   * Default: `.baiying-workspaces` next to `.openclaw`.
   */
  workspaceArchiveDir?: string;
  /**
   * How to write main workspace `AGENTS.md` for `mainParentAgentId` (default `main`).
   * Omitted defaults to `always` (overwrite each seed) while a template source exists (built-in or `mainAgentsMdPath`).
   * Set to `if_managed_marker` or `if_missing` to avoid clobbering unmarked files. Set to `off` to disable.
   */
  mainAgentsMdMode?: "off" | "if_missing" | "if_managed_marker" | "always";
  /**
   * Optional override: markdown file to install as main `AGENTS.md` (~, OPENCLAW_STATE_DIR-relative, or absolute).
   * When unset, the plugin uses the template embedded in the built `dist/index.js` (from `templates/main-agents.md` at compile time).
   */
  mainAgentsMdPath?: string;
  /**
   * When `false`, do not use the embedded built-in template (only `mainAgentsMdPath` counts). Default: use embedded template.
   */
  useBundledMainAgentsMd?: boolean;
  /**
   * When true (default), run main workspace `AGENTS.md` seeding on each agent sync flush (independent of `workspaceAutoSeed`).
   */
  mainWorkspaceAgentsAutoSeed?: boolean;
  /**
   * When true (default) and `mainAgentsMdMode` is `if_managed_marker`, replace an **existing** main `AGENTS.md`
   * that lacks the plugin marker **once per workspace** (e.g. OpenClaw stock file), then record the path under
   * `OPENCLAW_STATE_DIR/baiying-enhance/main-agents-foreign-takeover.json`.
   */
  mainAgentsMdForeignTakeover?: boolean;
  /** Default proxy URL for raw Baiying detail format agents (e.g. "https://lab.iwhalecloud.com/gpt-proxy/v1"). */
  defaultProxyUrl?: string;
  /** Default API key for the proxy endpoint. */
  defaultApiKey?: string;
  /**
   * When true (default), persist Redis source JSON content hashes to disk so cold restarts
   * do not treat every managed agent as newly changed.
   */
  persistAgentContentIndex?: boolean;
  /**
   * Override path for the content index JSON file. Relative paths resolve under ~/.openclaw/ (see plugin path rules).
   * Default: `~/.openclaw/baiying-enhance/agent-content-index-<sha16>.json`.
   */
  agentContentIndexPath?: string;
  /** @deprecated Ignored. Former directory watcher toggle; kept so older `openclaw.json` entries do not fail validation. */
  watchAgentDir?: boolean;
  /** @deprecated Ignored. Legacy copy-paste from older README examples (any JSON shape tolerated at runtime). */
  skillDirs?: unknown;
  /** @deprecated Ignored. Legacy copy-paste from older README examples. */
  pollIntervalMs?: number;
  /**
   * When true (default), merge user-uploaded workspace skills (`skills/<name>/SKILL.md`) into
   * managed agents' `agents.list[].skills` alongside JSON `relSkills` / `skills`.
   */
  workspaceSkillAutoEnable?: boolean;
  /**
   * Fallback scan interval in milliseconds for workspace skill changes. Default 500.
   * Set to 0 or a negative value to disable the periodic scan and rely on fs.watch + normal sync triggers.
   */
  workspaceSkillScanIntervalMs?: number;
  /**
   * When true, skills uploaded to the main workspace (`workspace/skills`) are treated
   * as shared skills and merged into managed sub-agents.
   */
  workspaceSkillIncludeMainShared?: boolean;
  /** Subscribe to `digEmployeeChangeChannel` for digital-employee change broadcasts (Redis PUBLISH). Default true. */
  digEmployeeChangeSubscribe?: boolean;
  /** Redis Pub/Sub channel for `DigEmployeeChangeEvent` JSON (default `byai:pub:dig_employee_change`). */
  digEmployeeChangeChannel?: string;
  /**
   * Extra `plugins.entries.*` subtrees to treat as **in-process** config reload (not full gateway restart) when this plugin calls `writeConfigFile` during agent sync.
   * Values: full path `plugins.entries.<id>` or bare plugin id `<id>`. **Omitted** = only `baiying-enhance` is registered here; add e.g. `"byai-channel"`, `"minimax"` if your sync touches those entries and the gateway would otherwise restart.
   * Other plugins may also declare their own `reload.hotPrefixes`; this list is only for paths you want this plugin to register additionally.
   */
  configSyncHotPluginEntriesPrefixes?: string[];
  /**
   * When true (default), ignore Pub/Sub events if `getAuthorizedIds()` is still undefined.
   * Set false to flush on every event without an auth filter (high load).
   */
  digEmployeeChangeSubscribeStrictAuth?: boolean;
};

export type BaiyingAssociatedResource = {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceBizType?: string;
  resourceCode?: string;
  resourceDesc?: string;
  resourceSourcePkId?: string;
  systemCode?: string;
  hostType?: string;
  parentResourceId?: string;
  implType?: string;
  raw?: Record<string, unknown>;
};

export type BaiyingCoreCompetency = {
  coreCompetency?: string;
  description?: string;
  acceptBoundary?: string[];
  rejectBoundary?: string[];
  example?: string[];
};

export const MANAGED_AGENT_PREFIX = "baiying-agent-";
export const MANAGED_PROVIDER_PREFIX = "baiying-m-";

export type ManagedAgentRecord = {
  sourceKey: string;
  sourcePath: string;
  agentId: string;
  providerKey: string;
  modelRef: string;
  allowSpawnFrom: string[];
};
