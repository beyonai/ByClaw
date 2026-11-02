# Agent Note: the board decides too

Status: implemented

## Problem

`devflow-web` had no write surface, and said so in its own module doc: *the
face is read-only… card moves stay on the model tool plane, the `/devflow`
command plane, and the approval plane.* Its README put it harder — *changing
channels is not a reason to relax it.*

So a person looking at the board could see a finished card and had no way to
file it, or see work that was never going to happen and no way to drop it. They
had to leave the surface they were reading and retype the card id into
`/devflow`.

The rule that forbade this was answering a different question than the one
being asked.

## Decision

The board writes, and what it writes is exactly three things: sweep the
finished cards, file one card, drop one card.

**The plane split is about who decides, not which channel carries it.** The
model tool plane executes — creation, stage moves, claims, artifact
registration — and none of that appears on this face. Filing and dropping were
never the model's to make; they are decisions people make, and `/devflow` was
merely the only surface people had. The board is another one. Nothing about
that makes it a second executor, which is the thing the original rule was
protecting.

The model tool plane still performs none of these, and a test asserts the
absence of `devflow_archive` and `devflow_restore` rather than merely not
registering them.

### Two tables, not one

`WRITES` sits beside `READS` rather than inside it. A read's failure is a
settled "cannot see it" whose reason stays host-side, because the store names
files under the devflow root and a browser must not learn a path it could not
have sent. A write's domain rejection is the opposite: it is the branch the
caller acts on, and travels with a stable code the board renders in its own
words. One table carrying both semantics would have to give up one of them.

Infrastructure failures still stay host-side for writes, exactly as for reads.
Only *domain* rejections carry a message, and their text describes card state
and what the caller sent — never a path.

### The host says who is writing

A write's actor is `{ kind: 'human' }`, filled by the host. A browser does not
get to claim an identity, and the request names a session rather than a root,
so it cannot name a path either. It is deliberately distinct from the
`/devflow` plane's `command` actor: both are people deciding, and the journal
should say which surface the decision was made on.

Root resolution never reaches this package. The Definition grew
`archiveDoneForSession` / `archiveForSession` / `abandonForSession` beside the
existing `listForSession`, each taking `Omit<Request, 'root'>` — so a caller
that names a session **cannot** also name a path, by type rather than by
convention.

### Restoring is not offered

Filing and dropping are on the board; restoring is not. Offering "take it back"
beside "drop it" reads as though dropping were reversible, and it is not. A
restore is made on `/devflow`, where the archive is read in full.

### Which action a row offers follows from the card

A finished card offers filing; every other card offers dropping. Rendering
both would put a button on every row whose only possible outcome is a refusal,
and the sweep is absent entirely while nothing is finished — a control that is
usually inert teaches readers to stop seeing it.

### The reason is the confirmation

Filing is reversible, so it commits on the click. Dropping is not, and the
store refuses a blank reason, so it opens a prompt whose confirm stays disabled
until a reason is written.

There is no separate "I understand this cannot be undone" tick. Writing why the
work stopped is already a deliberate act; a checkbox on top of it is ceremony,
not protection — and the sentence it produces is the entire record of why the
card left the board, which a checkbox is not.

## Alternatives considered

**Leave the face read-only and keep sending people to `/devflow`.** Honest to
the original rule as written, and it makes the surface a person is already
reading unable to act on what it shows. The rule's own justification — no
second executor — is untouched by filing and dropping.

**Use the `RiskConfirmation` primitive.** It is the harness's affordance for
acknowledging an irreversible act, and it takes no children, so there is
nowhere to type the reason the store requires. `Modal` hosts both the record
and the confirmation; the reason gates the confirm.

**Reveal the row actions on hover.** Keeps the row visually quiet, and an
action a keyboard or a touch never uncovers is an action those readers do not
have. The buttons are always rendered.

**Offer restore on the board.** Symmetric with filing, and it would make
dropping look reversible on the one surface where dropping is one click away.

**Let the browser pass a full seam request.** Fewer methods to maintain, and it
hands an untrusted caller the actor, the root, and the choice of verb.

## Consequences

**The board is no longer read-only, and several documents said it was.** The
module doc, both READMEs of `devflow-web`, `devflow-ui`'s Model Experience
section, the walkthrough's composition summary, and the `devflow-workflow`
skill's section on how a card ends all stated the old rule and are updated
here. The skill's sentence that *no model-facing tool performs any of them*
survives unchanged, because that part is still true.

A row is a button that opens the detail, so the actions are its siblings, never
its children: a button nested in a button is invalid, and the browser hands the
inner one's click to the outer.

`revision-mismatch` is an ordinary outcome rather than an error. Another plane
may move a card between the board reading it and a reader clicking, so that
refusal refreshes the board first and then reports it in its own words — the
reader is told the card moved, not that they did something wrong.

An existing test asserted that each row carried exactly one button and that the
list was read-only. It is not any more; the assertion and the test's name were
changed with it.
