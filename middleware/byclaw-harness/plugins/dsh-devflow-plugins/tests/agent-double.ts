/**
 * The inbox a test-only `Agent` carries, and nothing more.
 *
 * At the pinned `0.1.5-rc.2` `@deepseek-ai/dsh-agent` declares `Inbox` as a type and
 * exports no way to construct one: the harness owns construction, and a plugin
 * composing against published surface cannot make a real one. The shape here is
 * what that interface declares, and a divergence from it is a defect in this
 * copy.
 *
 * Nothing here is exercised: these suites register an agent so that a command,
 * tool, or gate has a caller, and never drive its input. Every method throws
 * rather than pretending to work, so a suite that starts depending on real
 * inbox behavior fails loudly instead of silently observing a stub.
 */

import type { Inbox } from '@deepseek-ai/dsh-agent'

/** The one refusal every unreached inbox member answers with. */
function unreached(member: string): never {
  throw new Error(`tests/agent-double: Inbox.${member} is a stub; this suite does not drive agent input`)
}

/**
 * An inbox holding nothing, refusing every mutation.
 * @returns the double, typed as the harness's `Inbox`.
 */
export function emptyInbox(): Inbox {
  return {
    nextTurn: [],
    nextStep: [],
    clear: () => unreached('clear'),
    append: () => unreached('append'),
    prepend: () => unreached('prepend'),
    replace: () => unreached('replace'),
    remove: () => unreached('remove'),
    splice: () => unreached('splice'),
  }
}
