/** Agent-plane plugin: each selected employee is a real root, including on resume. */
import { composeEmployeeCapabilities } from './composition.js'
export const name = 'byclaw-employee-binding'
export const inject = ['byclawEmployeeRoots', 'agentPresets']
export async function apply(ctx, config) {
  if (!/^byclaw-employee-\d+$/.test(config.templateId)) throw new Error('Invalid employee template id')
  // Older full compositions already carry their capabilities. New lightweight
  // revisions join the shared tree before installing employee identity hooks.
  if (config.capabilitiesId) composeEmployeeCapabilities(ctx, config.capabilitiesId)
  // Presets are mounted eagerly by DSH. Fetch resources only for an actual root.
  // Each new root reauthorizes against current Redis state. The integration owns
  // the versioned template cache; a preset must not cache an old persona forever.
  const prepare = () => Promise.resolve().then(() => ctx.byclawEmployeeRoots.prepare(config.templateId))
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
    if (prepared) await prepared.authorize()
    return next()
  })
}
