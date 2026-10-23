/** Host credential provider backed by the same Redis environment reader as Bash. */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider, type Config as LocalConfig } from '@deepseek-ai/dsh-credentials-local'
import { createRuntimeRedisClient, RedisRuntimeEnvironment } from './index.ts'

/** Local credential config plus the user whose Redis references resolve (defaults to `USER_CODE`). */
export type Config = LocalConfig & { userCode?: string }

/** Resolve Redis references for host plugins while retaining the original credential store and metadata-only descriptions. */
export default class ByClawCredentialProvider extends LocalCredentialProvider {
  private readonly runtimeEnvironment: RedisRuntimeEnvironment
  private readonly userCode: string

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.userCode = config.userCode ?? process.env['USER_CODE'] ?? ''
    this.runtimeEnvironment = new RedisRuntimeEnvironment({
      createClient: createRuntimeRedisClient,
      logger: ctx.logger,
    })
    ctx.effect(() => () => this.runtimeEnvironment.close(), 'byclaw-credentials.redis-runtime')
  }

  private async redisValue(ref: CredentialRef): Promise<string | undefined> {
    await this.runtimeEnvironment.refresh(this.userCode)
    const value = this.runtimeEnvironment.current()[ref]
    return value !== undefined && value.length > 0 ? value : undefined
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = await this.redisValue(ref)
    return value === undefined ? super.resolve(ref) : { value, source: 'redis' }
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    return await this.redisValue(ref) === undefined
      ? super.describe(ref)
      : { configured: true, source: 'redis', writable: false }
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    await this.assertRedisUnshadowed(ref)
    await super.set(ref, value)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    await this.assertRedisUnshadowed(ref)
    await super.unset(ref)
  }

  private async assertRedisUnshadowed(ref: CredentialRef): Promise<void> {
    if (await this.redisValue(ref) !== undefined) {
      throw new Error(`byclaw-credentials: "${ref}" is supplied by Redis; update the user's private parameters instead`)
    }
  }
}
