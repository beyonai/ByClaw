const CONNECTOR_SKILL_FILTER_RESOLVER = Symbol.for(
  "openclaw.baiyingEnhance.connectorSkillFilterResolver",
);

export interface ConnectorSkillFilterRequest {
  agentId: string;
  disabledConnectorSkills: string[];
}

export type ConnectorSkillFilterResolver = (
  request: ConnectorSkillFilterRequest,
) => Promise<string[]>;

type ConnectorSkillFilterRuntimeHost = typeof globalThis & {
  [CONNECTOR_SKILL_FILTER_RESOLVER]?: ConnectorSkillFilterResolver;
};

function runtimeHost(): ConnectorSkillFilterRuntimeHost {
  return globalThis as ConnectorSkillFilterRuntimeHost;
}

export function setConnectorSkillFilterResolver(
  resolver: ConnectorSkillFilterResolver | undefined,
): void {
  const host = runtimeHost();
  if (resolver) {
    host[CONNECTOR_SKILL_FILTER_RESOLVER] = resolver;
    return;
  }
  delete host[CONNECTOR_SKILL_FILTER_RESOLVER];
}

export async function resolveConnectorSkillFilter(
  request: ConnectorSkillFilterRequest,
): Promise<string[] | undefined> {
  return await runtimeHost()[CONNECTOR_SKILL_FILTER_RESOLVER]?.(request);
}
