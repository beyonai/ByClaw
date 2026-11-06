/** Control-plane-owned display metadata. Never derive this from tool arguments or stdout. */
export interface SandboxInstanceRef { sandboxId: string; instance: string; mappingId?: string }
export interface SandboxInstanceContext {
  version?: number
  sandboxId: string
  mappingId?: string
  instanceBindings: Record<string, string[]>
  instanceDescriptors?: Record<string, { viewer?: string; label?: string }>
}

/** Old allocations still identify their own desktops by the established endpoint names. */
export function legacyInstanceContext(allocation: {
  sandboxId?: string; mappingId?: string | null; isShared?: boolean; instanceEndpoints?: Record<string, string>
} | undefined): SandboxInstanceContext | undefined {
  const mappingId = allocation?.mappingId ?? undefined
  if (typeof allocation?.sandboxId !== 'string' || !allocation.sandboxId || allocation.sandboxId !== allocation.sandboxId.trim()
    || (allocation.isShared && !mappingId)
    || (mappingId !== undefined && (typeof mappingId !== 'string' || !mappingId || mappingId !== mappingId.trim()))) return undefined
  const names = ['vnc', 'desktop'].filter(name => typeof allocation.instanceEndpoints?.[name] === 'string' && allocation.instanceEndpoints[name].trim())
  if (!names.length) return undefined
  return { version: 1, sandboxId: allocation.sandboxId,
    ...(mappingId === undefined ? {} : { mappingId }),
    instanceBindings: { default: names, 'browser.automation': names.filter(name => name === 'vnc') } }
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
