/** Host-plane plugin: publish authorized employees through DSH's official preset UI. */
import { readFile, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { createEmployeeCapabilities } from './composition.js'
export const name = 'byclaw-employee-selector'
export const inject = ['byclawEmployeeRoots', 'agentPresets']
const prefix = 'byclaw-employee-'
const marker = '.byclaw-employee-selector'
const markerText = 'managed by @byclaw/dsh-employee-selector\n'

/** The standard composition without its persona row; the employee binding supplies deployment:persona. */
export async function employeeComposition(agentPresets) {
  const standard = await agentPresets.readDocument('standard')
  const rows = load(standard.content, { schema: entryListSchema }) ?? []
  return rows.filter(row => row?.id !== 'persona')
}

/** Preset directories an earlier release wrote under `$DSH_HOME/.agent-presets`; DSH 0.2 reads presets from the registry. */
async function removeLegacyPresetFiles(logger) {
  const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.agent-presets')
  for (const dir of await readdir(root).catch(() => [])) {
    if (!dir.startsWith(prefix)) continue
    if (await readFile(join(root, dir, marker), 'utf8').catch(() => '') !== markerText) continue
    await rm(join(root, dir), { recursive: true }).catch(error => logger.warn(`Legacy employee preset not removed: ${error.message}`))
  }
}

export async function apply(ctx) {
  const binding = new URL('./binding.js', import.meta.url).href
  /** Registered employee presets by template id, with the display fields they were registered with. */
  const registered = new Map()
  let pending = Promise.resolve()
  let capabilities
  let stopped = false
  const update = () => pending = pending.then(async () => {
    if (stopped) return
    const employees = ctx.byclawEmployeeRoots.list()
    const active = new Set(employees.map(entry => entry.template_id))
    for (const [templateId, entry] of registered) {
      if (active.has(templateId)) continue
      registered.delete(templateId)
      await entry.dispose()
    }
    for (const employee of employees) {
      const display = { name: employee.name, description: '数字员工 · ' + employee.description }
      const existing = registered.get(employee.template_id)
      if (existing !== undefined && existing.name === display.name && existing.description === display.description) continue
      if (existing !== undefined) {
        registered.delete(employee.template_id)
        await existing.dispose()
      }
      const plugins = [{ id: 'byclaw-employee-binding', name: binding,
        config: { templateId: employee.template_id, capabilitiesId: capabilities.id } }]
      const dispose = await ctx.agentPresets.register({ id: employee.template_id, ...display, order: -10, plugins })
      registered.set(employee.template_id, { ...display, dispose })
    }
  }).catch(error => ctx.logger.error(`Employee preset sync failed: ${error.message}`))
  await removeLegacyPresetFiles(ctx.logger)
  // Establish the capability revision before this user context becomes ready.
  // Keep it across empty rosters so later grants need only lightweight bindings.
  capabilities = await createEmployeeCapabilities(ctx, await employeeComposition(ctx.agentPresets))
  await update()
  const timer = setInterval(update, 5000)
  timer.unref()
  ctx.effect(() => () => {
    stopped = true
    clearInterval(timer)
    // Remove selectable definitions before releasing the anchor. Active roots
    // keep their generation (and its shared parent) through registry leases.
    return pending = pending.then(async () => {
      for (const entry of registered.values()) await entry.dispose()
      registered.clear()
      await capabilities?.dispose()
      capabilities = undefined
    })
  })
  ctx.logger.info(`Employee selector injected: ${ctx.byclawEmployeeRoots.list().length} employees`)
}
