# Midscene access preparation and card reports

## User outcome

Agents discover project context before asking for missing test identity, login route,
role/tenant, data and allowed side effects. Users do not maintain another global
profile or copy passwords into recorded model actions. HTML evidence remains with
the task card and can be opened from its artifact list.

## Research

The repository already has browser and acceptance skills; workflow guidance routes
to them. Project mode did not pass storageState although the browser worker already
supported it. The private snapshot parser validates target origin and owner-only
files outside the repository. Reuse that boundary rather than introduce inline
credentials.

[Official Skills](https://midscenejs.com/zh/skills) distinguish a fresh browser from
CDP/Bridge sessions. [Midscene Test configuration](https://www.midscenejs.com/midscene-test/configuration)
recommends credential references because node inputs are recorded. These are design
references; this package keeps its pinned SDK, not the latest Test API.

[Data privacy](https://midscenejs.com/data-privacy) describes screenshot/page data
sent to the configured model. Keeping credentials private does not anonymize report
screenshots. Use authorized test data.

Harness Markdown rendering disables relative links. The existing card file-resource
and HTML preview surfaces can expose standalone SDK HTML by registering its path.
Offline Markdown/HTML copies keep relative links for normal local browsing.

## Implementation contract

- Optional project authentication requirement and role label; private imported state
  keyed by project/origin/role, no passwords or cookie values in settings or tools.
- Missing/invalid required snapshots stop execution; login acceptance is still
  asserted before protected actions. Interactive login preparation stays separate.
- Formal and card-bound exploratory runs archive published assets; old exploratory
  runs require an explicit card. Failed runs remain evidence, never completion proof.
- Exclude temporary files and authentication state; reject symlink traversal and
  conflicting existing archives. Keep source runtime evidence for recovery/recheck.
- Register artifacts through Devflow. A gate may write archive files but cannot
  reenter artifact registration while a transition owns the commit lock.

## Validation

Use real Loader, Chromium, authenticated fixture server, filesystem store, gates and
artifact API. Verify missing/expired/foreign login, role isolation, successful state
injection, unchanged source identity, archive HTML/assets, failure evidence and
fresh completion execution. Controlled model fixtures prove integration, not visual
model accuracy or acceptance of the user's business application.

## Verification results

- Full regression: 173 files / 2346 tests pass; per-source-file statements,
  branches, functions and lines all 100%.
- Final HTML artifact registration fix: 82 focused tests pass; both affected
  runtime files retain all four metrics at 100%.
- Source/tools and Midscene test TypeScript, lint, build and 23-package tarball
  preflight pass.
- Actual Loader/Chromium fixture uses a protected server requiring a private
  session cookie. Explicit run and fresh completion gate both receive the state;
  card-local SDK HTML and separate artifact registrations are verified. Model
  and human approval responses remain controlled in this integration fixture.
- Existing DSH runtime, user project cards and the unbound historical exploration
  run were not changed. Historical migration awaits its intended card identity.

## Card-aware diagnostics

`midscene_doctor(card)` resolves the selected card's approved binding. Omitting the
card in project mode reports formal acceptance as unchecked, not missing. Missing
references are listed individually with a binding/deployment preparation action;
configured references still require file, deployment and execution verification.
An unavailable completion service directs inspection of devflow-gates and its shell
dependency, without interpreting it as an uninstalled package or authorizing an
exploration fallback for required acceptance.

Validation: 50 focused tests pass, changed managed source retains four-metric 100%
coverage; source/tools/test TypeScript, lint, build and independent read-only review
pass. Running user profiles are unchanged.
