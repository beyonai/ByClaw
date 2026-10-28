export type ChatRuntimeType = 'dsh' | 'openclaw' | 'unknown';

export interface ChatRuntimeHint {
  runtimeType?: unknown;
  enableDsh?: unknown;
  sourceAgentType?: unknown;
  targetAgentType?: unknown;
  agentType?: unknown;
  agentDevType?: unknown;
}

const DSH_TARGET_PREFIXES = ['BYCLAW_DSH', 'HARNESS'];
const OPENCLAW_AGENT_TYPE = '013';

const normalize = (value: unknown) => `${value ?? ''}`.trim();

const isEnabled = (value: unknown) => normalize(value) === '1';

const isDshTarget = (value: unknown) => {
  const normalized = normalize(value).toUpperCase();
  return DSH_TARGET_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`));
};

/** Resolve the runtime for the current chat using server data first and legacy SSE hints as fallback. */
export function resolveChatRuntimeType(hint: ChatRuntimeHint = {}): ChatRuntimeType {
  if (hint.enableDsh !== undefined && hint.enableDsh !== null) {
    return isEnabled(hint.enableDsh) ? 'dsh' : 'openclaw';
  }
  const runtimeType = normalize(hint.runtimeType).toLowerCase();
  if (runtimeType === 'dsh' || runtimeType === 'openclaw') {
    return runtimeType;
  }

  if (isDshTarget(hint.sourceAgentType) || isDshTarget(hint.targetAgentType)) {
    return 'dsh';
  }

  if (isEnabled(hint.enableDsh)) {
    return 'dsh';
  }

  const agentType = normalize(hint.agentType);
  const agentDevType = normalize(hint.agentDevType).toLowerCase();
  if (agentType === OPENCLAW_AGENT_TYPE || agentDevType === 'openclaw') {
    return 'openclaw';
  }

  return 'unknown';
}

export function isDshRuntime(hint: ChatRuntimeHint = {}): boolean {
  return resolveChatRuntimeType(hint) === 'dsh';
}

export function isOpenClawRuntime(hint: ChatRuntimeHint = {}): boolean {
  return resolveChatRuntimeType(hint) === 'openclaw';
}
