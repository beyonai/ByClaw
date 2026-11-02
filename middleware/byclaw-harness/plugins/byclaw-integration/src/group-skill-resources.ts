/** Per-member Skill copies; scoped file APIs restrict access and writes. */
import { createHash } from 'node:crypto'
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { canonicalRuntimePath, isPathWithin } from '@byclaw/dsh-agent-teams'

/** The DSH home this context runs under: explicit config, else `DSH_HOME`, else `~/.dsh`. */
export function resolveByClawDshHome(configured?: string): string {
  return configured?.trim() || process.env['DSH_HOME']?.trim() || join(homedir(), '.dsh')
}

export function memberSkillProjectionRoot(dshHome?: string): string {
  const home = resolveByClawDshHome(dshHome)
  return canonicalRuntimePath(join(dirname(resolve(home)), '.byclaw-member-skills'))
}

export function memberSkillRoot(agentId: string, dshHome?: string): string {
  const home = resolveByClawDshHome(dshHome)
  const identity = createHash('sha256').update(JSON.stringify([canonicalRuntimePath(home), agentId])).digest('hex')
  return join(memberSkillProjectionRoot(home), identity)
}

interface ResourceDefinition { name: string; path?: string; resourceBase?: { kind: 'directory'; path: string } }
const projections = new Map<string, Promise<string>>()
const activeRoots = new Map<string, string[]>()

/** Future tool calls see only the current effective view; old copies carry no authority. */
export function setActiveMemberSkillRoots(agentId: string, roots: readonly string[], dshHome?: string): void {
  const own = memberSkillRoot(agentId, dshHome)
  const canonical = roots.map(canonicalRuntimePath)
  if (canonical.some(root => root === own || !isPathWithin(root, own))) throw new Error('Member Skill view must be contained in its own version directory')
  activeRoots.set(agentId, [...new Set(canonical)])
}
export function activeMemberSkillRoots(agentId: string): readonly string[] { return activeRoots.get(agentId) ?? [] }
export function revokeMemberSkillRoots(agentId: string): void { activeRoots.delete(agentId) }

async function ownerOnlyTree(root: string): Promise<void> {
  const stats = await lstat(root)
  if (stats.isDirectory()) {
    for (const entry of await readdir(root)) await ownerOnlyTree(join(root, entry))
    await chmod(root, 0o700)
  } else await chmod(root, (stats.mode & 0o100) | 0o600)
}

/** Copy only an effective Skill directory. No employee/catalog metadata or escaping symlink is copied. */
export async function projectMemberSkill<T extends ResourceDefinition>(agentId: string, definition: T, revision: string, dshHome?: string): Promise<T> {
  const source = definition.resourceBase?.path
  if (source === undefined) return structuredClone(definition)
  const cacheMetadata = await readFile(join(source, '.byclaw-hub-skill.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return ''
  })
  const version = createHash('sha256').update(JSON.stringify([definition.name, source, revision, cacheMetadata])).digest('hex')
  const target = join(memberSkillRoot(agentId, dshHome), version)
  let projection = projections.get(target)
  if (projection === undefined) {
    projection = (async () => {
      const sourceRoot = await realpath(source)
      const staging = `${target}.preparing`
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      // A completed deterministic copy survives restarts; a partial copy never becomes visible as a Skill.
      try { if ((await lstat(target)).isDirectory()) return target } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rm(staging, { recursive: true, force: true })
      try {
        await cp(sourceRoot, staging, { recursive: true, dereference: true, errorOnExist: true, force: false,
          filter: async path => {
            const name = path.slice(path.lastIndexOf('/') + 1)
            if (name === '.git' || name.startsWith('.byclaw-')) return false
            const resolved = await realpath(path)
            if (!isPathWithin(resolved, sourceRoot)) throw new Error('Group member Skill resource symlink escapes its effective Skill directory')
            const stats = await lstat(path)
            if (!stats.isDirectory() && !stats.isFile() && !stats.isSymbolicLink()) throw new Error('Group member Skill resources must be regular files or contained symlinks')
            return true
          } })
        await ownerOnlyTree(staging)
        await rename(staging, target)
        return target
      } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
    })()
    projections.set(target, projection)
    projection.catch(() => { if (projections.get(target) === projection) projections.delete(target) })
  }
  const published = await projection
  return { ...structuredClone(definition), path: join(published, 'SKILL.md'), resourceBase: { kind: 'directory', path: published } }
}
