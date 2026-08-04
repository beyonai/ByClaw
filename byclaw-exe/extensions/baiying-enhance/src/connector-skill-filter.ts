import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
  type ConnectorSkillFilterResolver,
  setConnectorSkillFilterResolver,
} from "../../shared/src/connector-skill-filter-runtime.js";
import {
  mergeSkillNames,
  scanPluginSkillNames,
  scanWorkspaceSkillNames,
} from "./workspace-skills.js";

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

async function loadVisibleSkillNamesFromManagedRoots(
  params: VisibleSkillLoadParams,
): Promise<string[]> {
  return mergeSkillNames(
    await scanWorkspaceSkillNames(params.workspaceDir),
    await scanPluginSkillNames(),
  );
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
    params.loadVisibleSkillNames ?? loadVisibleSkillNamesFromManagedRoots;
  return async ({ agentId, disabledConnectorSkills }) => {
    const config = currentRuntimeConfig(params.api);
    const agent = config.agents?.list?.find(
      (entry: { id?: string }) => entry.id === agentId,
    );
    let registeredSkills: unknown[];
    if (Array.isArray(agent?.skills)) {
      registeredSkills = agent.skills;
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
