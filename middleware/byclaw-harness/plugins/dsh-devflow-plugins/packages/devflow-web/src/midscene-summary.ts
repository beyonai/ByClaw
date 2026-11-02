/** Keep optional diagnostic failures independent of the authoritative card read. */
import type { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevCardDetail } from '@zhchxiao123/dsh-devflow'
import type { DevflowWebRequest, MidsceneSummary } from './types.ts'

const unavailable = (): MidsceneSummary => ({ available: false, profiles: [], jobs: [], gateEngineAvailable: false })

async function project(ctx: Context, sessionId: string, id: string): Promise<MidsceneSummary> {
  try { return await ctx.get('devflowMidsceneSummary')?.read(sessionId, id) ?? unavailable() }
  catch { return unavailable() }
}

/** The same scoped store read guards the standalone endpoint and embedded detail. */
export async function readMidsceneSummary(ctx: Context, request: DevflowWebRequest): Promise<MidsceneSummary> {
  if (!request.id || !request.sessionId) throw new Error('Midscene summary needs a session and card')
  await ctx.devflow.detailForSession(DevflowCardId(request.id), request.sessionId)
  return project(ctx, request.sessionId, request.id)
}

export async function readDetail(ctx: Context, request: DevflowWebRequest): Promise<DevCardDetail & { midscene?: MidsceneSummary }> {
  if (request.id === undefined) throw new Error('detail needs a card id')
  const detail = await ctx.devflow.detailForSession(DevflowCardId(request.id), request.sessionId)
  if (!request.sessionId || !ctx.get('devflowMidsceneSummary')) return detail
  return { ...detail, midscene: await project(ctx, request.sessionId, request.id) }
}
