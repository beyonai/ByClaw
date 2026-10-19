/** Agent-plane plugin: each selected employee is a real root, including on resume. */
export const name = 'byclaw-employee-binding'
export const inject = ['byclawEmployeeRoots']
export async function apply(ctx, config) {
  if (!/^byclaw-employee-\d+$/.test(config.templateId)) throw new Error('Invalid employee template id')
  const prepared = await ctx.byclawEmployeeRoots.prepare(config.templateId)
  const bound = new WeakSet()
  const bind = agent => {
    // Child agents inherit capabilities, not their parent's employee identity.
    if (agent.session.header.parentSession !== undefined || bound.has(agent)) return
    prepared.setup(agent)
    bound.add(agent)
  }
  ctx.on('agent/created', ({ agent }) => bind(agent))
  // A blank DSH session can change presets after agent/created has fired.
  // Bind before its first prompt assembly as well, including cold resumes.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    bind(agent)
    if (agent.session.header.parentSession === undefined) prepared.authorize()
    return next()
  })
}
