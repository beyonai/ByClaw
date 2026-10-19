/**
 * A `cordis.patch.yml` parser for the root specs.
 *
 * Upstream hosts this in `packages/devflow-deploy/tests/`, because `yaml` is
 * that package's devDependency and a root spec had no specifier resolving it.
 * ByClaw does not carry devflow-deploy, so the helper lives here and resolves
 * `js-yaml` from the repository root instead — the same parser
 * `repository-bundle.spec.ts` already uses. No patch in this tree carries a
 * custom tag, so the default schema is sufficient.
 *
 * The result is `unknown` rather than the parser's `any`: a caller that wants
 * structure states it at its own boundary instead of inheriting one from here.
 */

import { load } from 'js-yaml'

/**
 * Parse one patch document.
 * @param source - the file's contents.
 * @returns the parsed value.
 */
export function parsePatchYaml(source: string): unknown {
  return load(source)
}
