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
