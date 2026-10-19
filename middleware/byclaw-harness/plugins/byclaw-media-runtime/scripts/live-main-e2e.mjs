/** Run one real main-agent media acceptance through the selected ByClaw worker. */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { randomInt } from 'node:crypto'
const integrationRoot = resolve(process.env.BYCLAW_INTEGRATION_ROOT ?? '../byclaw-integration')
const require = createRequire(resolve(integrationRoot, 'package.json'))
const { GatewayClient, WorkerRegistry, QueueNames, createRedis } = await import(require.resolve('@byclaw/by-framework'))
const [kind] = process.argv.slice(2)
if (!['image', 'tts'].includes(kind)) throw new Error('usage: live-main-e2e.mjs image|tts')
const userCode = process.env.USER_CODE
if (!userCode) throw new Error('USER_CODE required')
const sessionId = process.env.E2E_SESSION_ID || (((BigInt(Date.now()) - 1704067200000n) << 22n) | BigInt(randomInt(1, 4194304))).toString()
const targetAgentType = process.env.E2E_TARGET_AGENT_TYPE || `BYCLAW_DSH_MEDIA_E2E_${userCode}`
const prompt = kind === 'image'
  ? '这是一项文生图端到端验收。请主 agent 直接调用 image_generate 工具，用当前已指定的 doubao-seedream-5-0-flash-260915 模型生成一张图片：清晨的海边灯塔，柔和金色光线，简洁水彩插画。不要委派给数字员工，不要用代码绘图替代。返回实际文件路径，并确认位于本会话 session_root/image。'
  : '这是一项文本转语音端到端验收。请主 agent 直接调用 text_to_speech 工具，用已指定的豆包 Seed TTS 2.0 模型及已配置音色朗读：你好，欢迎使用 ByClaw。图片和语音生成能力验证成功。不要委派给数字员工，不要使用系统语音或代码合成替代。返回真实音频文件路径，并确认位于本会话 session_root/tts。'
let returnFromRun = false
const redis = createRedis()
try {
  const registry = new WorkerRegistry(redis)
  const workerId = process.env.E2E_TARGET_WORKER_ID || await registry.getTargetWorker(targetAgentType)
  if (!workerId) throw new Error('No online worker')
  const gateway = new GatewayClient(registry, redis)
  // Use an isolated configured agent type: by-framework worker inbox is control-only.
  const response = await gateway.sendMessage({ targetAgentType, sessionId, userCode, content: prompt, extraPayload: {}, requireOnlineWorker: true })
  if (!response.success) throw new Error(response.error || response.status)
  console.log(JSON.stringify({ kind, sessionId, workerId, traceId: response.trace_id }))
  const deadline = Date.now() + Number(process.env.E2E_TIMEOUT_MS || 240000)
  let cursor = '0-0', answer = ''
  while (Date.now() < deadline) {
    const rows = await redis.xread('COUNT', 100, 'BLOCK', 2000, 'STREAMS', QueueNames.session_data_stream(sessionId), cursor)
    for (const [, entries] of rows ?? []) for (const [id, fields] of entries) {
      cursor = id
      const index = fields.indexOf('data')
      if (index < 0) continue
      const event = JSON.parse(fields[index + 1])
      if (event.trace_id !== response.trace_id) continue
      const text = event.data?.choices?.[0]?.delta?.content ?? ''
      if (event.event_type === 'answerDelta') answer += text
      if (event.event_type === 'error') throw new Error('E2E_WORKER_ERROR: inspect local runtime log')
      if (event.event_type === 'appStreamResponse') {
        console.log(JSON.stringify({ terminal: true, answer }))
        process.exitCode = 0
        returnFromRun = true
        break
      }
    }
    if (returnFromRun) break
  }
  if (!returnFromRun) throw new Error('E2E_TIMEOUT')
} finally { await redis.quit() }
