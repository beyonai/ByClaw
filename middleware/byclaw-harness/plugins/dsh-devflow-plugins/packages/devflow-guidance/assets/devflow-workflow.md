# devflow-workflow

The devflow tools commit individual moves on a durable task board; this skill
owns the judgment between the calls — when a card should exist, which pipeline
it should take, how a large requirement decomposes, what makes an artifact
worth a gate's yes, and how to respond when a gate says no. Per-call
obligations (revision tokens, reading a card before moving it) are stated in
the tool descriptions and enforced by the store; nothing here repeats them.

The board outlives the conversation and is shared with humans and later
sessions. Every judgment below reduces to one question: will the next reader —
a gate, a reviewer, another session — understand the board without this chat?

## 1. Whether to touch the board

- **Agreed work becomes a card before the work starts.** When a discussion has
  converged on something that will be built — a plan, an accepted proposal, a
  requirement — create the card first, with the requirement and its acceptance
  criteria in the body in words that stand alone. The next session reads the
  card, not this conversation; a body that says "as discussed above" is empty.
- **A workspace with an active board is read before it is added to.** When
  starting work where a board already exists, run `devflow_list` before
  creating anything: the work may already be tracked, half-done, claimed by
  another session, or blocked on a stated reason. Continue the existing card —
  a duplicate splits one requirement's history across two journals.
- **Pure conversation leaves the board alone.** Questions answered, code
  explained, options explored — a turn that ends with nothing to build creates
  no card. Cards track commitments, not conversations, and a board padded with
  cards nobody will execute buries the ones someone will.

## 2. Service class

The class is fixed at creation and selects which pipeline edges the card may
take. It can never be changed, so it prices the whole card up front:

- **standard** — the default; walks the whole pipeline. The answer when in
  doubt: an unnecessary design round costs one stage, while a skipped
  necessary one is discovered in review or in production.
- **express** — skips design, readiness, and independent verification, keeps
  peer review. For small, well-understood changes whose risk does not justify
  a design round: a fix with an obvious shape, a mechanical migration. The
  cost is that nothing but review independently checks the result.
- **emergency** — gives up review as well; the card can go from developing
  straight to done. For an incident where shipping now beats every check. The
  state machine records no debt for this: the follow-up — reviewing what
  shipped, landing the real fix — is an ordinary card you create yourself, or
  the shortcut has quietly cost the review forever.

A stage a class skips is not a bypassed gate — the card never traverses that
edge — but shortcut edges are ordinary edges, and a deployment may gate them
like any other. Escalating live work means creating a new card, not bending
the class of the current one.

## 3. Decomposing a requirement

A requirement too big for one card becomes a parent card plus one child card
per slice, each child created pointing at the parent. Two rules make the
shape work:

- **Child bodies are self-contained.** The session executing a child may hold
  only that child. State the slice's own requirement and acceptance criteria
  in the child body and let the parent link carry the context — "see parent"
  makes every future reader do a join.
- **The parent finishes last.** A parent cannot reach `done` while any child
  is unfinished; the completion gate vetoes the move and names what is left.
  The parent's own review and verification stages are for the integration
  pass over the finished slices, not a repeat of each child's review.

The breakdown is one level deep and fixed at creation. Slice by deliverable
outcome, not by activity: "the parser" and "the renderer" are cards, "write
tests" is not — each card carries its own tests through its own pipeline.

## 4. Artifacts

An artifact is the evidence a stage leaves behind and the input the next gate
judges. Which kinds this deployment requires on which edge is configuration,
and the tool results already answer it: single-card results carry an
artifact-gate preflight listing the current stage's required kinds, each with
its structure template and status. **That preflight is the authority** — read
the requirements from the result rather than guessing kinds from memory or
from this skill.

What makes a registration good is the same for every kind:

- Written for its reader: the gate, checker, or human who decides the next
  edge with this document as evidence. Shape it toward a verdict — what was
  done, what was checked, what is known to remain.
- Self-contained, with claims verifiable against the repository rather than
  against the chat.
- Honest about gaps. A gate that finds a named omission vetoes once; an
  artifact that hides one poisons every later stage that trusted it.

Registrations are immutable and the newest of a kind wins, so revising means
registering again, never editing history.

## 5. After a veto

A veto leaves the card exactly where it was, with a reason; an agent-gate veto
also writes its full report under the deployment's report directory. Read the
reason before acting, because it decides between two different moves:

- **The deliverable is inadequate; the stage is right.** Fix the work,
  register a revised artifact of the **same kind**, and retry the same
  transition. The retry is judged against the newest registration: a changed
  input revision misses the verdict cache and re-dispatches the checker,
  while a retry with nothing changed reuses the cached verdict — the same no,
  without paying the checker again. Never resubmit unchanged input hoping for
  a different verdict.
- **The fault belongs to an earlier stage.** When the reason shows the design
  is wrong rather than the implementation incomplete, take the rework edge
  back to the stage that owns the fault and record why. Patching around a
  wrong design in `developing` produces an implementation artifact defending
  a design nobody believes.

Repeated vetoes on one edge with no new information is a conversation to have
with the user, not a loop to continue.

## 6. When a card stops

Three different things end work on a card, and they do not overlap:

- **It is finished.** A `done` card is filed by a human, on `/devflow` or from
  the board. Filing is reversible — a filed card can be restored — and it keeps
  its whole journal either way.
- **It is stuck but still wanted.** Move it to `blocked` with the reason.
  `blocked` remembers the stage it interrupted and recovers only to that one,
  so a card parked here returns to work where it left it.
- **It will not be built.** A human abandons it with a reason. Abandoning is
  terminal: nothing may follow it in the journal, so the card cannot be
  restored, and its reason is the entire record of why the work stopped.

The store keeps the three apart with stable rejections: a card that is not
`done` cannot be filed, and a `done` card cannot be abandoned — a delivered
outcome is settled by filing it, not by a decision not to deliver it.

Two consequences worth knowing before you suggest either:

- **Abandoning a requirement does not abandon its slices.** Each child stays on
  the board as a top-level row carrying its backlink. When a whole requirement
  is dropped, every slice is dropped on its own; when it is only re-planned,
  the slices may still be the work.
- **A veto is not a reason to stop.** Section 5's loop ends in a conversation
  with the user, and this is what that conversation decides. Abandoning is the
  user's call about the work, never an agent's way past a gate that keeps
  saying no.

Filing, restoring, and abandoning are all human decisions, and **no
model-facing tool performs any of them**. Which surface a person makes them on
is their business — `/devflow` and the sidebar board both carry filing and
abandoning; restoring is only on `/devflow`, because offering "take it back"
beside "drop it" would read as though dropping were reversible.

Reading the archive is not a decision, and is yours: cards already filed are
ordinary context, and `devflow_list` with `set: "archived"` is worth a call
before decomposing something similar — how that requirement was sliced, and
what its slices turned out to be, is on the board rather than in anyone's
memory.

## 7. Claims and leases

A card's lease is an exclusive claim. Taking a ready card claims it and moves
it into development in one step, and a failed move releases the lease, so a
failed take leaves nothing behind.

- Take a card before working it, and work the cards you have taken. The lease
  is what lets several sessions share one board without silently doing the
  same work twice.
- A card another holder has claimed is theirs. Do not work around a held
  lease; taking over a lease whose holder went away is a human decision on the
  `/devflow` plane, not a call you make.
- The lease does not renew itself. Finish the stage you claimed for within
  the session; a claim left behind stalls the card until a human notices and
  takes it over.

## 8. Browser acceptance

When acceptance criteria require browser evidence, drive the browser with the
`browser` tool: one isolated context per agent session, bounded actions over
indexed elements. Discover the project's own application, startup procedure and
acceptance data rather than asking the user to configure a global profile.

Before protected checks, ask only for what is missing: test role or tenant,
login route or an authorized source of private credentials, and which test side
effects are allowed. Let the user perform SSO or MFA themselves in the prepared
browser. Never request passwords or cookies in chat, task files or reports, and
remember only non-secret choices under `.devflow`. A missing account or an
expired session is a preparation blocker, not a failed product assertion:
resume with the user and confirm the logged-in role before continuing.

Evidence is the point, so collect it as you go — the URL and title each
assertion ran against, and a screenshot of anything you claim to have seen —
and register the run as a Markdown artifact on the card. Report partial
coverage and blocked cases honestly; a claim no observation backs is worse than
an admitted gap. Then follow the normal Devflow completion transition. An
earlier run's report cannot stand in for fresh gate execution, and where the
deployment mounts no browser tooling at all, say so explicitly rather than
asserting from the code alone.
