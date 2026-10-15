/**
 * Filesystem implementation of the single-host slot lock.
 *
 * The crash-safety property this has to deliver: a slot held by a process that
 * died without releasing must become available again, or the pool silently
 * loses capacity until no build can start. `flock(2)` gets that from the kernel
 * for free, but Node exposes no `flock`, and adding a native binding for it
 * would give this package a per-architecture artifact it currently does not
 * have. So liveness is checked explicitly.
 *
 * ## Why the identity is not just a pid
 *
 * Pids are recycled. If a lock recorded only `12345` and that process died, any
 * unrelated process that later gets pid 12345 would make the stale lock look
 * alive — permanently retiring the slot. The identity therefore also carries the
 * holder's **start time** from `/proc/<pid>/stat` field 22, which is measured in
 * clock ticks since boot: a recycled pid belonging to a different process has a
 * different start time, so the pair identifies one specific process run.
 *
 * A boot id is included too, so lock files surviving on a shared volume across a
 * reboot cannot be mistaken for live holders of the new boot's identical pids.
 *
 * ## Scope
 *
 * Liveness reads `/proc`, so reclaiming a dead holder's slot works on Linux —
 * every deployment target here. Elsewhere, an existing lock is conservatively
 * treated as live, which degrades to "this slot stays taken until released
 * cleanly" rather than to over-admission.
 *
 * @module @byclaw/dsh-bash-provider/file-lock-io
 */

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import type { FileLockIo } from './slot-lease.ts'

/** Field index (1-based) of `starttime` in `/proc/<pid>/stat`. */
const STARTTIME_FIELD = 22

/**
 * Read a process's start time in clock ticks since boot.
 *
 * `/proc/<pid>/stat` field 2 is the executable name in parentheses and may
 * itself contain spaces and parentheses, so fields are counted from the last
 * `)` rather than by splitting the whole line.
 *
 * @param pid - the process id.
 * @param read - file reader, injected for tests.
 * @returns the start time, or undefined when the process is gone or unreadable.
 */
export function readStartTime(
  pid: number,
  read: (path: string) => string = path => readFileSync(path, 'utf8'),
): string | undefined {
  let stat: string
  try {
    stat = read(`/proc/${String(pid)}/stat`)
  } catch {
    return undefined
  }
  const afterComm = stat.lastIndexOf(')')
  if (afterComm === -1) return undefined
  // Fields after the comm field start at index 3, so field 22 is offset 19.
  const fields = stat.slice(afterComm + 1).trim().split(/\s+/)
  return fields[STARTTIME_FIELD - 3]
}

/**
 * Read the kernel's boot id, which changes on every boot.
 *
 * @param read - file reader, injected for tests.
 * @returns the boot id, or `unknown` when unavailable.
 */
export function readBootId(
  read: (path: string) => string = path => readFileSync(path, 'utf8'),
): string {
  try {
    return read('/proc/sys/kernel/random/boot_id').trim()
  } catch {
    return 'unknown'
  }
}

/** A parsed lock-file identity. */
export interface LockIdentity {
  readonly bootId: string
  readonly pid: number
  readonly startTime: string
}

/**
 * Render an identity for storage in a lock file.
 *
 * @param identity - the holder's identity.
 * @returns the serialized form.
 */
export function formatIdentity(identity: LockIdentity): string {
  return `${identity.bootId} ${String(identity.pid)} ${identity.startTime}`
}

/**
 * Parse a lock file's contents.
 *
 * @param content - the stored identity.
 * @returns the parsed identity, or undefined when malformed.
 */
export function parseIdentity(content: string): LockIdentity | undefined {
  const [bootId, rawPid, startTime] = content.trim().split(/\s+/)
  if (bootId === undefined || rawPid === undefined || startTime === undefined) return undefined
  const pid = Number(rawPid)
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  return { bootId, pid, startTime }
}

/**
 * Decide whether a stored identity still names a running process.
 *
 * A malformed lock counts as dead: it cannot identify a live holder, and
 * honouring it would retire the slot permanently.
 *
 * @param content - the stored identity.
 * @param currentBootId - this boot's id.
 * @param startTimeOf - start-time lookup, injected for tests.
 * @returns true when the recorded process is still running.
 */
export function isIdentityAlive(
  content: string,
  currentBootId: string,
  startTimeOf: (pid: number) => string | undefined,
): boolean {
  const identity = parseIdentity(content)
  if (identity === undefined) return false
  // A lock from a previous boot cannot be live, whatever pid it names.
  if (identity.bootId !== currentBootId && currentBootId !== 'unknown') return false
  const startTime = startTimeOf(identity.pid)
  if (startTime === undefined) return false
  // Same pid, different start time: the pid was recycled and the holder is gone.
  return startTime === identity.startTime
}

/**
 * Build the production {@link FileLockIo}.
 *
 * @returns filesystem operations bound to this process's identity.
 */
export function createFileLockIo(): FileLockIo {
  const bootId = readBootId()
  const identity = formatIdentity({
    bootId,
    pid: process.pid,
    startTime: readStartTime(process.pid) ?? 'unknown',
  })

  return {
    ensureDir(dir) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch {
        // A missing directory surfaces as a failed create on the next step,
        // which the backend already treats as contention.
      }
    },

    createExclusive(path, content) {
      let fd: number
      try {
        // 'wx' fails when the path exists, which is what makes this atomic.
        fd = openSync(path, 'wx')
      } catch {
        return false
      }
      try {
        writeSync(fd, content)
      } catch {
        // The lock is held either way; an unwritable body only costs the
        // liveness information, and an unparsable lock reads as stale.
      } finally {
        closeSync(fd)
      }
      return true
    },

    read(path) {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return undefined
      }
    },

    remove(path) {
      try {
        unlinkSync(path)
      } catch {
        // Already gone, which is the desired end state.
      }
    },

    isAlive(content) {
      if (process.platform !== 'linux') {
        // No /proc to check against: treat an existing lock as live rather than
        // risk admitting a second builder into one slot.
        return true
      }
      return isIdentityAlive(content, bootId, pid => readStartTime(pid))
    },

    selfIdentity() {
      return identity
    },
  }
}
