/** Real published workspace and session storage for project-scoped entrance tests. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'

/** Install real filesystem storage; the caller owns disposal of the context and root. */
export async function installProjectHost(ctx: Context, root: string): Promise<void> {
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'workspace-storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(WorkspaceRegistry)
}

/** Register an existing directory and create a real session carrying its canonical cwd. */
export async function createProjectSession(ctx: Context, directory: string, id: string, title = 'Project') {
  await mkdir(directory, { recursive: true })
  const project = await ctx.workspaceRegistry.create(directory, title)
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd: project.path } })
  return { project, session }
}
