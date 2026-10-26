/** Agent-plane plugin: each selected employee is a real root, including on resume. */
export const name = 'byclaw-employee-binding'
export const inject = ['byclawEmployeeRoots']
export async function apply(ctx, config) {
  if (!/^byclaw-employee-\d+$/.test(config.templateId)) throw new Error('Invalid employee template id')
  // Presets are mounted eagerly by DSH. Fetch resources only for an actual root.
  let preparation
  const prepare = () => preparation ??= Promise.resolve()
    .then(() => ctx.byclawEmployeeRoots.prepare(config.templateId))
    .catch(error => { preparation = undefined; throw error })
  const bound = new WeakMap()
  const bind = agent => {
    // Child agents inherit capabilities, not their parent's employee identity.
    if (agent.session.header.parentSession !== undefined) return
    if (!bound.has(agent)) {
      const binding = prepare().then(prepared => {
        prepared.setup(agent)
        return prepared
      }).catch(error => { bound.delete(agent); throw error })
      bound.set(agent, binding)
    }
    return bound.get(agent)
  }
  ctx.on('agent/created', ({ agent }) => bind(agent))
  // A blank DSH session can change presets after agent/created has fired.
  // Bind before its first prompt assembly as well, including cold resumes.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const prepared = await bind(agent)
    if (prepared) prepared.authorize()
    return next()
  })
}
