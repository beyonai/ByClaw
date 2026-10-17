/** Report whether this dsh sandbox is busy or releasable to a shared Redis Stream. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { createRedis } from '@byclaw/by-framework'
import { hostname } from 'node:os'
import { computeActivity } from './activity.ts'
import { observeActivity } from './observe.ts'
import { IdleReporter } from './reporter.ts'

export { computeActivity, type Activity, type ActivityFacts, type AgentFact } from './activity.ts'
export { observeActivity, type ActivityObservation } from './observe.ts'
export {
  IdleReporter,
  type IdleReporterOptions,
  type ReporterLogger,
  type ReporterScheduler,
  type ReporterState,
  type StreamClient,
} from './reporter.ts'

export const DEFAULT_STREAM_KEY = 'byclaw:dsh:sandbox:activity'
export const DEFAULT_MAX_LEN = 10_000
export const DEFAULT_IDLE_TIMEOUT_MS = 1_800_000
export const DEFAULT_HEARTBEAT_MS = 30_000

/** Stable Cordis plugin name; also the patch row id. */
export const name = 'byclaw-idle-reporter'

/** Jobs are optional and observed when present. */
export const inject = ['agents']

export interface Config {
  /** Sandbox identity; the patch passes `BYAI_WORKER_ID`, falling back to `os.hostname()`. */
  sandboxId?: string
  /** Owner of the sandbox (`USER_CODE`); empty when unknown. */
  userCode?: string
  streamKey?: string
  /** Approximate Stream cap (`XADD MAXLEN ~`). */
  maxLen?: number
  /** Idle time after which the sandbox is releasable. */
  idleTimeoutMs?: number
  heartbeatMs?: number
}

export const Config: z<Config> = z.object({
  sandboxId: z.string(),
  userCode: z.string().default(''),
  streamKey: z.string().default(DEFAULT_STREAM_KEY),
  maxLen: z.number().default(DEFAULT_MAX_LEN),
  idleTimeoutMs: z.number().default(DEFAULT_IDLE_TIMEOUT_MS),
  heartbeatMs: z.number().default(DEFAULT_HEARTBEAT_MS),
})

export interface ResolvedConfig {
  sandboxId: string
  userCode: string
  streamKey: string
  maxLen: number
  idleTimeoutMs: number
  heartbeatMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate the schemastery output by hand: `z.object` admits missing fields,
 * and `!!js Number(process.env.X)` can produce `NaN`, which `z.number()` accepts.
 * @param raw - plugin config as received.
 * @param defaultSandboxId - identity used when none is configured.
 * @returns the resolved config.
 * @throws Error naming the offending config key.
 */
export function resolveConfig(raw: unknown, defaultSandboxId: string = hostname()): ResolvedConfig {
  const config = isRecord(raw) ? raw : {}
  const text = (key: string, fallback: string): string => {
    const value = config[key] ?? fallback
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${name}: config.${key} must be a non-empty string, got ${JSON.stringify(value)}`)
    }
    return value
  }
  const optionalText = (key: string): string => {
    const value = config[key] ?? ''
    if (typeof value !== 'string') {
      throw new Error(`${name}: config.${key} must be a string, got ${JSON.stringify(value)}`)
    }
    return value.trim()
  }
  const positive = (key: string, fallback: number): number => {
    const value = config[key] ?? fallback
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name}: config.${key} must be a positive integer, got ${typeof value === 'number' ? String(value) : JSON.stringify(value)}`)
    }
    return value
  }
  return {
    sandboxId: text('sandboxId', defaultSandboxId),
    userCode: optionalText('userCode'),
    streamKey: text('streamKey', DEFAULT_STREAM_KEY),
    maxLen: positive('maxLen', DEFAULT_MAX_LEN),
    idleTimeoutMs: positive('idleTimeoutMs', DEFAULT_IDLE_TIMEOUT_MS),
    heartbeatMs: positive('heartbeatMs', DEFAULT_HEARTBEAT_MS),
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Redis = ReturnType<typeof createRedis>

const QUIT_WAIT_MS = 1_000

/** Let an in-flight append finish briefly, then drop the connection regardless. */
async function closeRedis(redis: Redis): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      redis.quit().catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, QUIT_WAIT_MS) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    redis.disconnect()
  }
}

/**
 * Mount the reporter. Misconfiguration and Redis construction failures log one
 * error and leave the plugin inert: a reporting side channel must never stop
 * dsh from starting.
 */
export function apply(ctx: Context, config: Config): void {
  let resolved: ResolvedConfig
  try {
    resolved = resolveConfig(config)
  } catch (error: unknown) {
    ctx.logger.error(`${errorText(error)}; idle reporting disabled`)
    return
  }
  let redis: Redis
  try {
    redis = createRedis()
  } catch (error: unknown) {
    ctx.logger.error(`Redis client unavailable; idle reporting disabled: ${errorText(error)}`)
    return
  }
  // ioredis reports every failed reconnect here; log once per outage.
  let connectionFailing = false
  redis.on('error', (error: unknown) => {
    if (connectionFailing) return
    connectionFailing = true
    ctx.logger.warn(`Redis connection error; reconnecting: ${errorText(error)}`)
  })
  redis.on('ready', () => { connectionFailing = false })

  // `observeActivity` may report a change synchronously (an already-present
  // jobs service), before the reporter exists.
  let current: IdleReporter | undefined
  const observation = observeActivity(ctx, () => { current?.changed() })
  const reporter = new IdleReporter({
    redis,
    ...resolved,
    activity: () => computeActivity(observation.facts()),
    whenIdle: () => observation.whenIdle(),
    logger: ctx.logger,
  })
  current = reporter
  ctx.effect(() => {
    reporter.start()
    ctx.logger.info(`reporting sandbox ${resolved.sandboxId} to ${resolved.streamKey} (idle timeout ${resolved.idleTimeoutMs} ms, heartbeat ${resolved.heartbeatMs} ms)`)
    return async () => {
      reporter.close()
      await closeRedis(redis)
    }
  }, 'byclaw-idle-reporter.lifecycle')
}
