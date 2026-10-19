/**
 * A module table for the harness's client bundles, so specs can use the real
 * ones instead of doubles.
 *
 * A harness client package publishes its browser half as a loader-factory
 * artifact, not an ESM module:
 *
 *     window.__ModuleLoader__.load({ id, factory: (require) => { ...; return module.exports } })
 *
 * Importing that file gets you an empty namespace and a `window` reference at
 * module scope. The harness runs these in a browser, handing each factory a
 * `require` backed by its own table of shared singletons. This file is that
 * table, small enough to serve the bundles this plugin actually touches.
 *
 * The table's entries are imported statically so Vite resolves them, which is
 * what keeps React one instance across the boundary: a `createRequire` here
 * would hand the factory a second copy and every hook would throw.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as cordis from '@deepseek-ai/cordis'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as store from '@deepseek-ai/dsh-client-store'
import * as react from 'react'
import * as reactJsxRuntime from 'react/jsx-runtime'
import * as reactDom from 'react-dom'
import * as reactDomClient from 'react-dom/client'

/** One factory's registration, as the artifact hands it to the loader. */
interface FactoryRegistration {
  id: string
  factory: (require: (specifier: string) => unknown) => unknown
}

/**
 * Specifiers served from ordinary modules. These are the shell's shared
 * singletons; a duplicate of any of them breaks the thing it is a singleton
 * for, which is why the harness shares rather than bundles them.
 */
const STATIC_TABLE: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['@deepseek-ai/cordis', cordis],
  ['@deepseek-ai/dsh-client-ui-slots', slots],
  ['@deepseek-ai/dsh-client-ui-primitives', primitives],
  ['@deepseek-ai/dsh-client-store', store],
  ['react', react],
  ['react/jsx-runtime', reactJsxRuntime],
  ['react-dom', reactDom],
  ['react-dom/client', reactDomClient],
])

const resolved = new Map<string, unknown>()
const require = createRequire(import.meta.url)

/**
 * Absolute path of one package's published browser bundle.
 * @param specifier - the `<package>/client` specifier.
 * @returns the artifact path.
 */
export function clientBundlePath(specifier: string): string {
  const packageName = specifier.slice(0, -'/client'.length)
  // Resolved through the manifest, not the file: `exports` maps `./client` to
  // the artifact but does not expose `./lib/client.js` as a subpath.
  return join(dirname(require.resolve(`${packageName}/package.json`)), 'lib', 'client.js')
}

/**
 * Run one client bundle's factory and return what it exported, resolving its
 * own requires through this table — recursively, because a client bundle may
 * require another one.
 * @param specifier - the `<package>/client` specifier.
 * @returns the factory's exports.
 * @throws {Error} when a bundle requires something the table cannot answer,
 *   which in a browser would be the same failure at boot.
 */
export function loadClientBundle(specifier: string): unknown {
  const cached = resolved.get(specifier)
  if (cached !== undefined) return cached

  let registration: FactoryRegistration | undefined
  const loader = { load: (entry: FactoryRegistration) => { registration = entry } }
  // The artifact's only statement reads `window.__ModuleLoader__`, so it is
  // evaluated with `window` bound rather than assigned onto a global that a
  // parallel suite might also be using.
  const evaluate = new Function('window', readFileSync(clientBundlePath(specifier), 'utf8')) as
    (globals: { __ModuleLoader__: typeof loader }) => void
  evaluate({ __ModuleLoader__: loader })
  if (registration === undefined) throw new Error(`${specifier}: not a loader-factory bundle`)

  const exports = registration.factory((request) => {
    const fromTable = STATIC_TABLE.get(request)
    if (fromTable !== undefined) return fromTable
    if (request.endsWith('/client')) return loadClientBundle(request)
    throw new Error(
      `${specifier} requires "${request}", which the module table does not serve. `
      + 'Add it to STATIC_TABLE if the harness shares it, or this bundle would fail in a browser too.',
    )
  })
  resolved.set(specifier, exports)
  return exports
}

/**
 * Export names one bundle assigns, read from the artifact rather than from a
 * list kept in step by hand.
 * @param specifier - the `<package>/client` specifier.
 * @returns the exported names, sorted.
 */
export function clientBundleExports(specifier: string): string[] {
  const source = readFileSync(clientBundlePath(specifier), 'utf8')
  const names = new Set<string>()
  for (const match of source.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return [...names].sort()
}
