/** Source-mode integration checks against an unmodified DSH checkout. */
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = dirname(fileURLToPath(import.meta.url))
const dshRoot = process.env.DSH_ROOT || resolve(pluginDir, '../../../deepseek-harness')
const requireDsh = createRequire(resolve(dshRoot, 'package.json'))
const ts = requireDsh('typescript')
const config = ts.readConfigFile(resolve(dshRoot, 'tsconfig.base.json'), ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const alias = Object.entries(config.config.compilerOptions.paths)
  .filter(([name]) => !name.includes('*'))
  .map(([find, paths]) => ({ find, replacement: resolve(dshRoot, paths[0]) }))
alias.unshift(
  { find: 'vitest', replacement: resolve(dirname(requireDsh.resolve('vitest/package.json')), 'dist/index.js') },
  { find: 'js-yaml', replacement: requireDsh.resolve('js-yaml') },
  { find: '@byclaw/dsh-agent-teams/catalog', replacement: resolve(pluginDir, '../agent-teams/src/catalog.ts') },
  { find: '@byclaw/dsh-agent-teams/child-setup', replacement: resolve(pluginDir, '../agent-teams/src/child-setup.ts') },
)

export default {
  root: pluginDir,
  resolve: { alias },
  plugins: [{
    name: 'standard-decorators', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || !/^\s*@[A-Za-z_$][\w$]*/m.test(code)) return
      const result = ts.transpileModule(code, { fileName: id, compilerOptions: {
        target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, sourceMap: true,
      } })
      return { code: result.outputText, map: result.sourceMapText }
    },
  }],
  test: { include: ['tests/skill-runtime.spec.ts'], environment: 'node' },
}
