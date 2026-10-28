/** Import-free fixture loaded by the real preset Loader. */
export const name = 'employee-selector-capability-fixture'
export const inject = ['tools', 'systemPrompt', 'employeeSelectorProbe']
export function apply(ctx, config = {}) {
  const probe = ctx.employeeSelectorProbe
  if (config.persona) {
    probe.personas++
    ctx.effect(() => ctx.systemPrompt.section({ name: 'deployment:persona', text: 'standard persona', order: 0 }))
    return
  }
  const revision = `${probe.owner}:${++probe.mounts}`
  ctx.effect(() => ctx.tools.register({
    name: 'fixture_capability',
    description: revision,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => revision,
  }))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'capability', text: revision, order: 1 }))
  ctx.on('agent/created', ({ agent }) => { probe.events.push([revision, agent.id]) })
  ctx.effect(() => () => { probe.disposed.push(revision) })
}
