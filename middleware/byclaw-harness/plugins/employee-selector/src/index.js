/** Host-plane plugin: publish authorized employees through DSH's official preset UI. */
import { mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SHIPPED_PRESET_ROOT } from '@deepseek-ai/dsh-agent-presets'
export const name = 'byclaw-employee-selector'
export const inject = ['byclawEmployeeRoots']
const prefix = 'byclaw-employee-'
const marker = '.byclaw-employee-selector'
async function writeChanged(path, content) {
  if (await readFile(path, 'utf8').catch(() => '') === content) return
  await writeFile(`${path}.tmp`, content, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}
export async function apply(ctx) {
  const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.agent-presets')
  const standard = await readFile(join(SHIPPED_PRESET_ROOT, 'standard', 'agent.cordis.yml'), 'utf8')
  // Template binding supplies deployment:persona. Keep the shipped tools and isolated services.
  const composition = standard.replace(/^- id: persona\n[\s\S]*?(?=^- id:)/m, '')
  const binding = new URL('./binding.js', import.meta.url).href
  let pending = Promise.resolve()
  const update = () => pending = pending.then(async () => {
    await mkdir(root, { recursive: true })
    const employees = ctx.byclawEmployeeRoots.list()
    const active = new Set(employees.map(entry => entry.template_id))
    for (const entry of employees) {
      const dir = join(root, entry.template_id)
      await mkdir(dir, { recursive: true })
      await writeChanged(join(dir, marker), 'managed by @byclaw/dsh-employee-selector\n')
      await writeChanged(join(dir, 'preset.yml'), `name: ${JSON.stringify(entry.name)}\ndescription: ${JSON.stringify('数字员工 · ' + entry.description)}\norder: -10\n`)
      await writeChanged(join(dir, 'agent.cordis.yml'), composition + `\n- id: byclaw-employee-binding\n  name: ${JSON.stringify(binding)}\n  config:\n    templateId: ${JSON.stringify(entry.template_id)}\n`)
    }
    for (const dir of await readdir(root)) {
      if (!dir.startsWith(prefix) || active.has(dir)) continue
      if (await readFile(join(root, dir, marker), 'utf8').catch(() => '') === 'managed by @byclaw/dsh-employee-selector\n') await rm(join(root, dir), { recursive: true })
    }
  }).catch(error => ctx.logger.error(`Employee preset sync failed: ${error.message}`))
  await update()
  const timer = setInterval(update, 5000)
  timer.unref()
  ctx.effect(() => () => clearInterval(timer))
  ctx.logger.info(`Employee selector injected: ${ctx.byclawEmployeeRoots.list().length} employees`)
}
