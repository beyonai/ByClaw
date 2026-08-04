import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
  type ConnectorSkillFilterResolver,
  setConnectorSkillFilterResolver,
} from "../../shared/src/connector-skill-filter-runtime.js";
import {
  mergeSkillNames,
  scanPluginSkillNames,
  scanSkillRootNames,
  scanWorkspaceSkillNames,
} from "./workspace-skills.js";
import { resolveStateDir } from "./workspace-paths.js";

type VisibleSkillLoadParams = {
  agentId: string;
  config: any;
  workspaceDir: string;
};

type VisibleSkillNameLoader = (params: VisibleSkillLoadParams) => Promise<string[]>;

function currentRuntimeConfig(api: OpenClawPluginApi): any {
  const runtimeConfig = api.runtime.config as typeof api.runtime.config & {
    current?: () => any;
  };
  return runtimeConfig.current?.() ?? runtimeConfig.loadConfig();
}

function expandHomePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function bundledSkillRoots(): string[] {
  const override = process.env.OPENCLAW_BUNDLED_SKILLS_DIR?.trim();
  if (override) {
    return [expandHomePath(override)];
  }
  const scriptRoot = process.argv[1]
    ? path.resolve(path.dirname(process.argv[1]), "..", "skills")
    : "";
  return mergeSkillNames([scriptRoot, path.resolve(process.cwd(), "skills")]);
}

export async function loadVisibleSkillNamesFromOpenClawRoots(
  params: VisibleSkillLoadParams,
): Promise<string[]> {
  const stateDir = resolveStateDir();
  const configuredExtraDirs = Array.isArray(params.config?.skills?.load?.extraDirs)
    ? params.config.skills.load.extraDirs
        .filter((entry: unknown): entry is string => typeof entry === "string")
        .map(expandHomePath)
    : [];
  const roots = mergeSkillNames(
    [path.join(params.workspaceDir, ".agents", "skills")],
    [path.join(stateDir, "skills")],
    [path.join(homedir(), ".agents", "skills")],
    configuredExtraDirs,
    bundledSkillRoots(),
  );
  const [workspaceSkills, pluginSkills, ...rootSkills] = await Promise.all([
    scanWorkspaceSkillNames(params.workspaceDir),
    scanPluginSkillNames(),
    ...roots.map((root) => scanSkillRootNames(root)),
  ]);
  return mergeSkillNames(workspaceSkills, pluginSkills, ...rootSkills);
}

export function filterRegisteredSkills(
  registeredSkills: unknown[],
  disabledSkills: string[],
): string[] {
  const disabled = new Set(
    disabledSkills
      .map((name) => name.trim())
      .filter(Boolean),
  );
  return mergeSkillNames(registeredSkills).filter((name) => !disabled.has(name));
}

export function createConnectorSkillFilterResolver(params: {
  api: OpenClawPluginApi;
  loadVisibleSkillNames?: VisibleSkillNameLoader;
}): ConnectorSkillFilterResolver {
  const loadVisibleSkillNames =
    params.loadVisibleSkillNames ?? loadVisibleSkillNamesFromOpenClawRoots;
  return async ({ agentId, disabledConnectorSkills }) => {
    const config = currentRuntimeConfig(params.api);
    const agent = config.agents?.list?.find(
      (entry: { id?: string }) => entry.id === agentId,
    );
    let registeredSkills: unknown[];
    if (Array.isArray(agent?.skills)) {
      registeredSkills = agent.skills;
    } else if (Array.isArray(config.agents?.defaults?.skills)) {
      registeredSkills = config.agents.defaults.skills;
    } else {
      const workspaceDir = params.api.runtime.agent.resolveAgentWorkspaceDir(config, agentId);
      registeredSkills = await loadVisibleSkillNames({
        agentId,
        config,
        workspaceDir,
      });
    }
    return filterRegisteredSkills(registeredSkills, disabledConnectorSkills);
  };
}

export function registerConnectorSkillFilterProvider(
  api: OpenClawPluginApi,
  options: { loadVisibleSkillNames?: VisibleSkillNameLoader } = {},
): void {
  setConnectorSkillFilterResolver(
    createConnectorSkillFilterResolver({
      api,
      loadVisibleSkillNames: options.loadVisibleSkillNames,
    }),
  );
}
