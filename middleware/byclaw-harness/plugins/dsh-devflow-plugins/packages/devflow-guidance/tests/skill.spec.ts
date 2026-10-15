/**
 * The function-plugin export surface and the bundled skill providers against
 * a real skill registry: the advertised catalog entries (invocation policy,
 * descriptions that fit the harness's 500-character catalog cap as complete
 * sentences), the loaded bodies read from the shipped assets, removal on
 * fiber disposal, the `devflowSpec`-conditional registration of the
 * spec-authoring and spec-bootstrap skills, and the `devflowBusiness`-
 * conditional registration of the business-distill skill.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as Guidance from '../src/index.ts'
import * as Skill from '../src/skill.ts'

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function bootSkills(
  options: { spec?: boolean; business?: boolean } = {},
): Promise<{ ctx: Context; fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  // The board seam is inert here: this suite exercises the skill layer, and
  // the store is never read before a pre-step names a workspace.
  ctx.provide('devflow', { list: () => Promise.resolve([]), holder: () => Promise.resolve(undefined) })
  // Existence is all the conditional registration reads; no method of the
  // spec store is ever called by this package.
  if (options.spec === true) ctx.provide('devflowSpec', {})
  if (options.business === true) ctx.provide('devflowBusiness', {})
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(Guidance, {})
  return { ctx, fiber }
}

describe('plugin export surface', () => {
  it('exposes the function-plugin shape with no default export and no tunables', () => {
    expect(Guidance.name).toBe('devflow-guidance')
    expect(Guidance.inject).toEqual(['devflow', 'skills', 'systemPrompt'])
    expect(typeof Guidance.apply).toBe('function')
    expect('default' in Guidance).toBe(false)
    expect(Guidance.Config({})).toEqual({})
  })

  it('exports only the registration functions, never the bundled-skill factory', () => {
    expect(Object.keys(Skill).sort()).toEqual([
      'registerBusinessDistillSkill',
      'registerSkill',
      'registerSpecAuthoringSkill',
      'registerSpecBootstrapSkill',
    ])
  })
})

describe('the bundled devflow-workflow skill', () => {
  it('advertises one model- and user-invocable bundled skill with the shipped assets directory', async () => {
    const { ctx } = await bootSkills()
    const summary = (await ctx.skills.list()).find(entry => entry.name === 'devflow-workflow')
    expect(summary).toBeDefined()
    expect(summary?.provider).toBe('devflow-workflow')
    expect(summary?.source).toBe('bundled')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(summary?.resourceBase?.kind).toBe('directory')
    if (summary?.resourceBase?.kind === 'directory') {
      expect(summary.resourceBase.path).toContain(join('devflow-guidance', 'assets'))
    }
  })

  it('fits the catalog cap with complete sentences naming the four trigger scenarios', async () => {
    const { ctx } = await bootSkills()
    const description = (await ctx.skills.list()).find(entry => entry.name === 'devflow-workflow')?.description ?? ''
    // The harness catalog truncates at 500 normalized characters; a description
    // under the cap appears whole, so the cap is this package's contract.
    expect(description.replace(/\s+/g, ' ').trim().length).toBeLessThanOrEqual(500)
    expect(description.endsWith('.')).toBe(true)
    expect(description).toContain('turn a discussed plan or requirement into tracked work')
    expect(description).toContain('devflow_transition is vetoed')
    expect(description).toContain('when a card should stop')
    expect(description).toContain('active devflow board')
  })

  it('loads the seven-section judgment body from the shipped assets file', async () => {
    const { ctx } = await bootSkills()
    const skill = await ctx.skills.get('devflow-workflow')
    expect(skill).toBeDefined()
    expect(skill?.content).toBe(
      await readFile(new URL('../assets/devflow-workflow.md', import.meta.url), 'utf8'),
    )
    expect(skill?.content).toContain('## 1. Whether to touch the board')
    expect(skill?.content).toContain('## 2. Service class')
    expect(skill?.content).toContain('## 3. Decomposing a requirement')
    expect(skill?.content).toContain('## 4. Artifacts')
    expect(skill?.content).toContain('## 5. After a veto')
    expect(skill?.content).toContain('## 6. When a card stops')
    expect(skill?.content).toContain('## 7. Claims and leases')
  })

  it('pins the body contract sentences', async () => {
    const { ctx } = await bootSkills()
    const body = (await ctx.skills.get('devflow-workflow'))?.content ?? ''
    // The judgment/obligation boundary: per-call protocol stays with the tools.
    expect(body).toContain('nothing here repeats them')
    // Deployment artifact requirements come from the tool results, never from
    // this static body — the sentence that keeps the skill true everywhere.
    expect(body).toContain('**That preflight is the authority**')
    // Rework etiquette: revise the same kind; an unchanged retry buys nothing.
    expect(body).toContain('register a revised artifact of the **same kind**')
    expect(body).toContain('reuses the cached verdict')
    // The emergency shortcut records no debt; the follow-up card is on the model.
    expect(body).toContain('is an ordinary card you create yourself')
    // Lease etiquette: takeover is the human plane's call.
    expect(body).toContain('not a call you make')
    // Ending a card: the three outcomes stay apart, and none of them is a
    // model's move — but reading what was already filed is.
    expect(body).toContain('a `done` card cannot be abandoned')
    expect(body).toContain('Abandoning a requirement does not abandon its slices')
    expect(body).toContain('A veto is not a reason to stop')
    // The rule is about who decides, not which channel carries it: the board
    // gained these actions, and the model plane still has none of them.
    expect(body).toContain('no\nmodel-facing tool performs any of them')
    expect(body).toContain('`/devflow` and the sidebar board both carry filing and\nabandoning')
    expect(body).toContain('set: "archived"')
  })

  it('disposing the plugin fiber withdraws the skill', async () => {
    const { ctx, fiber } = await bootSkills()
    expect((await ctx.skills.list()).some(entry => entry.name === 'devflow-workflow')).toBe(true)
    await fiber.dispose()
    expect((await ctx.skills.list()).some(entry => entry.name === 'devflow-workflow')).toBe(false)
  })
})

describe('the bundled devflow-spec-authoring skill', () => {
  it('does not register without the devflowSpec service while devflow-workflow still does', async () => {
    const { ctx } = await bootSkills()
    const names = (await ctx.skills.list()).map(entry => entry.name)
    expect(names).toContain('devflow-workflow')
    expect(names).not.toContain('devflow-spec-authoring')
    expect(names).not.toContain('devflow-spec-bootstrap')
  })

  it('advertises a model- and user-invocable bundled skill while devflowSpec is provided', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const summary = (await ctx.skills.list()).find(entry => entry.name === 'devflow-spec-authoring')
    expect(summary).toBeDefined()
    expect(summary?.provider).toBe('devflow-spec-authoring')
    expect(summary?.source).toBe('bundled')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(summary?.resourceBase?.kind).toBe('directory')
    if (summary?.resourceBase?.kind === 'directory') {
      expect(summary.resourceBase.path).toContain(join('devflow-guidance', 'assets'))
    }
  })

  it('fits the catalog cap with complete sentences naming the four trigger scenarios', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const description = (await ctx.skills.list()).find(entry => entry.name === 'devflow-spec-authoring')?.description ?? ''
    // The harness catalog truncates at 500 normalized characters; a description
    // under the cap appears whole, so the cap is this package's contract.
    expect(description.replace(/\s+/g, ' ').trim().length).toBeLessThanOrEqual(500)
    expect(description.endsWith('.')).toBe(true)
    expect(description).toContain('recording a learning worth keeping')
    expect(description).toContain('devflow_read_spec returns a stale warning')
    expect(description).toContain('devflow_write_spec rejects a write')
    expect(description).toContain('between a spec document and an iron rule')
  })

  it('loads the six-section judgment body from the shipped assets file', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const skill = await ctx.skills.get('devflow-spec-authoring')
    expect(skill).toBeDefined()
    expect(skill?.content).toBe(
      await readFile(new URL('../assets/devflow-spec-authoring.md', import.meta.url), 'utf8'),
    )
    expect(skill?.content).toContain('## 1. What deserves a document')
    expect(skill?.content).toContain('## 2. Choosing anchors')
    expect(skill?.content).toContain('## 3. Scope and ids')
    expect(skill?.content).toContain('## 4. Revising and merging')
    expect(skill?.content).toContain('## 5. Responding to stale')
    expect(skill?.content).toContain('## 6. When not to write')
  })

  it('pins the body contract sentences', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const body = (await ctx.skills.get('devflow-spec-authoring'))?.content ?? ''
    // The judgment/obligation boundary: the write protocol stays with the tools.
    expect(body).toContain('nothing here repeats either')
    // Anchor choice is a writability question before a strength question.
    expect(body).toContain('writability\nfirst')
    // The born-stale rule's consequence, verbatim commitment.
    expect(body).toContain('never that the document was wrong from the start')
    // Revision path: replaces revises; whole-document storage is not a prohibition.
    expect(body).toContain('`replaces: [<own id>]` IS the revision path')
    expect(body).toContain('There is no delete operation')
    // A bad scope declaration is reported on the card result, never silently dropped.
    expect(body).toContain('Act on that warning: re-register a corrected artifact')
    // Stale response discipline.
    expect(body).toContain('Never keep citing such a document as if it were fresh')
  })
})

describe('the bundled devflow-spec-bootstrap skill', () => {
  it('advertises a model- and user-invocable bundled skill while devflowSpec is provided', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const summary = (await ctx.skills.list()).find(entry => entry.name === 'devflow-spec-bootstrap')
    expect(summary).toBeDefined()
    expect(summary?.provider).toBe('devflow-spec-bootstrap')
    expect(summary?.source).toBe('bundled')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(summary?.resourceBase?.kind).toBe('directory')
    if (summary?.resourceBase?.kind === 'directory') {
      expect(summary.resourceBase.path).toContain(join('devflow-guidance', 'assets'))
    }
  })

  it('fits the catalog cap with complete sentences naming the three trigger scenarios', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const description = (await ctx.skills.list()).find(entry => entry.name === 'devflow-spec-bootstrap')?.description ?? ''
    // The harness catalog truncates at 500 normalized characters; a description
    // under the cap appears whole, so the cap is this package's contract.
    expect(description.replace(/\s+/g, ' ').trim().length).toBeLessThanOrEqual(500)
    expect(description.endsWith('.')).toBe(true)
    expect(description).toContain('census names scopes with no document')
    expect(description).toContain('adopts the spec seam over an existing codebase')
    expect(description).toContain('documented from scratch')
  })

  it('loads the seven-section procedure body from the shipped assets file', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const skill = await ctx.skills.get('devflow-spec-bootstrap')
    expect(skill).toBeDefined()
    expect(skill?.content).toBe(
      await readFile(new URL('../assets/devflow-spec-bootstrap.md', import.meta.url), 'utf8'),
    )
    expect(skill?.content).toContain('## 1. One scope at a time')
    expect(skill?.content).toContain('## 2. Read the code, not the old documents')
    expect(skill?.content).toContain('## 3. What to look for')
    // Verdicts come before prose: what passes the bar decides what is written.
    expect(skill?.content).toContain('## 4. Judge the candidates first')
    expect(skill?.content).toContain('## 5. Write few, write anchored')
    // The unnumbered branch qualifying steps 2-5 for churn-only languages.
    expect(skill?.content).toContain('## Languages without a parser')
    // The third answer a scope can get: not "documented yet" and not a gap.
    expect(skill?.content).toContain('## 6. When the honest answer is no document')
    expect(skill?.content).toContain('## 7. Done, or honestly unfinished')
    // The unnumbered opt-in branch: a run too big for one pass goes on the
    // board. Unnumbered because it qualifies the whole procedure rather than
    // taking a place in it.
    expect(skill?.content).toContain('## Putting a pass on the board')
  })

  it('pins the body contract sentences', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const body = (await ctx.skills.get('devflow-spec-bootstrap'))?.content ?? ''
    // The judgment boundary: authoring and write protocol stay in their skills.
    expect(body).toContain('it repeats neither')
    // One scope at a time; the census is the queue.
    expect(body).toContain('finish it before opening another')
    // The source discipline: code over inherited prose.
    expect(body).toContain('the only source a born-fresh anchor can vouch for')
    // The starting budget per scope, and the two sentences that keep it from
    // hardening into a ceiling: it is one pass's pace, and the census's
    // document-count-over-file-count fact is the way back to a big scope.
    expect(body).toContain('at most three documents per scope')
    expect(body).toContain('That is the pace of one\npass, not the scope\'s total')
    expect(body).toContain('that pair is a fact, not a threshold')
    expect(body).toContain('A large scope has earned a second pass, and a third')
    // What settles the number is the bar, never the number — and the bar is
    // applied to a written-out candidate list before any prose is drafted.
    expect(body).toContain('give every line a verdict against the write skill\'s')
    expect(body).toContain('What bounds the count in the end is the stranger test, not a number')
    expect(body).toContain('The count falls\nout of the verdicts; it is never the target they are judged against')
    // No floor either: a minimum would buy padding, the same blindness to a
    // scope's size that the removed ceiling had.
    expect(body).toContain('Nothing here sets a floor')
    // An empty candidate list is an answer, and the waiver section owns it.
    expect(body).toContain('No candidate passing is a verdict, not a wasted pass')
    // The verdict list is shown, not stored: the store holds claims.
    expect(body).toContain('keep it out of\n`.devflow/spec/`')
    // Orientation before detail, as an ordering rule over the documents that
    // pass — never a hand-written index, which anchors nothing and duplicates
    // what the listing already derives.
    expect(body).toContain('The first document of a scope orients')
    expect(body).toContain('do not\nwrite an `index.md`')
    expect(body).toContain('refuses\nit as `no-anchors`')
    expect(body).toContain('derived by `list()`')
    // Anchor strength, the half a bootstrapping pass gets wrong: a behavioral
    // claim on a `symbol` anchor stays fresh while turning false.
    expect(body).toContain('**`content-hash`** for what the code does')
    expect(body).toContain('**the anchor still reports fresh**')
    // The waiver: when it is the honest answer, what it costs, and how it ends.
    expect(body).toContain('A waiver is not an escape hatch')
    expect(body).toContain('What carries it is a real document')
    expect(body).toContain('you have\nnot decided the scope needs no document')
    expect(body).toContain('A waiver expires by itself')
    expect(body).toContain('That is a decision to re-make, not a gap to fill')
    expect(body).toContain('A document may not waive the scope it sits in')
    // Refusal etiquette, deferred to dsh-write-spec.
    expect(body).toContain('fix the anchor, not the claim')
    // Completion is mechanical, and partial progress is a reportable state —
    // reported by the pass itself, not left for the next census to mention.
    expect(body).toContain('that is the whole completion criterion')
    expect(body).toContain('Stopping partway is a legitimate state')
    expect(body).toContain('Say what the pass covered before you stop')
    expect(body).toContain('how many scopes the census still reports with no\ndocument')
    // The parserless branch: who is parsed, churn-only reality, no sentinel,
    // restraint.
    expect(body).toContain('TypeScript/JavaScript, Python, Go, Rust, and Java')
    expect(body).toContain('`churn` is the only anchor kind')
    expect(body).toContain('The turn-end sentinel never fires here')
    expect(body).toContain('churn-only; freshness lags commits')
    expect(body).toContain('anchor only the load-bearing files')
    // The board branch is opt-in and says so before it says anything else.
    expect(body).toContain('Everything above runs without a card, and most bootstrapping should')
    expect(body).toContain('outlives the session that starts\nit')
    // What a card is for: the verdict list and its independent review — and
    // the sentence that keeps both from being read as coverage.
    expect(body).toContain('Neither is coverage, and that is the point')
    // Cross-cutting ownership, and why the parent card is where it belongs.
    expect(body).toContain('A cross-cutting claim belongs to the scope that owns the contract')
    expect(body).toContain('one scope\'s card in charge of another\nscope\'s document')
    // The boundary this whole branch is shaped by: the card never becomes a
    // second answer to the census's question.
    expect(body).toContain('**The board never says what is left.**')
    expect(body).toContain('a second answer to the census\'s question')
    expect(body).toContain('not a checklist the\nparent maintains')
  })
})

describe('the bundled devflow-business-distill skill', () => {
  it('does not register without the devflowBusiness service, nor alongside the spec seam alone', async () => {
    const { ctx } = await bootSkills({ spec: true })
    const names = (await ctx.skills.list()).map(entry => entry.name)
    // Its own conditional child: a composition may mount either seam without
    // the other, and a skill teaching an unmounted tool cannot be acted on.
    expect(names).toContain('devflow-spec-authoring')
    expect(names).not.toContain('devflow-business-distill')
  })

  it('advertises a model- and user-invocable bundled skill while devflowBusiness is provided', async () => {
    const { ctx } = await bootSkills({ business: true })
    const summary = (await ctx.skills.list()).find(entry => entry.name === 'devflow-business-distill')
    expect(summary).toBeDefined()
    expect(summary?.provider).toBe('devflow-business-distill')
    expect(summary?.source).toBe('bundled')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('fits the catalog cap with complete sentences naming its trigger scenarios', async () => {
    const { ctx } = await bootSkills({ business: true })
    const description = (await ctx.skills.list()).find(entry => entry.name === 'devflow-business-distill')?.description ?? ''
    expect(description.replace(/\s+/g, ' ').trim().length).toBeLessThanOrEqual(500)
    expect(description.endsWith('.')).toBe(true)
    expect(description).toContain('register sources')
    expect(description).toContain('establish the vocabulary before')
    expect(description).toContain('judgement calls out of the rules')
  })

  it('loads the procedure body from the shipped assets file', async () => {
    const { ctx } = await bootSkills({ business: true })
    const skill = await ctx.skills.get('devflow-business-distill')
    expect(skill?.content).toBe(
      await readFile(new URL('../assets/devflow-business-distill.md', import.meta.url), 'utf8'),
    )
  })

  it('pins the body contract sentences', async () => {
    const { ctx } = await bootSkills({ business: true })
    const body = (await ctx.skills.get('devflow-business-distill'))?.content ?? ''
    // The fence, and the fact that reads are deliberately NOT fenced — which
    // is why this package ships no read tool for the model to look for.
    expect(body).toContain('The tool is the only way in.')
    expect(body).toContain('Reading is not')
    // The review fence, stated as something the model cannot lift.
    expect(body).toContain('There is no parameter that says otherwise')
    // The distillation boundary: a judgement is not a rule.
    expect(body).toContain('is NOT a rule')
    expect(body).toContain('manufactures confident, plausible,\nwrong knowledge')
    // Authoring order: the first meta document is uncited, and nothing refuses it.
    expect(body).toContain('cited by nothing, and that is correct')
    // Conflicts are recorded, never adjudicated by the model.
    expect(body).toContain('Record it; do not adjudicate it.')
  })

  it('removes the skill when the plugin fiber is disposed', async () => {
    const { ctx, fiber } = await bootSkills({ business: true })
    expect((await ctx.skills.list()).some(entry => entry.name === 'devflow-business-distill')).toBe(true)

    await fiber.dispose()

    expect((await ctx.skills.list()).some(entry => entry.name === 'devflow-business-distill')).toBe(false)
  })
})
