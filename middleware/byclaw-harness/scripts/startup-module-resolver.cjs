// Resolve image-owned packages from their local directory, without walking the
// persistent profile prefix on every import. No source transformation or cache.
const fs = require('node:fs')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')
const { registerHooks, isBuiltin } = require('node:module')

function install({ home, managed }) {
  const profile = path.join(home, 'profiles/web')
  const bases = [path.join(managed, 'profiles/web'), path.join(managed, 'profiles')]
  const links = [path.join(profile, 'node_modules'), path.join(home, 'profiles/node_modules')]
  // This optimization applies only to the two links owned by our entrypoint.
  // Custom layouts keep Node's original lookup and error behavior.
  try {
    if (!links.every((link, i) => fs.lstatSync(link).isSymbolicLink()
      && fs.realpathSync.native(link) === fs.realpathSync.native(path.join(bases[i], 'node_modules')))) return
  } catch { return }
  let selfName
  try {
    selfName = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).name
  } catch (error) {
    if (error.code !== 'ENOENT') return
  }
  const parent = path.resolve(profile)
  const roots = bases.map(base => ({
    modules: fs.realpathSync.native(path.join(base, 'node_modules')),
    url: pathToFileURL(path.join(base, '__byclaw_resolve__.js')).href,
  }))
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!context.parentURL?.startsWith('file:') || isBuiltin(specifier)
        || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')
        || specifier.includes(':')) return nextResolve(specifier, context)
      const from = fileURLToPath(context.parentURL)
      if ((context.parentURL.endsWith('/') ? path.resolve(from) : path.dirname(from)) !== parent) {
        return nextResolve(specifier, context)
      }
      const parts = specifier.split('/')
      const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      if (name === selfName) return nextResolve(specifier, context)
      if (!name || parts.includes('..') || parts.includes('.') || (specifier.startsWith('@') && !parts[1])) {
        return nextResolve(specifier, context)
      }
      for (const root of roots) {
        if (!fs.existsSync(path.join(root.modules, name))) continue
        // Preserve Node's exports/conditions checks, including failures. Never
        // fall through to another package after a rejected/missing subpath.
        return nextResolve(specifier, { ...context, parentURL: root.url })
      }
      return nextResolve(specifier, context)
    },
  })
}

module.exports = { install }
if (process.env.BYCLAW_DSH_PREPARED === '1' && process.argv[1]?.endsWith('/apps/cli/lib/bin.js')) {
  install({ home: process.env.DSH_HOME || '/home/byclaw/.dsh',
    managed: process.env.BYCLAW_DSH_MANAGED_HOME || '/opt/byclaw/dsh-managed' })
}
