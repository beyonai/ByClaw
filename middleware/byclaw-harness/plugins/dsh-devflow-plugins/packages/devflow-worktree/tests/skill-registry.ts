/**
 * The harness skill registry, re-exported for specs outside this package.
 *
 * `@deepseek-ai/dsh-skill` is a devDependency of this package rather than of
 * the repository root, so a root spec composing the worktree row — which
 * injects `skills` — has no specifier that resolves it. Resolution happens
 * here, where the dependency is declared.
 */

export { default as SkillRegistry } from '@deepseek-ai/dsh-skill'
