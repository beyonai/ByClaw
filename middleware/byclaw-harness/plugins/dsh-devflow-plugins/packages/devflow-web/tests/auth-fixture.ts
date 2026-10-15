/** Non-auth tests declare their trusted authenticated caller; real signed-cookie composition lives in authentication.spec.ts. */
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
export function authenticatedFixture(ctx: Context): void {
  ctx.provide('connection', { requestRejection: () => undefined } as unknown as HostConnectionHandle)
}
