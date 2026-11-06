/** Control-plane-owned display metadata. Never derive this from tool arguments or stdout. */
export interface SandboxInstanceRef { sandboxId: string; instance: string; mappingId?: string }
export interface SandboxInstanceContext {
  version?: number
  sandboxId: string
  mappingId?: string
  instanceBindings: Record<string, string[]>
  instanceDescriptors?: Record<string, { viewer?: string; label?: string }>
}
export function instanceRefsFor(raw: unknown, capability?: string): SandboxInstanceRef[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const context = raw as SandboxInstanceContext
  if ((context.version !== undefined && context.version !== 1) || typeof context.sandboxId !== 'string' || (!context.sandboxId || context.sandboxId !== context.sandboxId.trim())
    || (context.mappingId !== undefined && (typeof context.mappingId !== 'string' || (!context.mappingId || context.mappingId !== context.mappingId.trim())))
    || !context.instanceBindings || typeof context.instanceBindings !== 'object') return []
  const names = (capability === undefined ? undefined : context.instanceBindings[capability]) ?? context.instanceBindings.default
  if (!Array.isArray(names) || !names.every(name => typeof name === 'string' && name.length > 0 && name === name.trim())) return []
  return [...new Set(names)].map(instance => ({ sandboxId: context.sandboxId, instance,
    ...(context.mappingId === undefined ? {} : { mappingId: context.mappingId }) }))
}
