// Minimal `workingDirectory` service for specs that mount the subagent
// runtime. DSH 0.2.1's `SubagentRuntime` injects `workingDirectory` and asks
// it for the parent's directory at start; the production service needs the
// filesystem, projection, and system-prompt services, none of which these
// specs exercise. Mirrors the fixture in DSH's own subagent tests.
import { resolve } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'

/** Loader specifier the composition specs map to this fixture. */
export const WORKING_DIRECTORY_FIXTURE = '@test/working-directory'

/** Session directory owner: the recorded original directory unless a spec moved it. */
export default class WorkingDirectoryFixture extends Service {
  private readonly directories = new WeakMap<Session, string>()

  constructor(ctx: Context) {
    super(ctx, 'workingDirectory')
  }

  get(session: Session): string {
    return this.directories.get(session) ?? session.header.cwd ?? process.cwd()
  }

  ensure(agent: Agent, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return Promise.resolve(this.get(agent.session))
  }

  set(agent: Agent, path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const cwd = resolve(this.get(agent.session), path)
    this.directories.set(agent.session, cwd)
    return Promise.resolve(cwd)
  }
}
