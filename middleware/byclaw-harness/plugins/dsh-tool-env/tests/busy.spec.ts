import { describe, expect, it } from 'vitest'
import { describeResidual, isDshBusy, residualProcesses } from '../src/busy.ts'

describe('isDshBusy', () => {
  it('is busy while an Agent runs a turn or a job runs, idle otherwise', () => {
    const agents = (statuses: string[]) => ({ list: () => statuses.map((status, index) => ({ id: `a${String(index)}`, status })) })
    const jobs = (own: Record<string, string[]>) => ({ list: (owner?: string) => (own[owner ?? ''] ?? []).map((status, index) => ({ id: `j${String(index)}`, status })) })
    expect(isDshBusy(undefined, undefined)).toBe(false)
    expect(isDshBusy(agents(['idle', 'idle']), undefined)).toBe(false)
    expect(isDshBusy(agents(['idle', 'running']), undefined)).toBe(true)
    expect(isDshBusy(agents(['idle']), jobs({ '': ['completed'] }))).toBe(false)
    expect(isDshBusy(agents(['idle']), jobs({ '': ['running'] }))).toBe(true)
    // Jobs owned by an Agent are only visible through that Agent's view.
    expect(isDshBusy(agents(['idle']), jobs({ a0: ['stopping'] }))).toBe(true)
    expect(isDshBusy(agents([]), jobs({ a0: ['running'] }))).toBe(false)
  })
})

describe('residualProcesses', () => {
  it('ignores the shipped workspace SSH helper without hiding user Node processes', () => {
    const output = [
      '  70 node /usr/local/bin/node /workspace/packages/ssh/ssh/lib/helper.js',
      '  76 node /usr/local/bin/node --disable-sigusr1 /workspace/packages/ssh/ssh/lib/helper.js',
      '  77 node /usr/local/bin/node --disable-sigusr1 /by/helper.js',
      '  71 node /usr/local/bin/node /by/helper.js',
      '  72 node /usr/local/bin/node /by/app.js /workspace/packages/ssh/ssh/lib/helper.js',
      '  73 node /usr/local/bin/node /workspace/packages/ssh/ssh/lib/helper.js.user',
      '  74 node /usr/local/bin/node -e console.log("/workspace/packages/ssh/ssh/lib/helper.js")',
      '  75 python3 python3 /workspace/packages/ssh/ssh/lib/helper.js',
    ].join('\n')
    expect(residualProcesses(output, '/workspace/packages/ssh/ssh/lib/helper.js').map(process => process.pid)).toEqual([77, 71, 72, 73, 74, 75])
    expect(residualProcesses('80 node node /opt/runtime/helper.js', '/opt/runtime/helper.js')).toEqual([])
    expect(residualProcesses('81 node node /tmp/helper.js', '/opt/runtime/helper.js').map(process => process.pid)).toEqual([81])
  })

  it('ignores what serves A and the probe itself, keeps what the user left running', () => {
    const output = [
      '   41 sshd            sshd: byclaw@notty',
      '   42 node            /usr/local/bin/node /opt/byclaw/dsh/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js',
      '   43 node            /usr/local/bin/node /opt/byclaw/dsh/node_modules/@deepseek-ai/dsh-ptc-runtime-node/lib/process.js',
      '   50 sh              sh -c ps -u "$(id -un)" -o pid=,comm=,args= 2>/dev/null; : BYCLAW_TOOL_ENV_PROBE',
      '   51 ps              ps -u byclaw -o pid=,comm=,args=',
      '   60 sleep           sleep infinity',
      '   61 python3         python3 server.py --port 8000',
      '',
    ].join('\n')
    const residual = residualProcesses(output)
    expect(residual).toEqual([
      { pid: 60, comm: 'sleep', args: 'sleep infinity' },
      { pid: 61, comm: 'python3', args: 'python3 server.py --port 8000' },
    ])
    expect(describeResidual(residual)).toBe('sleep[60], python3[61]')
    expect(residualProcesses('')).toEqual([])
    expect(residualProcesses('garbage\n')).toEqual([])
  })
})
