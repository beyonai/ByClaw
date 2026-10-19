/**
 * Browser-bundle build for the board's client half, reproducing the artifact
 * shape the harness's own client packages ship. That shape is not documented
 * anywhere a plugin can import: `packages/client/tsdown.client.ts` in the
 * harness is the source of truth, and its tarballs carry no `src/`, so this
 * file restates the parts a plugin needs. A divergence from that preset is a
 * defect in this file — the same trade the trust fence and the sidebar
 * contract already make elsewhere in this line.
 *
 * The artifact is a loader-factory module, not an ESM one:
 *
 *     window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => {
 *       var module = { exports: {} }; var exports = module.exports;
 *       ...bundle body, calling require('react') and friends...
 *     return module.exports; } });
 *
 * The harness serves it at `/plugins/<id>/client.js` and runs the factory with
 * a `require` backed by its module table, so `id` must equal the package name
 * the table composes on.
 *
 * What stays external is decided by that table, not by convenience: the
 * specifiers below are the shell's shared singletons, and requiring anything
 * else would either throw at boot (the table cannot answer it) or inline a
 * second copy of a module that must be one instance.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'


/**
 * Specifiers resolved through the harness's loader module table rather than
 * bundled. These mirror the shell's `PLATFORM_MODULES` plus the client
 * snapshot-store engine and the renderer's slot registry; every one is a
 * shared singleton whose duplicate would break React or the slot registry.
 * The board imports exactly these and nothing else at runtime, so the list is
 * complete rather than defensive.
 */
const MODULE_TABLE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-renderer/client',
])

/**
 * Virtual-id wrapper keeping module CSS out of tsdown's own css pipeline. The
 * suffix matters: tsdown's guard matches ids ending in `.css`, so the virtual
 * id must not end that way.
 */
const CSS_PREFIX = '\0devflow-css:'
const CSS_SUFFIX = '.mjs'

/**
 * One stylesheet as a module that injects itself and exports its class map.
 * The tag is keyed so a remount does not stack duplicate styles.
 * @param fileId - absolute path of the source stylesheet, for the tag key.
 * @param css - compiled stylesheet text.
 * @param classMap - CSS Modules local-to-hashed name map.
 * @returns the module source.
 */
function styleModule(pluginId: string, fileId: string, css: string, classMap: Record<string, string>): string {
  const tagId = `${pluginId}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

// Upstream also builds `automation-ui`; ByClaw does not carry that package
// (see UPSTREAM.md), and an entry naming a directory that is not here fails
// the whole bundle build with UNRESOLVED_ENTRY.
export default defineConfig(['devflow-ui'].map((directory): UserConfig => {
  const pluginId = `@zhchxiao123/dsh-${directory}`
  return {
  name: `${pluginId}/client`,
  entry: { client: `packages/${directory}/src/client/index.ts` },
  // Lands beside the node half already in lib/; `clean` must stay off or this
  // build would wipe the entries tsdown.config.ts emitted.
  outDir: `packages/${directory}/lib`,
  format: 'cjs',
  platform: 'browser',
  // Declarations ship from lib/types via tsc; emitting them here would wrap
  // the banner and footer into a .d.cts and break parsing.
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => MODULE_TABLE.has(specifier),
    // Everything the table cannot answer must be inlined: a `require()` it
    // does not know is a guaranteed throw the moment the factory runs.
    alwaysBundle: (specifier: string) => !MODULE_TABLE.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  plugins: [{
    /*
     * Purity gate. A harness value import that is neither a module-table row
     * nor this line's own package either inlines a duplicate of a shared
     * runtime or requires a specifier nothing can resolve. Cross-plugin
     * collaboration goes through cordis services; type-only imports are erased
     * before they reach here.
     */
    name: 'devflow-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (MODULE_TABLE.has(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is neither a loader module-table row nor inline-safe. `
        + 'Collaborate through a cordis service, or import it type-only.',
      )
    },
  }, {
    name: 'devflow-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return CSS_PREFIX + fileURLToPath(new URL(source, pathToFileURL(importer))) + CSS_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_PREFIX)) return null
      const fileId = virtualId.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      // The virtual id would otherwise hide the real stylesheet from the watch graph.
      this.addWatchFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: await readFile(fileId),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exported] of Object.entries(cssExports ?? {}).sort()) {
        classMap[local] = exported.name
      }
      return styleModule(pluginId, fileId, code.toString(), classMap)
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
}))
