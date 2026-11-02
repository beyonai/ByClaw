import { describe, expect, it } from 'vitest'
import {
  type CapabilityProbeIo,
  type CgroupVersion,
  V1_UNLIMITED_FLOOR,
  deriveTier,
  parseMemoryEvents,
  parseSelfCgroup,
  parseV1MemoryLimit,
  parseV2MemoryMax,
  probeCapability,
  resolveCgroupDir,
} from '../src/capability.ts'

/** Build a probe IO over a synthetic path → contents map, so no real cgroupfs is touched. */
function io(
  files: Record<string, string>,
  options: { version?: CgroupVersion; writable?: boolean } = {},
): CapabilityProbeIo {
  return {
    readFile: path => files[path],
    canCreateSubCgroup: () => options.writable ?? false,
    cgroupVersion: () => options.version ?? 'v2',
  }
}

describe('parseSelfCgroup', () => {
  it('reads the v2 unified line', () => {
    expect(parseSelfCgroup('0::/')).toBe('/')
    expect(parseSelfCgroup('0::/docker/abc123')).toBe('/docker/abc123')
  })

  it('prefers the v2 unified line over v1 controller lines', () => {
    const hybrid = ['12:memory:/docker/v1path', '0::/docker/v2path'].join('\n')
    expect(parseSelfCgroup(hybrid)).toBe('/docker/v2path')
  })

  it('falls back to the v1 memory controller line', () => {
    const v1 = ['12:memory:/docker/abc', '11:cpu,cpuacct:/docker/abc'].join('\n')
    expect(parseSelfCgroup(v1)).toBe('/docker/abc')
  })

  it('ignores v1 lines for other controllers', () => {
    expect(parseSelfCgroup('11:cpu,cpuacct:/docker/abc')).toBeUndefined()
  })

  it('returns undefined for empty or malformed content', () => {
    expect(parseSelfCgroup('')).toBeUndefined()
    expect(parseSelfCgroup('garbage')).toBeUndefined()
    expect(parseSelfCgroup('0::')).toBeUndefined()
  })
})

describe('resolveCgroupDir', () => {
  it('uses the mount point directly for a private namespace', () => {
    expect(resolveCgroupDir('/sys/fs/cgroup', '/')).toBe('/sys/fs/cgroup')
    expect(resolveCgroupDir('/sys/fs/cgroup', undefined)).toBe('/sys/fs/cgroup')
  })

  it('joins the own-path for a host namespace', () => {
    expect(resolveCgroupDir('/sys/fs/cgroup', '/docker/abc')).toBe('/sys/fs/cgroup/docker/abc')
  })
})

describe('parseV2MemoryMax', () => {
  it('treats "max" as no limit', () => {
    expect(parseV2MemoryMax('max')).toBeUndefined()
    expect(parseV2MemoryMax('max\n')).toBeUndefined()
  })

  it('parses a byte count', () => {
    expect(parseV2MemoryMax('8589934592\n')).toBe(8589934592)
  })

  it('rejects unreadable and nonsense values', () => {
    expect(parseV2MemoryMax(undefined)).toBeUndefined()
    expect(parseV2MemoryMax('')).toBeUndefined()
    expect(parseV2MemoryMax('abc')).toBeUndefined()
    expect(parseV2MemoryMax('-1')).toBeUndefined()
  })
})

describe('parseV1MemoryLimit', () => {
  it('parses a real limit', () => {
    expect(parseV1MemoryLimit('8589934592\n')).toBe(8589934592)
  })

  it('treats the unlimited sentinel of every page size as no limit', () => {
    // The sentinel is (LONG_MAX / PAGE_SIZE) * PAGE_SIZE, so it differs per
    // architecture and kernel build. All three must read as "no limit" for the
    // same compiled output to be correct on amd64 and arm64 alike.
    expect(parseV1MemoryLimit('9223372036854771712')).toBeUndefined() // 4 KiB: all amd64, most arm64
    expect(parseV1MemoryLimit('9223372036854759424')).toBeUndefined() // 16 KiB: some arm64
    expect(parseV1MemoryLimit('9223372036854710272')).toBeUndefined() // 64 KiB: arm64 server kernels
    expect(parseV1MemoryLimit(String(V1_UNLIMITED_FLOOR))).toBeUndefined()
  })

  it('does not mistake a large but real limit for the unlimited sentinel', () => {
    // A 1 TiB ceiling is six orders of magnitude below the floor, so no
    // plausible container limit is swallowed by the sentinel check.
    expect(parseV1MemoryLimit(String(2 ** 40))).toBe(2 ** 40)
    expect(parseV1MemoryLimit(String(V1_UNLIMITED_FLOOR - 1))).toBe(V1_UNLIMITED_FLOOR - 1)
  })

  it('rejects unreadable and nonsense values', () => {
    expect(parseV1MemoryLimit(undefined)).toBeUndefined()
    expect(parseV1MemoryLimit('')).toBeUndefined()
    expect(parseV1MemoryLimit('0')).toBeUndefined()
  })
})

describe('parseMemoryEvents', () => {
  const events = 'low 0\nhigh 0\nmax 12\noom 3\noom_kill 2\n'

  it('reads the requested counter', () => {
    expect(parseMemoryEvents(events, 'oom_kill')).toBe(2)
    expect(parseMemoryEvents(events, 'max')).toBe(12)
  })

  it('returns undefined for an absent key or unreadable file', () => {
    expect(parseMemoryEvents(events, 'oom_group_kill')).toBeUndefined()
    expect(parseMemoryEvents(undefined, 'oom_kill')).toBeUndefined()
  })
})

describe('deriveTier', () => {
  const base = {
    version: 'v2' as const,
    memoryLimitBytes: 8589934592,
    cgroupWritable: false,
    oomGroup: false,
    oomCounterReadable: true,
    hostNamespaceUnresolved: false,
  }

  it('B when a limit exists and OOM kills individual processes', () => {
    expect(deriveTier(base)).toEqual({ tier: 'B', degraded: [] })
  })

  it('A when the cgroup is writable', () => {
    expect(deriveTier({ ...base, cgroupWritable: true })).toEqual({ tier: 'A', degraded: [] })
  })

  it('C with no-limit when no ceiling is known', () => {
    expect(deriveTier({ ...base, memoryLimitBytes: undefined }))
      .toEqual({ tier: 'C', degraded: ['no-limit'] })
  })

  it('C with oom-group even when a limit exists and the cgroup is writable', () => {
    expect(deriveTier({ ...base, cgroupWritable: true, oomGroup: true }))
      .toEqual({ tier: 'C', degraded: ['oom-group'] })
  })

  it('reports every applicable reason at once', () => {
    expect(deriveTier({
      ...base,
      memoryLimitBytes: undefined,
      oomGroup: true,
      hostNamespaceUnresolved: true,
    })).toEqual({
      tier: 'C',
      degraded: ['no-limit', 'oom-group', 'cgroupns-host-unresolved'],
    })
  })

  it('C with no-cgroup when there is no hierarchy', () => {
    const result = deriveTier({ ...base, version: 'none', memoryLimitBytes: undefined })
    expect(result.tier).toBe('C')
    expect(result.degraded).toContain('no-cgroup')
  })
})

describe('probeCapability across deployment shapes', () => {
  it('k8s Pod with resources.limits.memory -> tier B', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/',
      '/sys/fs/cgroup/memory.max': '4294967296\n',
      '/sys/fs/cgroup/memory.oom.group': '0\n',
      '/sys/fs/cgroup/memory.events': 'oom_kill 0\n',
    }))
    expect(result.tier).toBe('B')
    expect(result.degraded).toEqual([])
    expect(result.memoryLimitBytes).toBe(4294967296)
    expect(result.oomCounterReadable).toBe(true)
  })

  it('docker with -m under a private namespace -> tier B', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/',
      '/sys/fs/cgroup/memory.max': '2147483648\n',
      '/sys/fs/cgroup/memory.oom.group': '0\n',
      '/sys/fs/cgroup/memory.events': 'oom_kill 0\n',
    }))
    expect(result.tier).toBe('B')
    expect(result.memoryLimitBytes).toBe(2147483648)
  })

  it('docker without -m -> tier C, no-limit', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/',
      '/sys/fs/cgroup/memory.max': 'max\n',
      '/sys/fs/cgroup/memory.oom.group': '0\n',
      '/sys/fs/cgroup/memory.events': 'oom_kill 0\n',
    }))
    expect(result.tier).toBe('C')
    expect(result.degraded).toEqual(['no-limit'])
  })

  it('cgroupns=host reads the container path, not the mount root', () => {
    // The host root says "max"; the container's own directory carries the real
    // limit. Reading the root would wrongly report an unlimited container.
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/docker/abc123',
      '/sys/fs/cgroup/memory.max': 'max\n',
      '/sys/fs/cgroup/docker/abc123/memory.max': '1073741824\n',
      '/sys/fs/cgroup/docker/abc123/memory.oom.group': '0\n',
      '/sys/fs/cgroup/docker/abc123/memory.events': 'oom_kill 0\n',
    }))
    expect(result.cgroupPath).toBe('/sys/fs/cgroup/docker/abc123')
    expect(result.memoryLimitBytes).toBe(1073741824)
    expect(result.tier).toBe('B')
    expect(result.degraded).toEqual([])
  })

  it('cgroupns=host whose own-path does not resolve is reported, not silently unlimited', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/docker/missing',
      '/sys/fs/cgroup/memory.max': 'max\n',
    }))
    expect(result.tier).toBe('C')
    expect(result.degraded).toContain('cgroupns-host-unresolved')
    expect(result.degraded).toContain('no-limit')
  })

  it('cgroup v1 with a limit -> tier B', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '12:memory:/docker/abc',
      '/sys/fs/cgroup/docker/abc/memory.limit_in_bytes': '2147483648\n',
      '/sys/fs/cgroup/docker/abc/memory.failcnt': '0\n',
    }, { version: 'v1' }))
    expect(result.version).toBe('v1')
    expect(result.memoryLimitBytes).toBe(2147483648)
    expect(result.oomGroup).toBeUndefined()
    expect(result.oomCounterReadable).toBe(true)
    expect(result.tier).toBe('B')
  })

  it('cgroup v1 unlimited sentinel -> tier C, no-limit', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '12:memory:/docker/abc',
      '/sys/fs/cgroup/docker/abc/memory.limit_in_bytes': '9223372036854771712\n',
      '/sys/fs/cgroup/docker/abc/memory.failcnt': '0\n',
    }, { version: 'v1' }))
    expect(result.tier).toBe('C')
    expect(result.degraded).toEqual(['no-limit'])
  })

  it('privileged docker with a writable cgroup -> tier A', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/',
      '/sys/fs/cgroup/memory.max': '8589934592\n',
      '/sys/fs/cgroup/memory.oom.group': '0\n',
      '/sys/fs/cgroup/memory.events': 'oom_kill 0\n',
    }, { writable: true }))
    expect(result.tier).toBe('A')
    expect(result.cgroupWritable).toBe(true)
  })

  it('memory.oom.group=1 forces tier C even with a limit', () => {
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/',
      '/sys/fs/cgroup/memory.max': '4294967296\n',
      '/sys/fs/cgroup/memory.oom.group': '1\n',
      '/sys/fs/cgroup/memory.events': 'oom_kill 0\n',
    }))
    expect(result.tier).toBe('C')
    expect(result.degraded).toEqual(['oom-group'])
    expect(result.oomGroup).toBe(true)
  })

  it('degrades instead of throwing when the filesystem itself errors', () => {
    // The blast-radius guarantee. This probe runs inside the Bash provider's
    // constructor, so anything it lets escape takes the whole shell surface
    // down with it — for an optional feature. Degrading costs only the guard.
    const hostile: CapabilityProbeIo = {
      readFile: () => { throw new Error('EIO') },
      canCreateSubCgroup: () => { throw new Error('EPERM') },
      cgroupVersion: () => { throw new Error('unreadable mount') },
    }
    const result = probeCapability(hostile)
    expect(result.tier).toBe('C')
    expect(result.degraded).toContain('no-cgroup')
    expect(result.cgroupPath).toBeUndefined()
  })

  it('degrades when only a later probe step throws', () => {
    const partial: CapabilityProbeIo = {
      readFile: path => path === '/proc/self/cgroup' ? '0::/' : (() => { throw new Error('EIO') })(),
      canCreateSubCgroup: () => false,
      cgroupVersion: () => 'v2',
    }
    expect(probeCapability(partial).tier).toBe('C')
  })

  it('no cgroup hierarchy at all degrades instead of throwing', () => {
    const result = probeCapability(io({}, { version: 'none' }))
    expect(result.tier).toBe('C')
    expect(result.degraded).toContain('no-cgroup')
    expect(result.cgroupPath).toBeUndefined()
  })

  it('this container: cgroupfs readable but no limit -> tier C', () => {
    // Mirrors the recorded phase-0 baseline of the current coderfleet worker.
    const result = probeCapability(io({
      '/proc/self/cgroup': '0::/',
      '/sys/fs/cgroup/memory.max': 'max\n',
      '/sys/fs/cgroup/memory.oom.group': '0\n',
      '/sys/fs/cgroup/memory.events': 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n',
    }))
    expect(result.tier).toBe('C')
    expect(result.degraded).toEqual(['no-limit'])
    expect(result.oomCounterReadable).toBe(true)
  })
})
