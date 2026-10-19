import { describe, expect, it } from 'vitest'
import type { Capability } from '../src/capability.ts'
import {
  cpuCount,
  oomCounterKind,
  probeHost,
  readAvailableBytes,
  readCgroupCurrentBytes,
  readMemAvailableBytes,
  readOomCounter,
} from '../src/capability-io.ts'
import {
  formatIdentity,
  isIdentityAlive,
  parseIdentity,
  readBootId,
  readStartTime,
} from '../src/file-lock-io.ts'

const capability = (overrides: Partial<Capability> = {}): Capability => ({
  version: 'v2',
  cgroupPath: '/sys/fs/cgroup',
  memoryLimitBytes: undefined,
  cgroupWritable: false,
  oomGroup: false,
  oomCounterReadable: true,
  tier: 'C',
  degraded: ['no-limit'],
  ...overrides,
})

/** Reader over a synthetic path → contents map. */
const reader = (files: Record<string, string>) => (path: string) => files[path]

describe('readMemAvailableBytes', () => {
  it('converts the kB figure to bytes', () => {
    const read = reader({ '/proc/meminfo': 'MemTotal: 22581572 kB\nMemAvailable: 20088988 kB\n' })
    expect(readMemAvailableBytes(read)).toBe(20088988 * 1024)
  })

  it('returns undefined when the field or the file is absent', () => {
    expect(readMemAvailableBytes(reader({ '/proc/meminfo': 'MemTotal: 100 kB\n' }))).toBeUndefined()
    expect(readMemAvailableBytes(reader({}))).toBeUndefined()
  })
})

describe('readCgroupCurrentBytes', () => {
  it('reads memory.current on v2', () => {
    const read = reader({ '/sys/fs/cgroup/memory.current': '995155968\n' })
    expect(readCgroupCurrentBytes(capability(), read)).toBe(995155968)
  })

  it('reads memory.usage_in_bytes on v1', () => {
    const read = reader({ '/cg/memory.usage_in_bytes': '12345\n' })
    expect(readCgroupCurrentBytes(capability({ version: 'v1', cgroupPath: '/cg' }), read)).toBe(12345)
  })

  it('returns undefined without a cgroup path or hierarchy', () => {
    expect(readCgroupCurrentBytes(capability({ version: 'none', cgroupPath: undefined }), reader({})))
      .toBeUndefined()
  })
})

describe('readAvailableBytes', () => {
  it('uses limit minus current when a ceiling exists', () => {
    const read = reader({ '/sys/fs/cgroup/memory.current': String(1024) })
    expect(readAvailableBytes(capability({ memoryLimitBytes: 4096 }), read)).toBe(3072)
  })

  it('clamps to zero when usage exceeds the limit', () => {
    // A cgroup can momentarily report usage above its own limit; a negative
    // figure would otherwise flow into parallelism derivation.
    const read = reader({ '/sys/fs/cgroup/memory.current': String(8192) })
    expect(readAvailableBytes(capability({ memoryLimitBytes: 4096 }), read)).toBe(0)
  })

  it('falls back to the whole limit when current is unreadable', () => {
    expect(readAvailableBytes(capability({ memoryLimitBytes: 4096 }), reader({}))).toBe(4096)
  })

  it('falls back to host MemAvailable when there is no ceiling', () => {
    const read = reader({ '/proc/meminfo': 'MemAvailable: 1024 kB\n' })
    expect(readAvailableBytes(capability(), read)).toBe(1024 * 1024)
  })

  it('returns undefined when nothing at all is readable', () => {
    expect(readAvailableBytes(capability(), reader({}))).toBeUndefined()
  })
})

describe('readOomCounter', () => {
  it('reads oom_kill from memory.events on v2', () => {
    const read = reader({ '/sys/fs/cgroup/memory.events': 'max 3\noom_kill 7\n' })
    expect(readOomCounter(capability(), read)).toBe(7)
  })

  it('reads failcnt on v1', () => {
    const read = reader({ '/cg/memory.failcnt': '4\n' })
    expect(readOomCounter(capability({ version: 'v1', cgroupPath: '/cg' }), read)).toBe(4)
  })

  it('returns undefined when unreadable', () => {
    expect(readOomCounter(capability(), reader({}))).toBeUndefined()
  })
})

describe('oomCounterKind', () => {
  it('names the counter so its strength can be disclosed', () => {
    expect(oomCounterKind(capability())).toBe('v2-oom-kill')
    expect(oomCounterKind(capability({ version: 'v1' }))).toBe('v1-failcnt')
    expect(oomCounterKind(capability({ oomCounterReadable: false }))).toBe('none')
  })
})

describe('probeHost on this machine', () => {
  const probed = probeHost()

  it('produces a coherent snapshot without throwing', () => {
    expect(['v2', 'v1', 'none']).toContain(probed.version)
    expect(['A', 'B', 'C']).toContain(probed.tier)
  })

  it('degrades rather than throwing on a mount point that does not exist', () => {
    const missing = probeHost('/nonexistent-cgroup-mount')
    expect(missing.version).toBe('none')
    expect(missing.tier).toBe('C')
    expect(missing.degraded).toContain('no-cgroup')
  })

  it('reports no-limit on a container with no memory ceiling', () => {
    // True of the current worker; on a limited host this asserts the converse.
    if (probed.memoryLimitBytes === undefined) {
      expect(probed.degraded).toContain('no-limit')
      expect(probed.tier).toBe('C')
    } else {
      expect(probed.degraded).not.toContain('no-limit')
    }
  })

  it('does not claim a writable cgroup on a read-only cgroupfs', () => {
    if (!probed.cgroupWritable) expect(probed.tier).not.toBe('A')
  })
})

describe('cpuCount', () => {
  it('reports at least one CPU', () => {
    expect(cpuCount()).toBeGreaterThanOrEqual(1)
  })
})

describe('lock identity', () => {
  const parse = (content: string) => parseIdentity(content)

  it('round-trips through format and parse', () => {
    const identity = { bootId: 'abc-123', pid: 4242, startTime: '99887766' }
    expect(parse(formatIdentity(identity))).toEqual(identity)
  })

  it('rejects malformed content', () => {
    expect(parse('')).toBeUndefined()
    expect(parse('only-two fields')).toBeUndefined()
    expect(parse('boot notanumber 123')).toBeUndefined()
    expect(parse('boot 0 123')).toBeUndefined()
  })

  it('reads a start time past a comm field containing spaces and parentheses', () => {
    // /proc/<pid>/stat field 2 is the executable name and may contain both, so
    // naive whitespace splitting would land on the wrong field. Each token
    // after the comm is labelled with its own field number, so a misindexed
    // read returns a number that names the field it wrongly landed on.
    const tokens = Array.from({ length: 30 }, (_, i) => String(i + 3))
    const stat = `4242 (weird name (x) ) ${tokens.join(' ')}`
    expect(readStartTime(4242, () => stat)).toBe('22')
  })

  it('reads a start time from this process\'s real /proc entry', () => {
    // Guards the field arithmetic against the live kernel format, not just a
    // hand-written fixture.
    if (process.platform !== 'linux') return
    const startTime = readStartTime(process.pid)
    expect(startTime).toMatch(/^\d+$/)
    expect(Number(startTime)).toBeGreaterThan(0)
  })

  it('distinguishes two different live processes by start time', () => {
    if (process.platform !== 'linux') return
    // pid 1 was started at boot; this process was not. Equal start times would
    // mean the field arithmetic is reading something constant instead.
    const self = readStartTime(process.pid)
    const init = readStartTime(1)
    expect(self).toBeDefined()
    expect(init).toBeDefined()
    expect(self).not.toBe(init)
  })

  it('returns undefined for a process that is gone', () => {
    expect(readStartTime(4242, () => { throw new Error('ENOENT') })).toBeUndefined()
  })

  it('falls back to a sentinel boot id when unreadable', () => {
    expect(readBootId(() => { throw new Error('ENOENT') })).toBe('unknown')
  })
})

describe('isIdentityAlive', () => {
  const boot = 'boot-a'

  it('is alive when pid and start time both match', () => {
    expect(isIdentityAlive('boot-a 100 5000', boot, () => '5000')).toBe(true)
  })

  it('is dead when the process is gone', () => {
    expect(isIdentityAlive('boot-a 100 5000', boot, () => undefined)).toBe(false)
  })

  it('is dead when the pid was recycled by a different process', () => {
    // The whole reason the identity carries a start time: a recycled pid would
    // otherwise make a stale lock look alive forever.
    expect(isIdentityAlive('boot-a 100 5000', boot, () => '9999')).toBe(false)
  })

  it('is dead when the lock predates this boot', () => {
    expect(isIdentityAlive('boot-old 100 5000', boot, () => '5000')).toBe(false)
  })

  it('is dead when the content is malformed, so the slot is not retired', () => {
    expect(isIdentityAlive('garbage', boot, () => '5000')).toBe(false)
  })

  it('ignores the boot check when this boot id is unknown', () => {
    expect(isIdentityAlive('boot-old 100 5000', 'unknown', () => '5000')).toBe(true)
  })
})
