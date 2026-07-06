# GBrain Skill Resolver

This is the dispatcher. Skills are the implementation. **Read the skill file before acting.** If two skills could match, read both. They are designed to chain (e.g., ingest then enrich for each entity).

> **OpenClaw 路径：** 下表 Skill 列均为 `references/<name>/SKILL.md`（相对
> `${OPENCLAW_SKILL_GBRAIN_DIR}/references`）。上游 gbrain 文档中的 `skills/`
> 与此处 `references/` 等价。

## Always-on (every message)

| Trigger | Skill |
|---------|-------|
| Every inbound message (spawn parallel, don't block) | `references/signal-detector/SKILL.md` |
| Any brain read/write/lookup/citation | `references/brain-ops/SKILL.md` |

## Brain operations

| Trigger | Skill |
|---------|-------|
| "What do we know about", "tell me about", "search for", "who is", "background on", "notes on" | `references/query/SKILL.md` |
| "Who knows who", "relationship between", "connections", "graph query" | `references/query/SKILL.md` (use graph-query) |
| Creating/enriching a person or company page | `references/enrich/SKILL.md` |
| Where does a new file go? Filing rules | `references/repo-architecture/SKILL.md` |
| "where does this brain page go", "file this in the brain", "brain taxonomist", "taxonomy check", "refile brain page", "which directory does this page go" | `references/brain-taxonomist/SKILL.md` |
| "EIIRP", "everything in its right place", "store this research", "put this in the brain", "make this re-doable", "DRY this up", "file all of this", "organize all of this work", "archive this research thread" | `references/eiirp/SKILL.md` |
| Fix broken citations in brain pages | `references/citation-fixer/SKILL.md` |
| "citation audit", "check citations", "fix citations" | `references/citation-fixer/SKILL.md` (focused fix). For broader brain health, chain into `references/maintain/SKILL.md` |
| "Research", "track", "extract from email", "investor updates", "donations" | `references/data-research/SKILL.md` |
| Share a brain page as a link | `references/publish/SKILL.md` |
| "validate frontmatter", "check frontmatter", "fix frontmatter", "frontmatter audit", "brain lint" | `references/frontmatter-guard/SKILL.md` |
| "what search mode", "is my cache hot", "tune my retrieval", "compare search modes", "clear search overrides" | `gbrain search modes/stats/tune` directly. See `references/conventions/search-modes.md` |
| "eval results", "search benchmark", "haters-immune methodology", "regression check on retrieval" | `gbrain eval run-all` / `gbrain eval compare`. See `docs/eval/SEARCH_MODE_METHODOLOGY.md` |

## Content & media ingestion

| Trigger | Skill |
|---------|-------|
| "capture this", "save this thought", "remember this", "drop this in the inbox", "save to brain" | `references/capture/SKILL.md` |
| User shares a link, article, tweet, or idea | `references/idea-ingest/SKILL.md` |
| "watch this video", "process this YouTube link", "ingest this PDF", "save this podcast", "process this book", "summarize this book", "PDF book", "ingest it into my brain", "what's in this screenshot", "check out this repo" | `references/media-ingest/SKILL.md` |
| Meeting transcript received | `references/meeting-ingestion/SKILL.md` |
| "文档对象拆分", "文档内容拆分", "按对象拆分", "数字员工对象", "拆分需求/业务对象", "拆需求", "拆 bug", "从会议/PRD/PDF 提需求", "extract requirements and bugs", "PRD 提需求", "document object split" | `skills/document-object-split/SKILL.md` |
| Generic "ingest this" (auto-routes to above) | `references/ingest/SKILL.md` |

## Thinking skills (from GStack)

| Trigger | Skill |
|---------|-------|
| "Brainstorm", "I have an idea", "office hours" | GStack: office-hours |
| "Review this plan", "CEO review", "poke holes" | GStack: ceo-review |
| "Debug", "fix", "broken", "investigate" | GStack: investigate |
| "Retro", "what shipped", "retrospective" | GStack: retro |

> These skills come from GStack. If GStack is installed, the agent reads them directly.
> If not, brain-only mode still works (brain skills function without thinking skills).

## Operational

| Trigger | Skill |
|---------|-------|
| Task add/remove/complete/defer/review | `references/daily-task-manager/SKILL.md` |
| Morning prep, meeting context, day planning | `references/daily-task-prep/SKILL.md` |
| Daily briefing, "what's happening today" | `references/briefing/SKILL.md` |
| Cron scheduling, quiet hours, job staggering | `references/cron-scheduler/SKILL.md` |
| Save or load reports | `references/reports/SKILL.md` |
| "Create a skill", "improve this skill" | `references/skill-creator/SKILL.md` |
| "Skillify this", "is this a skill?", "make this proper" | `references/skillify/SKILL.md` |
| "Compress my resolver", "AGENTS.md too large", "RESOLVER.md too big", "functional area dispatcher", "shrink routing table" | `references/functional-area-resolver/SKILL.md` |
| "Is gbrain healthy?", morning health check, skillpack-check | `references/skillpack-check/SKILL.md` |
| "harvest this skill into gbrain", "publish this skill to gbrain", "lift this skill upstream", "share this skill with other gbrain clients", "promote my skill to gbrain" | `references/skillpack-harvest/SKILL.md` |
| Post-restart health + auto-fix, "did the container restart break anything", smoke test | `references/smoke-test/SKILL.md` |
| Cross-modal review, second opinion | `references/cross-modal-review/SKILL.md` |
| "Validate skills", skill health check | `references/testing/SKILL.md` |
| Webhook setup, external event processing | `references/webhook-transforms/SKILL.md` |
| "Spawn agent", "background task", "parallel tasks", "steer agent", "pause/resume agent", "gbrain jobs submit", "submit a gbrain job", "submit a shell job", "shell job" | `references/minion-orchestrator/SKILL.md` |
| "present options", "ask before proceeding", "choice gate", "user decision" | `references/ask-user/SKILL.md` |

## Setup & migration

| Trigger | Skill |
|---------|-------|
| "Set up GBrain", first boot | `references/setup/SKILL.md` |
| "Now what?", "fill my brain", "cold start", "bootstrap", "import my data", "what should I import first" | `references/cold-start/SKILL.md` |
| "Migrate from Obsidian/Notion/Logseq" | `references/migrate/SKILL.md` |
| Brain health check, maintenance run | `references/maintain/SKILL.md` |
| "Extract links", "build link graph", "populate timeline" | `references/maintain/SKILL.md` (extraction sections) |
| "Run dream", "process today's session", "synthesize my conversations", "consolidate yesterday's conversations", "what patterns did you see", "did the dream cycle run" | `references/maintain/SKILL.md` (dream cycle section) |
| "Brain health", "what features am I missing", "brain score" | Run `gbrain features --json` |
| "Set up autopilot", "run brain maintenance", "keep brain updated" | Run `gbrain autopilot --install --repo ~/brain` |
| "Upgrade gbrain", "update gbrain", "gbrain update available", `UPGRADE_AVAILABLE`, "is gbrain up to date" | `references/gbrain-upgrade/SKILL.md` |
| Agent identity, "who am I", customize agent | `references/soul-audit/SKILL.md` |
| "Populate links", "extract links", "backfill graph" | `references/maintain/SKILL.md` (graph population phase) |
| "Populate timeline", "extract timeline entries" | `references/maintain/SKILL.md` (graph population phase) |

## Identity & access (always-on)

| Trigger | Skill |
|---------|-------|
| Non-owner sends a message | Check `ACCESS_POLICY.md` before responding |
| Agent needs to know its identity/vibe | Read `SOUL.md` |
| Agent needs user context | Read `USER.md` |
| Operational cadence (what to check and when) | Read `HEARTBEAT.md` |

## Disambiguation rules

When multiple skills could match:
1. Prefer the most specific skill (meeting-ingestion over ingest)
2. If the user mentions a URL, route by content type (link → idea-ingest, video → media-ingest)
3. If the user mentions a person/company, check if enrich or query fits better
4. Chaining is explicit in each skill's Phases section
5. When in doubt, ask the user (see `references/ask-user/SKILL.md` for the choice-gate pattern)

## Conventions (cross-cutting)

These apply to ALL brain-writing skills:
- `references/conventions/quality.md` — citations, back-links, notability gate
- `references/conventions/brain-first.md` — check brain before external APIs
- `references/conventions/brain-routing.md` — which brain (DB) and which source (repo) to target; cross-brain federation is latent-space only
- `references/conventions/schema-evolution.md` — when to add a type vs alias vs prefix (read before `schema-author`)
- `references/conventions/subagent-routing.md` — when to use Minions vs inline work
- `references/ask-user/SKILL.md` — choice-gate pattern for human input at decision points
- `references/_brain-filing-rules.md` — where files go
- `references/_output-rules.md` — output quality standards

## Uncategorized

| Trigger | Skill |
|---------|-------|
| "personalized version of this book", "mirror this book", "two-column book analysis", "apply this book to my life", "how does this book apply to me" | `references/book-mirror/SKILL.md` |
| "enrich this article", "enrich brain pages", "batch enrich", "make brain pages useful" | `references/article-enrichment/SKILL.md` |
| "strategic reading", "read this through the lens of", "apply this to my problem", "what can I learn from this about", "extract a playbook from" | `references/strategic-reading/SKILL.md` |
| "concept synthesis", "synthesize my concepts", "find patterns across my notes", "build my intellectual map", "trace idea evolution" | `references/concept-synthesis/SKILL.md` |
| "perplexity research", "what's new about", "current state of", "web research", "what changed about" | `references/perplexity-research/SKILL.md` |
| "crawl my archive", "find gold in my archive", "archive crawler", "scan my dropbox for", "mine my old files for" | `references/archive-crawler/SKILL.md` |
| "verify this academic claim", "check this study", "academic verify", "validate citation", "is this study real" | `references/academic-verify/SKILL.md` |
| "make pdf from brain", "brain pdf", "convert brain page to pdf", "publish this page as pdf", "export brain page" | `references/brain-pdf/SKILL.md` |
| "voice note", "ingest this voice memo", "transcribe and file", "voice note ingest", "save this audio note" | `references/voice-note-ingest/SKILL.md` |
| "add a page type", "add a type to my schema", "schema author", "schema mutate", "schema pack add", "my brain has untyped pages", "propose new types from my corpus", "backfill page types", "evolve my schema", "researcher type", "make X an expert type" (dispatcher for: gbrain schema active/list/show/validate/graph/lint/stats/explain/use/downgrade/reload/init/fork/edit/diff/add-type/remove-type/update-type/add-alias/remove-alias/add-prefix/remove-prefix/add-link-type/remove-link-type/set-extractable/set-expert-routing/detect/suggest/review-candidates/review-orphans/sync) | `references/schema-author/SKILL.md` |
| "unify my types", "migrate to gbrain-base-v2", "94 types to 14", "apply canonical taxonomy", "clean up my page types", "pack upgrade", "shrink type proliferation", "consolidate page types", "retype pages to canonical" (dispatcher for: gbrain onboard --check, gbrain onboard --check --explain, gbrain jobs submit unify-types, gbrain pages restore) | `references/schema-unify/SKILL.md` |

