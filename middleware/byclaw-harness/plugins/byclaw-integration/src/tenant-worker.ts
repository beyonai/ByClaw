import { AgentState, AnonymousWorker, WorkerRegistry, WorkerRunner, createRedis, type GatewayCommand } from '@byclaw/by-framework'
import type { Context } from '@deepseek-ai/cordis'
import { superviseWorker } from './worker-runtime.ts'
import type { TenantHarnessWorkerIdentity } from './tenant-worker-identity.ts'

const EXECUTION_NOT_ENABLED = 'TENANT_HARNESS_EXECUTION_NOT_ENABLED'

class TenantWorkerRegistry extends WorkerRegistry {
  override async markWorkerInactive(workerId: string, token?: string): Promise<boolean> {
    // An attempt that failed to claim the ID must leave the running instance online.
    return token === undefined ? false : super.markWorkerInactive(workerId, token)
  }
}

class TenantWorkerRunner extends WorkerRunner {
  constructor(worker: AnonymousWorker, redis: ReturnType<typeof createRedis>, private readonly agentType: string) {
    super(worker, { redisClient: redis })
  }

  override async processAndAck(streamName: string, msgId: string, command: GatewayCommand): Promise<void> {
    // A command on the wrong stream must not enter the session or execution registry.
    if (command.header.targetAgentType !== this.agentType) {
      await this.ack(streamName, msgId)
      return
    }
    await super.processAndAck(streamName, msgId, command)
  }
}

export function installTenantHarnessWorker(
  identity: TenantHarnessWorkerIdentity,
  logger: Pick<Context['logger'], 'warn'>,
): () => Promise<void> {
  const tls = process.env.REDIS_TLS
  if (tls !== undefined && tls !== 'true' && tls !== 'false') {
    throw new Error('REDIS_TLS must be true or false')
  }
  const redis = createRedis(tls === 'true' ? { tls: {} } : {})
  const worker = new AnonymousWorker({
    workerId: identity.workerId,
    agentTypes: [identity.agentType],
    registry: new TenantWorkerRegistry(redis),
    redisClient: redis,
    onTask: async (_command, context) => {
      await context.emitState({ state: AgentState.FAILED, metadata: { code: EXECUTION_NOT_ENABLED } })
      throw new Error(EXECUTION_NOT_ENABLED)
    },
  })
  const lifecycle = new AbortController()
  let runner: WorkerRunner | undefined
  const run = superviseWorker(() => {
    const attempt = new TenantWorkerRunner(worker, redis, identity.agentType)
    runner = attempt
    return {
      async start() {
        try {
          await attempt.initialize()
        } catch (error: unknown) {
          await attempt.release().catch(() => undefined)
          throw error
        }
        if (lifecycle.signal.aborted) {
          await attempt.release()
          return
        }
        await attempt.start({ handleSignals: false, initialize: false })
      },
      stop: () => attempt.stop(),
    }
  }, lifecycle.signal, 1_000, () => {
    logger.warn(`[byclaw-dsh] tenant Worker ${identity.workerId} exited; restarting`)
  })

  return async () => {
    lifecycle.abort()
    runner?.stop()
    try {
      await run
    } finally {
      redis.disconnect()
    }
  }
}
