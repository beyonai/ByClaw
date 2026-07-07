import fs from "node:fs";
import path from "node:path";
import {
  ACP,
  DEFAULTS,
  ENV,
  GATEWAY,
  JSON_INDENT_SPACES,
  OPENCLAW_PLUGINS,
  PACKAGE,
  PATHS,
} from "./constants.mjs";

const byclawRoot = path.resolve(new URL("../../../../", import.meta.url).pathname);
const openclawRoot =
  process.env[ENV.openclawRoot] || path.resolve(byclawRoot, ...PATHS.defaultOpenclawRootParts);
const templatePath =
  process.env[ENV.openclawTemplatePath] || path.join(openclawRoot, PATHS.openclawTemplateFileName);
const outPath =
  process.env[ENV.openclawConfigPath] ||
  path.join(byclawRoot, PATHS.tempDir, PATHS.testConfigFileName);
const stateDir =
  process.env[ENV.openclawStateDir] || path.join(byclawRoot, PATHS.tempDir, PATHS.stateDirName);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function existingPaths(values) {
  return unique(values).filter((value) => {
    try {
      return fs.existsSync(value);
    } catch {
      return false;
    }
  });
}

function resolveAcpxAgentsConfig() {
  const defaultWrapper = path.join(
    byclawRoot,
    PATHS.wrapperRelativePath,
  );
  const claudeAdapterCommand =
    process.env.CLAUDE_AGENT_ACP_COMMAND?.trim() ||
    (fs.existsSync(defaultWrapper) ? `${process.execPath} ${defaultWrapper}` : "");
  if (!claudeAdapterCommand) {
    return undefined;
  }
  return {
    [DEFAULTS.acpAgentId]: {
      command: claudeAdapterCommand
    }
  };
}

const config = JSON.parse(fs.readFileSync(templatePath, "utf8"));
config.browser = { ...(config.browser || {}), enabled: false };
config.logging = {
  ...(config.logging || {}),
  file: path.join(stateDir, PATHS.logsDir, PATHS.openclawLogFileName)
};
config.gateway = {
  ...(config.gateway || {}),
  bind: GATEWAY.bind,
  mode: GATEWAY.mode,
  port: Number(process.env[ENV.openclawGatewayPort] || config.gateway?.port || DEFAULTS.gatewayPort),
  auth: {
    mode: GATEWAY.authMode,
    token: GATEWAY.tokenPlaceholder
  },
  tools: {
    ...(config.gateway?.tools || {}),
    allow: unique([
      ...(config.gateway?.tools?.allow || []),
      GATEWAY.tools.sessionsSpawn,
      GATEWAY.tools.applyPatch,
      GATEWAY.tools.exec,
      GATEWAY.tools.spawn,
      GATEWAY.tools.shell,
      GATEWAY.tools.fsWrite,
      GATEWAY.tools.fsDelete,
      GATEWAY.tools.fsMove
    ])
  }
};
config.agents = {
  ...(config.agents || {}),
  list: (config.agents?.list || []).map((agent) => ({
    ...agent,
    ...(agent.id === "main"
      ? {
          runtime: {
            type: ACP.runtime,
            acp: {
              agent: DEFAULTS.acpAgentId,
              cwd: byclawRoot
            }
          },
          ...(agent.model ? { model: agent.model } : {}),
          subagents: {
            ...(agent.subagents || {}),
            allowAgents: unique([...(agent.subagents?.allowAgents || []), "*"])
          }
        }
      : {}),
        workspace: agent.id === GATEWAY.mainAgentId
      ? path.join(stateDir, PATHS.workspaceDir)
      : path.join(stateDir, `${PATHS.workspaceDir}-${agent.id || DEFAULTS.acpAgentId}`)
  }))
};
config.plugins = {
  ...(config.plugins || {}),
  enabled: true,
  load: {
    ...(config.plugins?.load || {}),
      paths: existingPaths([
      path.join(byclawRoot, PATHS.extensions.baiyingEnhance),
      path.join(byclawRoot, PATHS.extensions.byaiChannel),
      path.join(byclawRoot, PATHS.extensions.byclawSqlite),
      path.join(byclawRoot, PATHS.extensions.byclawAcpAdapter),
      path.join(openclawRoot, PATHS.extensions.acpx),
      ...(config.plugins?.load?.paths || [])
    ])
  },
  allow: unique([
    ...(config.plugins?.allow || []),
    OPENCLAW_PLUGINS.acpx,
    OPENCLAW_PLUGINS.byclawAcpAdapter,
    OPENCLAW_PLUGINS.byclawSqlite,
    OPENCLAW_PLUGINS.baiyingEnhance,
    OPENCLAW_PLUGINS.byaiChannel,
  ]),
  entries: {
    ...(config.plugins?.entries || {}),
    [OPENCLAW_PLUGINS.acpx]: {
      enabled: true,
      config: {
        cwd: byclawRoot,
        stateDir: path.join(stateDir, PATHS.acpxStateDir),
        probeAgent: DEFAULTS.acpAgentId,
        permissionMode: "approve-reads",
        nonInteractivePermissions: "fail",
        pluginToolsMcpBridge: true,
        openClawToolsMcpBridge: true,
        ...(resolveAcpxAgentsConfig() ? { agents: resolveAcpxAgentsConfig() } : {})
      }
    },
    [OPENCLAW_PLUGINS.byclawAcpAdapter]: {
      enabled: true,
      config: {
        defaultAcpAgentId: DEFAULTS.acpAgentId,
        defaultCwd: byclawRoot,
        sqlitePath: path.join(stateDir, PATHS.pluginStateDir, PATHS.pluginSqliteFileName),
        httpPathPrefix: `/plugins/${PACKAGE.pluginId}`,
        redis: {
          keyPrefix: "",
          connectTimeoutMs: DEFAULTS.pluginRedisConnectTimeoutMs
        }
      }
    },
    [OPENCLAW_PLUGINS.byaiChannel]: {
      ...(config.plugins?.entries?.[OPENCLAW_PLUGINS.byaiChannel] || {}),
      enabled: true,
      hooks: { allowConversationAccess: true }
    },
    [OPENCLAW_PLUGINS.baiyingEnhance]: {
      ...(config.plugins?.entries?.[OPENCLAW_PLUGINS.baiyingEnhance] || {}),
      enabled: true,
      hooks: { allowConversationAccess: true },
      config: {
        ...(config.plugins?.entries?.[OPENCLAW_PLUGINS.baiyingEnhance]?.config || {}),
        watchDebounceMs: DEFAULTS.baiyingWatchDebounceMs,
        mainParentAgentId: GATEWAY.mainAgentId,
        workspaceAutoSeed: true,
        embedApiKeysFromJson: true,
        mergeAllowSpawnForMain: true
      }
    },
    [OPENCLAW_PLUGINS.byclawSqlite]: {
      ...(config.plugins?.entries?.[OPENCLAW_PLUGINS.byclawSqlite] || {}),
      enabled: true
    }
  }
};
config.acp = {
  ...(config.acp || {}),
  enabled: true,
  backend: GATEWAY.backend,
  allowedAgents: unique([...(config.acp?.allowedAgents || []), DEFAULTS.acpAgentId]),
  defaultAgent: config.acp?.defaultAgent || DEFAULTS.acpAgentId
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(config, null, JSON_INDENT_SPACES)}\n`);

console.log(JSON.stringify({ ok: true, configPath: outPath, stateDir }, null, JSON_INDENT_SPACES));
