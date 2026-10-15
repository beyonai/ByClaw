// Step-0 pre-check experiment (design.md open question 1): what happens when
// two `agent/turn-stopping` listeners both call `agent.steer(...)` on the same
// agent, against the PRODUCTION AgentLoop (0.1.5-rc.2) mounted through
// @deepseek-ai/dsh-agent-loop-testkit. Variants: steer+inject, inject-only.
//
// This directory has its own npm install of the testkit and its peers at the
// exact harness prerelease; the repo's pnpm tree does not carry
// dsh-agent-loop / dsh-agent-loop-testkit (they are not dependencies of the
// plugin line). Nothing here touches the repo lockfile.
import { describe, it, expect, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'

/** Minimal adapter: every model call answers with plain text and stops. */
class TextOnlyAdapter extends LlmAdapter {
  async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const textsOf = (messages) =>
  messages.map((m) => m.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))

const plugin = (name) => ({ kind: 'plugin', plugin: name })
const text = (t, source) => createUserMessage({ content: [{ type: 'text', text: t }], source })

let context

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/**
 * Boot the production loop, record every pre-step admitted batch and every
 * turn-stopping listener invocation, then run one turn driven by `listeners`
 * (each called once per turn-stopping dispatch, in registration order).
 */
async function runTurn(listeners) {
  const ctx = new Context()
  context = ctx
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['test'], new TextOnlyAdapter())

  /** One entry per admitted step: which turn/step and the batch's text contents. */
  const steps = []
  ctx.on('agent/pre-step', async (payload, next) => {
    // DELEGATE FIRST is for mutating listeners; recording before next() keeps
    // the batch as claimed from the inbox, before any downstream replacement.
    steps.push({ turn: payload.turn, step: payload.step, texts: textsOf(payload.messages) })
    return next()
  })

  /** Listener-name invocation log across all turn-stopping dispatches. */
  const stops = []
  for (const { name, once } of listeners) {
    let fired = false
    ctx.on('agent/turn-stopping', ({ agent }) => {
      stops.push(name)
      if (fired) return
      fired = true
      once(agent)
    })
  }

  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId(`exp-${listeners.map((l) => l.name).join('-')}`), {
    provider: 'test',
    model: 'm1',
  })
  agent.followup(text('go', { kind: 'user' }))
  await agent.whenIdle()
  return { steps, stops }
}

describe('two turn-stopping listeners on the production AgentLoop (0.1.5-rc.2)', () => {
  it('delivers both steer messages, merged into ONE continuation step, in listener order', async () => {
    const { steps, stops } = await runTurn([
      { name: 'A', once: (agent) => agent.steer(text('steer-A', plugin('exp-a'))) },
      { name: 'B', once: (agent) => agent.steer(text('steer-B', plugin('exp-b'))) },
    ])
    console.log('dual-steer steps:', JSON.stringify(steps))
    console.log('dual-steer stops:', JSON.stringify(stops))

    // Step 1 is the user prompt; step 2 is the single continuation step whose
    // batch carries BOTH steer messages, ordered by steer() call order
    // (= serial listener registration order). Nothing is lost or overwritten.
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ turn: 1, step: 1, texts: ['go'] })
    expect(steps[1]).toMatchObject({ turn: 1, step: 2, texts: ['steer-A', 'steer-B'] })

    // turn-stopping ran twice (after step 1: both steer; after step 2: both
    // no-op, turn closes), serial in registration order each time.
    expect(stops).toEqual(['A', 'B', 'A', 'B'])
  })

  it('steer from one listener and inject from the other land in the SAME continuation step', async () => {
    const { steps, stops } = await runTurn([
      { name: 'S', once: (agent) => agent.steer(text('steer-S', plugin('exp-s'))) },
      { name: 'I', once: (agent) => agent.inject(text('inject-I', plugin('exp-i'))) },
    ])
    console.log('steer+inject steps:', JSON.stringify(steps))
    console.log('steer+inject stops:', JSON.stringify(stops))

    // inject() targets the same next-step inbox list as steer() (it only skips
    // the driver wake, which is irrelevant mid-turn), so the injected context
    // rides the steered continuation step rather than waiting for a next turn.
    expect(steps).toHaveLength(2)
    expect(steps[1].texts).toEqual(['steer-S', 'inject-I'])
    expect(stops).toEqual(['S', 'I', 'S', 'I'])
  })

  it('inject alone during turn-stopping ALSO keeps the turn alive for one more step', async () => {
    const { steps, stops } = await runTurn([
      { name: 'I', once: (agent) => agent.inject(text('inject-only', plugin('exp-i'))) },
    ])
    console.log('inject-only steps:', JSON.stringify(steps))
    console.log('inject-only stops:', JSON.stringify(stops))

    // The loop's close condition is `inbox.nextStep.length === 0` re-read after
    // the serial dispatch; inject() makes it non-empty exactly like steer().
    // So "inject to deliver next turn" holds only when the agent is NOT at its
    // own turn-stopping boundary.
    expect(steps).toHaveLength(2)
    expect(steps[1].texts).toEqual(['inject-only'])
    expect(stops).toEqual(['I', 'I'])
  })
})
