import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import * as BrowserPlugin from '../src/index.js'
import type { BrowserSubprocess } from '../src/tool-environment-runtime.js'

class SystemPrompt extends Service {
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }
  tools(): void {}
  section(): void {}
  getSectionOrder(): number { return 0 }
}
class Projections extends Service {
  constructor(ctx: Context) { super(ctx, 'sessionProjections') }
  stateOf(_session: object, key: string): unknown {
    return key === 'turnBoundary' ? { openTurnStartSeq: 1, lastTurn: 1 } : undefined
  }
}
class Ssh extends Service { constructor(ctx: Context) { super(ctx, 'ssh') } }

it('prefers the SSH provider over ownsRuntime, starts lazily and reaps its child on plugin disposal', async () => {
  const root = await mkdtemp('/tmp/brp-')
  const ctx = new Context()
  let spawned = 0
  const children = new Set<ReturnType<typeof spawn>>()
  class Subprocess extends Service {
    constructor(ctx: Context) { super(ctx, 'subprocess') }
    spawn(spec: Parameters<BrowserSubprocess['spawn']>[0]) {
      spawned++
      expect(spec.argv.at(-1)).toMatch(/tool-environment-bridge\.js$/)
      const child = spawn(process.execPath, ['-e', `
        let buffer=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',chunk=>{
          buffer+=chunk; let i; while((i=buffer.indexOf('\\n'))>=0){
            const frame=JSON.parse(buffer.slice(0,i)); buffer=buffer.slice(i+1);
            if(!frame.requestId)continue;
            process.stdout.write(JSON.stringify({type:'ok',requestId:frame.requestId,result:frame.type==='inspect'?{url:'https://example.test/',title:'Remote',text:'test',elements:[]}:{opened:true}})+'\\n');
          }
        }); process.stdin.on('end',()=>process.exit(0));
      `], { stdio: ['pipe', 'pipe', 'pipe'] })
      children.add(child)
      return { stdin: child.stdin, stdout: child.stdout, terminate: () => { child.kill() },
        done: new Promise(resolve => child.once('close', code => { children.delete(child); resolve({ exitCode: code }) })),
      }
    }
  }
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Projections)
    await ctx.plugin(Ssh)
    await ctx.plugin(Subprocess)
    await ctx.plugin(BrowserPlugin, { workspaceOnToolEnvironment: true, ownsRuntime: true,
      runtimeDir: join(root, 'r'), dshHome: join(root, 'h'),
      browserdCommand: ['/this-local-command-must-never-run'],
    })
    expect(spawned).toBe(0)
    const result = await ctx.tools.execute({ callId: 'remote-open' as never, name: 'browser',
      arguments: { operation: 'open' }, agent: { id: 'agent', session: { id: 'session' } } as never,
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ value: { status: 'opened' } })
    expect(spawned).toBe(1)
  } finally {
    await ctx.fiber.dispose()
    await expect.poll(() => children.size, { timeout: 10_000 }).toBe(0)
    await rm(root, { recursive: true, force: true })
  }
})
