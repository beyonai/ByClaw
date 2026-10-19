/**
 * `/devflow doctor`: what is wrong with this deployment, read from the faces
 * that already exist. Every fact below comes from `list()`, `holder()`, the
 * cards' own artifacts, `ctx.get` probes, and git — no store method and no
 * service exists for this report.
 *
 * It is a human-facing command rather than a model-facing tool for the reason
 * `/devflow spec` is one: a whole-deployment sweep is the opposite of the
 * "hand out the index, not the prose" discipline the tool plane keeps.
 *
 * Two positions shape the output and are worth stating before the code:
 *
 * - **It only reads.** No file is written, no transition is attempted, and
 *   there is no `--fix`. A health command that repairs things gets run as an
 *   installer, and then nobody knows what it changed.
 * - **A question that could not be answered is reported as unanswered.** The
 *   `Not asked` section is a primary output, not a footnote: a report that
 *   renders "could not check" as "no problem" is worse than no report, which
 *   is the position `/devflow spec` already takes about coverage it cannot
 *   measure.
 *
 * Nothing here defines what "stale" means for a lease. The timestamps are
 * rendered with their age and the judgement is left to the reader, because a
 * threshold would be a deployment-varying tunable with no owner — and lease
 * reclamation is a decision this line has deliberately deferred.
 */

import { execFile } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { ArtifactRecord, DevActor, DevCard } from '@zhchxiao123/dsh-devflow'
// The fence's own pure reads, so a fault this reports and the veto a
// transition receives are one sentence rather than two accounts of one fault.
// The entry is deliberately not the worktree plugin's index: see its module doc.
import { createDispatchPreconditionChecker, parseWorktreeDispatch } from '@zhchxiao123/dsh-devflow-worktree/dispatch'

const exec = promisify(execFile)

/**
 * The artifact kind a dispatch is read from. It is the worktree plugin's
 * `artifactKind` default; that plugin's Config is not readable from here, so
 * the assumption is declared in {@link NOT_ASKED} rather than hidden.
 */
const DISPATCH_KIND = 'worktree'

/** The workspace a report is about: the checkout, and the board under it. */
interface Place {
  /** The invoking session's working directory — what git is asked about. */
  readonly dir: string
  /** The devflow root under it. */
  readonly root: string
}

/** One optional service, and what its presence answers for. */
interface Probe {
  readonly service: string
  readonly plugin: string
  readonly answers: string
}

/**
 * The optional planes doctor can see. Presence is all any of them reports:
 * `devflow-gates` publishes only a validator registry, and the review and
 * agent gates publish nothing at all, so "mounted" is the whole answer
 * available — which is why {@link NOT_ASKED} carries the configuration
 * question.
 */
const PROBES: readonly Probe[] = [
  { service: 'devflowArtifactStructures', plugin: 'devflow-artifact-gate', answers: 'the mechanical artifact contract' },
  { service: 'devflowValidators', plugin: 'devflow-gates', answers: 'the command gate engine' },
  { service: 'devflowSpec', plugin: 'devflow-spec-filesystem', answers: 'the architecture-document seam' },
  { service: 'devflowIronRules', plugin: 'devflow-iron-rules', answers: 'repository-carried obligations' },
  { service: 'devflowBusiness', plugin: 'devflow-business', answers: 'repository-carried business knowledge' },
  { service: 'devflowMidsceneReports', plugin: 'devflow-midscene', answers: 'Web acceptance reports' },
]

/** The questions no composition of this line can answer today. */
const NOT_ASKED: readonly string[] = [
  'Whether each required validator is available. ValidatorRegistry keeps its providers private and publishes no enumeration, '
  + 'so a name project policy requires is only proven present when a transition actually runs it.',
  'How each gate is configured at the edge. devflow-gates provides a validator registry and nothing else, devflow-review-gate and '
  + 'devflow-agent-gate provide nothing at all, so whether the review edge carries a baseRef — the misconfiguration that quietly '
  + 'reviews another card\'s changes — is unreadable from here.',
  `Which artifact kind this deployment dispatches with. "${DISPATCH_KIND}" is the worktree plugin's default and is what Worktrees `
  + 'assumed; a deployment that configured another kind has every dispatch missed by that section rather than reported.',
  'What .gitignore means. Only git check-ignore is asked and no ignore file is parsed, the position /devflow spec takes for the '
  + 'same reason: an ignore parser of our own would diverge from git\'s real semantics and report the divergence as a fault.',
]

/**
 * The deployment health report.
 * @param ctx - context carrying the devflow store and the optional services.
 * @param cwd - the invoking session's workspace root, when it has one.
 * @param root - the devflow root under it; absent with `cwd`, in which case
 *   the cards come from the store's configured default root and no directory
 *   is known to ask git about.
 * @returns the report lines, in reading order.
 */
export async function doctorLines(ctx: Context, cwd: string | undefined, root: string | undefined): Promise<string[]> {
  const place: Place | undefined = cwd === undefined || root === undefined ? undefined : { dir: cwd, root }
  // Every section but Board reads the board itself, so a workspace without one
  // leaves them with nothing to report — which is an unanswered question and
  // is rendered as one, rather than as a policy that requires nothing and a
  // dispatch set that is empty.
  const at = place !== undefined && await isDirectory(place.root) ? place : undefined
  const cards = await ctx.devflow.list(undefined, root)
  const unanswered: string[] = []
  return [
    'devflow doctor — a read-only report; this command changed nothing.',
    ...section('Board', await boardBody(place, at, cards, unanswered)),
    ...section('Leases', await leaseBody(ctx, cards, root)),
    ...section('Worktrees', await worktreeBody(at, cards, unanswered)),
    ...section('Gates', await gateBody(ctx, at, unanswered)),
    ...section('Not asked', notAskedBody(unanswered)),
  ]
}

/** One titled block, blank-line separated; an empty body still renders its title. */
function section(title: string, body: readonly string[]): string[] {
  return ['', title, ...body.map(line => `  ${line}`)]
}

/**
 * Whether the board is in git and its transient state out of it — asked
 * through the worktree fence's own checker so that a fault reads here exactly
 * as it reads in the veto a transition receives.
 *
 * The checker answers about one named card, because the ignore question is
 * about a concrete lease path. The card chosen is a dispatched one where the
 * board has any, since that is the card the fence would actually veto; where
 * none is dispatched the first card stands in and the answer is framed as the
 * prediction it is. The verdict is a property of the repository, not of the
 * card, so one card answers for the board.
 * @param place - the workspace, absent when the session named none.
 * @param at - the same workspace once its board is known to exist, so that a
 *   missing board is reported here and left unanswered everywhere else.
 * @param cards - the active cards.
 * @param unanswered - accumulator for the `Not asked` section.
 * @returns the section body.
 */
async function boardBody(
  place: Place | undefined,
  at: Place | undefined,
  cards: readonly DevCard[],
  unanswered: string[],
): Promise<string[]> {
  if (place === undefined) {
    unanswered.push('Anything that needs a checkout: the invoking session names no working directory, so there was nothing to ask git about '
      + 'and no .devflow to locate. The cards reported came from the store\'s configured default root.')
    return ['the invoking session names no working directory, so this report could not locate a board']
  }
  if (at === undefined) {
    unanswered.push(`Everything under ${place.root}: there is no board there, so no precondition, no dispatch, and no validation policy was read. `
      + 'This is an empty answer, not a clean bill of health.')
    return [`no board at ${place.root} — nothing has been initialized in this workspace`]
  }
  const body = [`${at.root} — ${String(cards.length)} active card(s)`]
  // The checker answers `undefined` both for a repository that passes and for
  // one it could not ask about, because the fence must admit a check that did
  // not run. A report may not: git's ability to answer is established first,
  // so "could not ask" never renders as "nothing wrong".
  // A section that simply falls silent reads as "nothing to say about the
  // board", so each unanswerable case leaves its own marker where the answer
  // would have been.
  const unasked = [...body, 'dispatch preconditions — not asked; see "Not asked" below']
  if (!await isWorkTree(at.dir)) {
    unanswered.push(`The two dispatch preconditions. git could not answer about ${at.dir} — it is not inside a working tree, or git is not on PATH — `
      + 'so whether the board is committed and its transient state ignored is unknown here, not confirmed.')
    return unasked
  }
  const dispatched = dispatchesOf(cards)
  const subject = dispatched[0]?.card ?? cards[0]
  if (subject === undefined) {
    unanswered.push('The two dispatch preconditions. The fence asks them about one card\'s lease file, and this board holds no active card to ask about.')
    return unasked
  }
  const fault = await createDispatchPreconditionChecker()(at.dir, at.root, subject.id)
  body.push('dispatch preconditions — the two questions the worktree fence asks git:')
  if (fault === undefined) {
    body.push(`  the board is tracked and card ${subject.id}'s transient state is ignored`)
    return body
  }
  body.push(`  ${fault}`)
  if (dispatched.length === 0) {
    body.push(`  No card is dispatched yet, so nothing is vetoed today; ${subject.id} stands in above for the first card that is.`)
  }
  return body
}

/**
 * Who holds each lease and since when.
 *
 * `list()` carries no claim information, so each card is asked separately —
 * the pattern `devflow-guidance` already follows for the same reason.
 * @param ctx - context carrying the devflow store.
 * @param cards - the active cards.
 * @param root - the devflow root the cards were listed from.
 * @returns the section body.
 */
async function leaseBody(ctx: Context, cards: readonly DevCard[], root: string | undefined): Promise<string[]> {
  if (cards.length === 0) return ['no active card, so no lease']
  const now = Date.now()
  const held: string[] = []
  for (const card of cards) {
    const holder = await ctx.devflow.holder(card.id, root)
    if (holder === undefined) continue
    held.push(`${card.id} — held by ${actorText(holder.owner)}; ${heartbeatText(holder.heartbeatAt, now)}`)
  }
  if (held.length === 0) return [`none of the ${String(cards.length)} active card(s) is claimed`]
  return [
    ...held,
    'A lease is reported here and never reclaimed. No age above is a verdict: heartbeat() has no caller on this line, so every',
    'timestamp is the moment the card was taken rather than a sign of life, and whether one is stale is your call, not a',
    'threshold this command owns. "/devflow takeover <id>" is what acts on the answer.',
  ]
}

/** An actor as the lease records it; an unnamed one is still reported by kind. */
function actorText(owner: DevActor): string {
  const named = owner.kind === 'agent' ? owner.session : owner.name
  return named === undefined ? `an unnamed ${owner.kind}` : `${owner.kind} ${named}`
}

/** The heartbeat and its age, or the fact that the lease carries no readable one. */
function heartbeatText(heartbeatAt: string, now: number): string {
  const at = Date.parse(heartbeatAt)
  if (Number.isNaN(at)) {
    return heartbeatAt === ''
      ? 'the lease records no heartbeat at all'
      : `the lease records an unreadable heartbeat (${heartbeatAt})`
  }
  return `last heartbeat ${heartbeatAt} (${elapsed(now - at)})`
}

/** A duration coarse enough to read at a glance and argue with. */
function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 0) return 'dated in the future'
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${String(minutes)}m ago`
  const days = Math.floor(hours / 24)
  return days === 0 ? `${String(hours)}h ago` : `${String(days)}d ${String(hours % 24)}h ago`
}

/**
 * Each dispatched card's worktree, and two separate questions about it: does
 * the path exist, and is it a linked worktree of this repository.
 *
 * They are reported apart because a plain directory at the dispatched path
 * answers the first and fails the second — a state nothing else makes visible,
 * and one the fence admits, since it only compares resolved directories.
 * @param at - the workspace with a readable board; absent, Board already said
 *   why, and answering here would turn that absence into a clean result.
 * @param cards - the active cards.
 * @param unanswered - accumulator for the `Not asked` section.
 * @returns the section body.
 */
async function worktreeBody(at: Place | undefined, cards: readonly DevCard[], unanswered: string[]): Promise<string[]> {
  if (at === undefined) return ['not asked — see Board for why there is nothing here to read']
  const dispatched = dispatchesOf(cards)
  if (dispatched.length === 0) return [`no active card carries a "${DISPATCH_KIND}" artifact, so none is dispatched to a worktree`]
  const linked = await linkedWorktrees(at.dir)
  if (linked === undefined) {
    unanswered.push(`Whether each worktree below is linked to this repository: "git worktree list" could not be run in ${at.dir}, `
      + 'so only the existence of each path was checked.')
  }
  const body: string[] = []
  for (const { card, record } of dispatched) {
    let content: string
    try {
      content = await readFile(join(dirname(card.path), record.path), 'utf8')
    } catch {
      // Swallows every reason the artifact does not open — removed, renamed,
      // unreadable. The fence vetoes all three identically, and naming the
      // registration is what lets a reader go look.
      body.push(`${card.id} — its "${DISPATCH_KIND}" artifact ${record.path} is registered but unreadable; the fence vetoes every transition of this card`)
      continue
    }
    const dispatch = parseWorktreeDispatch(content)
    if (dispatch === undefined) {
      body.push(`${card.id} — its "${DISPATCH_KIND}" artifact ${record.path} is not a dispatch record; the fence vetoes every transition of this card`)
      continue
    }
    body.push(`${card.id} — dispatched to ${dispatch.worktree} on branch ${dispatch.branch} (base ${dispatch.base})`)
    const target = await canonical(dispatch.worktree)
    if (target === undefined) {
      body.push('  path: MISSING — nothing exists there, so the card can only be moved from the repository\'s main working tree')
      continue
    }
    if (linked === undefined) continue
    body.push(linked.includes(target)
      ? '  ok: the path exists and git knows it as a linked worktree of this repository'
      : '  path: exists, but git does not know it as a linked worktree of this repository — an ordinary directory there satisfies '
        + 'the fence while carrying none of the card\'s branch')
  }
  return body
}

/** The newest artifact of the dispatch kind on each card that has one. */
function dispatchesOf(cards: readonly DevCard[]): { card: DevCard; record: ArtifactRecord }[] {
  return cards.flatMap((card) => {
    // Records are in registration order and revisions only grow, so the last
    // of a kind is the one in force — the rule the fence reads dispatches by.
    const record = card.artifactRecords.filter(candidate => candidate.kind === DISPATCH_KIND).at(-1)
    return record === undefined ? [] : [{ card, record }]
  })
}

/**
 * Whether git can answer about this directory at all — the question that
 * separates a precondition that holds from one nobody could check.
 * @param dir - the directory git is run in.
 * @returns whether git reports it inside a working tree.
 */
async function isWorkTree(dir: string): Promise<boolean> {
  try {
    return (await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir })).stdout.trim() === 'true'
  } catch {
    // git absent, the directory gone, or no repository here — and a bare
    // repository answers "false" without failing. All of them mean the same
    // thing to the caller: nothing about this checkout was established.
    return false
  }
}

/**
 * Every working tree git links to this repository, resolved.
 * @param dir - the directory git is run in.
 * @returns the canonical paths, or `undefined` when git could not answer.
 */
async function linkedWorktrees(dir: string): Promise<string[] | undefined> {
  let listed: string
  try {
    listed = (await exec('git', ['worktree', 'list', '--porcelain'], { cwd: dir })).stdout
  } catch {
    // git absent, the directory missing, or not a work tree. A check that
    // could not run is reported as unasked rather than as a fault, the
    // direction the fence's own preconditions take.
    return undefined
  }
  const paths: string[] = []
  for (const line of listed.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue
    // A worktree removed but not pruned is still listed; it resolves to
    // nothing and is left out, so the dispatched path reports as missing
    // rather than as linked.
    const path = await canonical(line.slice('worktree '.length))
    if (path !== undefined) paths.push(path)
  }
  return paths
}

/**
 * Which optional planes are mounted, and what project policy requires of the
 * gate engine.
 * @param ctx - context the services are probed on.
 * @param at - the workspace with a readable board; absent, no policy file is
 *   read, because "no board" is not the same fact as "requires no validator".
 * @param unanswered - accumulator for the `Not asked` section.
 * @returns the section body.
 */
async function gateBody(ctx: Context, at: Place | undefined, unanswered: string[]): Promise<string[]> {
  const body = PROBES.map(probe => `${probe.service} — ${isMounted(ctx, probe.service) ? 'mounted' : 'NOT mounted'} (${probe.plugin}: ${probe.answers})`)
  if (at === undefined) return body
  const path = join(at.root, 'validation.json')
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    // Swallows every reason the file does not open. It is optional, and a
    // deployment that requires no validator by project policy is the ordinary
    // case rather than a fault.
    body.push(`no ${path}, so project policy requires no validator`)
    return body
  }
  const declared = declaredRequirements(content)
  if (declared === undefined) {
    unanswered.push(`What ${path} requires. It is present but not in the shape devflow-gates accepts, and that plane — not this one — `
      + 'is the authority on the file; it will fail loud on the same content.')
    return body
  }
  if (declared.length === 0) {
    body.push(`${path} declares no requirement`)
    return body
  }
  body.push(`${path} requires:`, ...declared.map(requirement => `  ${requirement}`))
  return body
}

/**
 * Whether a service name is served here.
 *
 * The name is a plain string because presence is all doctor asks: reading none
 * of the six values, it would otherwise import six plugins' type augmentations
 * into the command plane the bundle mounts by default, tying its manifest to
 * packages it never touches.
 * @param ctx - context the service is probed on.
 * @param service - the service name.
 * @returns whether a provider currently serves it.
 */
function isMounted(ctx: Context, service: string): boolean {
  return ctx.get(service) !== undefined
}

/**
 * What `validation.json` declares, one line per requirement.
 *
 * This is a report of the file, not a validation of it: `devflow-gates` owns
 * that and fails loud, so anything not in the shape it accepts is answered as
 * unreadable here rather than partially rendered.
 * @param content - the file's content.
 * @returns the requirements, or `undefined` when the file is not one.
 */
function declaredRequirements(content: string): string[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    // Swallows the parse failure of a file that is not JSON at all, which is
    // the same answer as JSON of the wrong shape: devflow-gates rejects both.
    return undefined
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.requirements)) return undefined
  const declared: string[] = []
  for (const entry of value.requirements as unknown[]) {
    if (!isRecord(entry) || !isStringList(entry.validators) || !isStringList(entry.edges)) return undefined
    declared.push(`${entry.validators.join(', ')} on ${entry.edges.join(', ')}`)
  }
  return declared
}

/** A JSON object, `null` excluded. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A JSON array of strings. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** The questions this run did not answer — the fixed ones and what it hit. */
function notAskedBody(unanswered: readonly string[]): string[] {
  return [
    'Each line below is a question this report did not answer. None of them is an answer of "no problem".',
    ...[...NOT_ASKED, ...unanswered].map(line => `- ${line}`),
  ]
}

/** Whether a path is a directory; anything unreadable is not one for this purpose. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    // Swallows every reason the path does not stat — absent is the case this
    // exists for, and the others yield the same report line.
    return false
  }
}

/** A path as git and the fence resolve it, or `undefined` when nothing is there. */
async function canonical(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch {
    // Swallows every resolution failure; a removed worktree is the ordinary
    // one, and the caller reports the path as missing either way.
    return undefined
  }
}
