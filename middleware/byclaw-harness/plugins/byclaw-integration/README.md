# @byclaw/dsh-integration

English | [中文](README.zh.md)

`@byclaw/dsh-integration` is an independent DeepSeek Harness (DSH) plugin for ByClaw. It does not modify DSH or ByClaw source code. It uses DSH plugin extension points, `@byclaw/by-framework`, and the separate AgentTeams plugin to synchronize resources, configure models, receive messages, and coordinate multiple agents.

## Install in DSH

This private workspace package is built from a DSH source checkout and is not published to the npm registry. Place this directory at `plugins/byclaw-integration`, install AgentTeams first, then build and add both local packages to the target profile:

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm --filter @byclaw/dsh-agent-teams run build
pnpm --filter @byclaw/dsh-todo-execution run build
pnpm --filter @byclaw/dsh-integration run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/agent-teams
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-todo-execution
dsh plugin --profile web add /path/to/deepseek-harness/plugins/byclaw-integration
dsh --profile web --dump-config
```

Copy the repository [`.env.example`](../.env.example) to the DSH launch directory, fill the deployment values, and keep the resulting `.env` untracked. The bundled patch enables this plugin. Fatal configuration or core Redis connection failures log the complete setup error, release partially opened resources, and leave the DSH host running with the ByClaw runtime disabled. Resource snapshots, group runtimes, template generations, and Skill downloads instead use the tolerant resource path described below, so those failures do not block Worker registration.

## Runtime structure

The plugin registers a `BYCLAW_DSH` Worker and projects ByClaw-authorized resources into two reusable template kinds:

- Digital employees: `byclaw-employee-<resourceId>` creates one ordinary DSH child agent without creating a team.
- Expert groups: `byclaw-group-<resourceId>` first creates the group's dedicated leader agent. The leader then creates a task-specific AgentTeams runtime team through `byclaw-team-<resourceId>`.

On the untargeted route, the main agent discovers resources and selects templates; it does not replace an expert group's leader. On the direct route, the selected digital employee or expert-group leader is composed on the inbound DSH root itself. The same ByClaw conversation and expert-team template reuse one runtime team, and later tasks append to the same activity panel. The leader calls `agent_teams_delete` only when the user explicitly asks to end or abandon the team. Root and member sessions are reused, so the ByClaw frontend always shows a one-to-one member session hierarchy.

Team/template waits use a ten-minute inactivity inspection interval, not a task duration limit. Session events (including streamed output), live status changes and team progress renew it. A silent task prompts its actual captain through the durable DSH inbox to inspect members, resolve blockers or retry, and deliver the final answer. Nested teams notify their own captain; unresolved delegations fall back to the response agent. The original command and output route remain open. Pending inspections are deduplicated, failed inspections retry after the next interval, and cancellation, settlement or shutdown stop recovery. A captain ending its turn cannot close a retained team while members are still delivering output.

While a team continues in the background, `BYCLAW_DSH_BUSY_ENTER=steer` sends a follow-up to a busy captain at its next model step without waiting for the current turn to become idle. The default `queue` mode waits for the captain's current turn. An idle captain starts a separate follow-up turn after its earlier output is drained. Each reply keeps its own message and trace; output before the steering input and member output remain on the original task. Follow-up attachments and resources apply only to the responding captain at the admitted step, leaving background members' task context intact. This setting also controls the native DSH composer's busy Enter behavior.

Web clients also need the ByClaw backend to admit a new message when `rootActive=false` and `acceptingInput=true`, and retain concurrent traces until their own completion. A backend that rejects every message while the team is `running` blocks the request before this plugin receives it.

The integration publishes sandbox activity to Redis topic `byai_gateway:registry:worker:stats:dsh` every 30 seconds and immediately when the aggregate busy state changes. A root Agent may be idle while AgentTeams children remain busy; their live runtime status keeps the heartbeat busy until the last child finishes. Pending user interactions also retain the sandbox because they still own resumable runtime state. The publisher uses a bounded coalescing queue, and plugin disposal stops its timer before closing the shared Redis client. Both `userCode` and the `BYCLAW_DSH` AgentType come from plugin configuration and environment-derived startup settings; inbound commands and AgentTeams event bodies cannot override this identity.

Skill synchronization fetches the remote version first and reuses a local cache when `code + version` is unchanged; refreshed signed download URLs do not force another archive download. ZIP downloads occur only after a version change, with bounded retries for timeouts, throttling, and server-side 5xx responses. Skill failures are tolerant by default: a permanently unavailable Skill is logged as an error, omitted from that generation's employee/member templates, and does not block Worker startup. The bundled integration profile also limits projection concurrency to `2` and uses a 15-second single attempt so cold-start downloads do not overload the Hub. An explicitly configured `allowSkillSyncFailure=false` rejects the staged generation and preserves the previous cache, while the Worker still starts with the available or last-good resources.

```text
ByClaw 入站
  -> BYCLAW_DSH Worker
  -> default: DSH main Agent -> template
  -> explicit agent_id or @resource: matching template as DSH root -> (expert group) AgentTeams members
```

When an inbound message includes structured `agent_id`, the plugin resolves the authorized catalog and composes the matching template directly on the inbound root Agent. The business instruction therefore has no main-Agent routing/model turn and no template-child settlement hop. The `agentId`, `agent_code`, and `agent_name` fields (including camelCase spellings) are descriptive metadata and do not select or validate the target. Without a structured ID, one unambiguous `@resource-name` or `@resource-code` mention can select the target and is removed from the delivered task. Messages without a target stay on the existing main-Agent route. Unknown, unauthorized, or ambiguous targets fail before execution. A direct root remains bound to its selected template for the lifetime of that session. Expert-group members still run as AgentTeams children; their events wake the group leader asynchronously without polling.

## Dynamic resources and Skills

The plugin attempts one authorization-scoped cold-start synchronization, starts the authorization and resource listeners, and then starts the Worker. Missing or malformed Redis snapshots are logged and skipped independently; an expert group with an unavailable member is skipped as a unit. A broader generation failure retains an empty catalog or the last-good generation and does not block Worker startup. The watcher begins in polling mode when authorization is unavailable and attaches the authorization keyspace subscription after recovery. It refreshes resources:

- before `byclaw_list_resources` or template instantiation;
- when the current user's authorization Hash changes;
- when Redis publishes a supported change on `byai:pub:dig_employee_change`.

The current `USER_CODE` maps through `SHARE_BFM_USER_CODE_<USER_CODE>` to an internal user ID. `USER:RESOURCES:AUTH:<userId>` is the sole resource-discovery authority: the plugin parses only `DIG_EMPLOYEE` grants, concurrently reads those exact `DIG_EMPLOYEE_<resourceId>` snapshots, and target-loads only extra member IDs declared by an authorized expert group. It retains authorized group/member IDs in the watch scope even when their current snapshots are unavailable, so a later CREATED or UPDATED event can recover them. It does not call `discoverMine` or `findDetailsById` for catalog discovery and does not scan global `DIG_EMPLOYEE_*` keys. Redis snapshots provide employee and group base content; expert-group prompts, models, effective members, and configuration versions still come from `orchestrators/resolve-runtime`. A runtime roster that references an unavailable employee skips only that group. Skill version and archive requests still use ByClaw BE.

The authorization watcher subscribes to the current Hash's Redis keyspace pattern when `notify-keyspace-events` supports it and always polls as a fallback. A temporarily missing authorization key retains the last successful generation; an existing but empty Hash confirms that all grants were revoked. The resource channel accepts `DIG_EMPLOYEE_CREATED`, `DIG_EMPLOYEE_UPDATED`, `DIG_EMPLOYEE_DELETED`, and `DIG_EMPLOYEE_SKILLS_SYNCED`, filters updates to directly authorized or authorized-group member IDs, merges each debounce window by ID, makes DELETE win, and drops stale `changedAt` events. Authorization and resource signals enter the same serialized synchronization queue.

At info log level the watcher records its channel and keyspace/poll mode, authorization signals, resource ID/type/`changedAt`, ignored stale or unauthorized events, queued batch size, and refresh completion. It never logs authorization headers, Redis credentials, resource bodies, prompts, or Skill content.

Each refresh acquires the exclusive generation coordinator before snapshotting the live catalogs, stages a complete generation of Skills, digital-employee templates, expert-group templates, and AgentTeams adapters, then holds the coordinator through publication, rollback, and backup cleanup. Template instantiation, template-backed AgentTeams creation, and template listing use shared admission; AgentTeams template saving uses exclusive admission. Concurrent consumers therefore use either the complete preceding generation or the complete replacement, and a save admitted after publication keeps its unrelated template. During unload the coordinator rejects new admission, drains admitted operations and refresh work, closes Worker, session, and Redis resources, then removes the service. A successful refresh removes revoked ByClaw-owned artifacts while preserving unrelated files; a failed refresh retains the last complete generation. A first-startup resource failure is logged, but the Worker still registers and later refresh hooks can retry synchronization.

Digital-employee persona projection follows ByClaw instruction normalization: `relPrompt` takes precedence over `corePersonaDefinition`; nested JSON prompt records retain their headings; and `ability`, `processingFlow`, and `coreCompetencies` become separate sections rendered once for both direct employees and expert-group members. Expert-group leader templates prepend non-overridable DSH and AgentTeams orchestration, attachment, failure-handling, and settlement rules, then append the authorized `resolve-runtime` business prompt. Refresh also removes legacy `byclaw-group-*` AgentTeams adapters while preserving unrelated templates.

Digital-employee Skills synchronize into `agentTemplateDir/byclaw-skills` using the `baiying-enhance` download semantics. Credential-bearing catalog and Skill requests remain on the configured `baseUrl` origin and do not follow redirects automatically. The plugin adds per-agent views to the existing registry's `snapshot/list/get` methods. Native DSH `tool-skill` still injects metadata through `skill-catalog` and loads bodies through the standard `skill` tool. No DSH source changes are required.

Running employees (direct roots, delegated templates, and AgentTeams members) retain the complete native DSH catalog—including global, project, user, preset, and plugin-bundled Skills—and add **deployment builtin Skills + current Redis associations** as an overlay. Ordinary agents retain their existing catalog plus deployment builtins. The builtin directory resolves from `builtinSkillDir`, then `BYCLAW_SKILLS_DIR`, then repository `builtin/skills`; only immediate Skill directories are loaded. Docker already sets `/opt/byclaw/builtin/skills`. Multiline YAML and invocation flags are preserved. On name collisions, associated Skills override deployment builtins, and deployment builtins override the native DSH entry.

Employee and Skill watch events prepare a complete memory overlay before publishing it with the filesystem generation. Live agents bind to template identity, so their next registry query or standard load uses the new generation without recreating the session. Explicit empty `relSkills`, including the string `"[]"`, revokes all associations and exposes the underlying native DSH entry again when a name had been shadowed; deployment builtins and native Skills remain available. Preparation/publication failures retain the last generation; the tolerant per-Skill download rule above still applies. Body-only changes emit a durable `byclaw-skill-revision` reload notice, which contains no catalog metadata. Builtins are read at plugin startup; restart after updating the deployment payload.

This controls runtime catalogs and standard loading, not filesystem access. Already dispatched model requests and historical messages remain; new catalogs and loads reflect revocation, with a revision notice asking the model to stop relying on earlier instructions. A cold historical session's Web Skill picker can still show its preset catalog before activation; its model context uses the employee view once the agent resumes.

`byclaw_list_resources` returns only `id/code/name/description/template_id/invocation` needed for main-agent routing, plus compact member names and roles for expert groups. Child-agent Skills, tools, personas, models, and execution parameters do not enter the routing catalog. After `byclaw_instantiate_template`, the plugin dynamically loads those runtime resources from the local template for that agent.

## Dynamic models

`BYCLAW_REDIS_MODEL_ENABLED` selects the runtime model source for every agent received or instantiated through this plugin. The variable is enabled by default; unset, empty, `true`, `1`, `on`, and `yes` enable Redis model resolution. When enabled:

- Main agent: reads the current unique default LLM from Redis for every ByClaw inbound message.
- Digital employee: uses `prologue.modelId` when configured; if that model is unavailable or omitted, uses the default LLM.
- Expert-group leader: uses the model ID from the expert group's runtime configuration.
- Expert-group member: uses its digital employee's model ID when configured; if that model is unavailable or omitted, uses the default LLM. Team creation freezes the provider/model used for that run.

The model catalog is Redis Hash `byai:aimodel:typelist` field `LLM`; connection configuration is `byai:aimodel:config`. Each model maps to a unique `baiying-m-<instanceId>` provider and supports Anthropic Messages, OpenAI Completions, and OpenAI Responses. Encrypted authorization is decrypted in memory. Keys, tokens, and request headers are never written to templates, AgentTeams files, or DSH session events.

With Redis model resolution enabled, an unavailable explicit model first falls back to Redis's uniquely marked default LLM. Resolution then falls back to the last successful binding and finally to the plugin's configured `provider`/`model`. A non-unique or missing default and the absence of all later fallbacks fails at the earliest resolvable point; the plugin never silently selects an arbitrary model.

Set `DSH_LLM_LOG=info`, or set plugin `llmRequestLogLevel: info`, to write one safe audit record immediately before each dynamic ByClaw provider request. The record contains only the provider route, model, protocol, adapter-call reasoning effort, and allowlisted final wire thinking controls for OpenAI Completions, OpenAI Responses, or Anthropic Messages. The call effort may already contain a default materialized by DSH's LLM service and therefore does not claim an explicit user choice. Messages, system prompts, tools, headers, endpoints, tokens, and authorization values are never inspected or logged. The default is `off`; an explicit plugin value overrides `DSH_LLM_LOG` without reading or validating it. Audit failures do not alter the payload or prevent dispatch, and a pre-existing pi-ai `onPayload` callback retains its replacement and error behavior.

`false`, `0`, `off`, or `no` disables Redis model resolution. In that mode the main agent, digital employees, expert-group leaders, and expert-group members all use the configured local `provider`/`model`; resource model IDs are ignored for execution, and the plugin does not read the Redis AI-model Hashes or register dynamic ByClaw model routes. Disabling Redis models without both local fields, or supplying any other switch value, fails plugin startup.

## ByClaw message mapping

- Inbound routing accepts `extra_payload.agent_id`, matched against the current user's authorized digital employees or expert groups. A digital employee must be directly authorized; a group must be authorized for the current user. Codes and names in metadata are ignored for routing. If a structured ID is absent, one case-insensitive `@resource-name` or `@resource-code` mention selects the target; numeric-only mentions are ignored and the selected mention is removed from the task text. Unknown, unauthorized, or multiple matching targets are rejected before execution. Without a target the message stays on the main-Agent route.
- The ByClaw-facing DSH root session ID is exactly the inbound `session_id`, so resume and cross-system tracing use one identifier. On a direct route that root is the selected template instance itself; repeating the same target continues the same context, while attempting to rebind the live session to another template is rejected. The `[byclaw-dsh] 🎯 入站直达` / `scope=direct-root` log confirms that no main-Agent LLM turn handled the task.
- ByAI ingress may set `extra_payload.cwd` to an absolute working directory for a new DSH root session; otherwise the plugin `workspace` is used. A configured workspace ending in `/by/projects` supplies the corresponding `/by` root; container deployments continue to use `/by`. DSH's `SessionHeader.cwd` remains the authoritative source workspace, while immutable root identity and template binding live in the plugin-owned `byclaw_sessions` storage domain. No ByClaw-specific event is appended to DSH session logs.
- The business instruction remains an unchanged `source: user` message. `plugin:byclaw-context` has a session layer and a per-turn layer. The session layer declares the current user, source workspace, `.sessions/<sessionId>` session root, `.shared` root, and default artifact directory. The per-turn layer copies only language, `project_info`, inbound attachment metadata, `resource_list`, and connector availability. `channelExtension`, `groupChat`, multi-agent lane metadata, and authentication tokens are deliberately excluded. Standalone reports, checklists, and exports default to the current `.sessions/<sessionId>` while source edits stay in `cwd`. Durable messages deduplicate the session declaration and each inbound `messageId`; AgentTeams members inherit the namespace while retaining independent DSH session IDs.

### Repairing legacy session logs

Stop DSH before repairing its persistence directory. Preview changes first, then apply them only after reviewing the per-file counts:

```bash
byclaw-repair-legacy-session --dry-run /path/to/dsh/session-persistence
byclaw-repair-legacy-session --apply /path/to/dsh/session-persistence
```

The command preserves every record and only adds `ignorable: true` to legacy `byclaw/session-workspace` and `byclaw/root-binding` envelopes. Apply mode validates a sibling temporary artifact, keeps a timestamped backup, and atomically replaces the original. Re-running it is a no-op.
- Every inbound `AskAgent` writes terminal-visible lifecycle logs in order: received command identifiers; inherited ByClaw session namespace, DSH ID, effective `cwd`, and root/delegated scope; new, resumed, or continued session; non-secret model resolution (`sourceModelId`, provider, model, protocol, and resolution source); and task start with the complete instruction. When a digital employee, expert-group root, or delegated template child is composed, another log lists that template's effective builtin and associated Skill names and local paths. The plugin does not add login authorization, Redis passwords, endpoints, or model credentials; because an instruction can contain sensitive text, operators must treat these logs as conversation data.
- Root or directly targeted DSH text blocks -> `answerDelta` with `contentType=1002`; delegated child output stays under its child status node as `reasoningLogDelta/1002` instead of being merged into the final answer
- DSH reasoning and injected context -> `reasoningLogDelta` with `contentType=1001`
- Tool calls and results -> stateful `reasoningLogDelta` cards with `contentType=3015`, `objectType=tool_call`, and one shared tool-call message ID; JSON content follows the current FE `title/input/output/status/description` contract
- `ask_user_question` -> structured ByClaw question card with `contentType=3014`; `ResumeCommand` fills the answer and wakes the originating call
- `todo_write` and compatibility tool `task_plan` -> `todo/write` session event -> task-plan card with `contentType=2008`; a plan event uses `<inbound message ID>:plan` and records the inbound message ID as `parent_message_id`
- Child-agent creation, running, waiting, completion, or failure -> stateful `reasoningLogDelta/3009` status node; child reasoning, output, and tools use that node as their parent
- DSH session ID, parent session ID, delegation depth, raw event kind, and sequence are diagnostic metadata rather than visible tool-card content
- Successful Ask requests return selected final response text in `AgentTaskResult.content`; by-framework emits one `finalAnswer/1002` before the completion signal. Selection uses the last Step’s committed, non-interrupted Assistant text without tool-call blocks, after normal Turn completion, from the response Agent only.
- Requests without a selected final answer keep `content: ""`. Existing `answer` accumulation and historical-text fallback remain available to callers but do not populate `content`; errors and cancellation retain their existing handling, and Resume does not emit a separate final answer.

Inbound session IDs accept nonblank strings or positive safe integers and are normalized to strings for routing, interaction matching, and output. This includes session routing overrides. Numeric IDs outside JavaScript’s safe integer range are rejected; send those IDs as strings.

## Session extensions

`byclaw/session-setup` is an awaited serial event before new, resumed, or reused sessions accept input, including foreground follow-ups to background work. Its payload provides the explicit Agent instance, its scoped context, trusted command, and host adapters for the BE URL, current user login headers, and `/by/` path resolution. Types are exported from `@byclaw/dsh-integration/session-extensions`. Listeners must compose idempotently, must not start the Agent, and may reject to prevent input admission. Optional plugins own their configuration, eligibility, and durable state; Integration does not depend on them.

## Configuration

```yaml
- insert:
    - id: byclaw-dsh
      name: '@byclaw/dsh-integration'
      config:
        enabled: true
        userCode: !!js process.env.USER_CODE
```

The Redis connection reads only standard `REDIS_*` environment variables. The backend URL is resolved in this order: `BYCLAW_DSH_BASE_URL`, `BYAI_SERVICE_BASE_URL`, the Redis service registry entry at `RegistryKeys.sd_instance_details(BE_DOMAINNAME || "ByaiService")`, plugin `baseUrl`, then the public default `http://123.56.153.229:8080`. A registry record without `path_prefix` uses `/byaiService`. Redis model mode also requires `BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX` to decrypt ByClaw model authorization. Set `BYCLAW_REDIS_MODEL_ENABLED=false` and configure both `provider` and `model` to use only the local DSH model route at runtime. The DSH launcher reads `.env` from its launch working directory, with an already exported process value taking precedence over that file and `$DSH_HOME/.env`.

For local end-to-end tests that need DSH to read ByClaw BE's local file storage, explicitly enable the mapping in an untracked `.env`:

```sh
BYCLAW_DSH_LOCAL_E2E_STORAGE_ENABLED=true
FILE_STORAGE_LOCAL_PATH=/absolute/path/to/byclaw-file
```

The switch is disabled by default. While disabled, `FILE_STORAGE_LOCAL_PATH` does not change DSH's `/by` paths. When enabled, sandbox paths under `/by/**` map to `${FILE_STORAGE_LOCAL_PATH}/byclaw-${USER_CODE}/by/**`. Enabling the switch without `FILE_STORAGE_LOCAL_PATH` fails plugin activation so a test cannot silently fall back to `/by`. Do not put these variables or a local path in `cordis.patch.yml`.

Set the optional runtime variable `BYCLAW_DSH_WEB_AUTH_TOKEN` to expose one fixed DSH Web launch token across container restarts. The adapter only translates the root `?token=` exchange to DSH's internal random token; DSH still owns signed cookies, Host/Origin trust, and all API/WebSocket authentication. The image does not provide a default, and an explicitly empty value fails plugin activation. `BYCLAW_DSH_WEB_AUTH_ENABLED=false` instead disables token and signed-cookie authentication for the Web UI, HTTP API, and WebSocket, and the startup URL contains no token. DSH Host/Origin trust rejection remains active. This mode lets trusted LAN clients connect directly, but any client admitted by those trust checks can invoke the APIs and tools granted to the profile. The enable switch defaults to true and accepts `true/false`, `1/0`, `on/off`, or `yes/no`. Inject these values through the container environment or an untracked `.env` file.

For an isolated live smoke test, `E2E_TARGET_AGENT_TYPE` can override only the test script's worker target. This keeps the public routing interface limited to `--agent-id` while preventing a test message from being consumed by another online worker of the default AgentType.

An expert-group path delegates twice—main agent to leader to member—so the AgentTeams configuration must allow depth 2:

```yaml
- id: agent-teams
  config:
    memberProvider: spawn
    memberMaxDepth: 2
```

Common optional settings are `catalogDir`, `agentTemplateDir`, `skillCacheDir`, `builtinSkillDir`, `workspace`, `workerId`, `maxConcurrency`, `refreshChannel`, `subagentProvider`, `agentPreset`, and the local `provider`/`model` used as the Redis-mode fallback or as the required model in local mode. Resource synchronization tuning fields are `snapshotConcurrency` (default `8`), `projectionConcurrency` (`8`), `authorizationPollMs` (`5000`), `authorizationPollOnlyMs` (`2000`), `authorizationMissingGraceMs` (`15000`), and `resourceDebounceMs` (`250`). `projectionConcurrency` bounds the combined Skill, employee-model, and expert-group runtime requests issued during one generation; `BYCLAW_DSH_PROJECTION_CONCURRENCY` overrides it at runtime and must be a positive integer. Skill synchronization updates each cached Skill with an atomic directory swap instead of copying the complete persistent cache into every generation. Agent and team template directories remain generation-atomic, and revoked Skill directories are removed only after the new templates and runtime Skill view are committed. Every ByClaw root session explicitly mounts `agentPreset`; its default is `standard`. Root and delegated agents receive the coding tools composed by that preset; employee Skill catalogs follow the builtin/association rule above. CodeGraph and other runtime capabilities are registered by their own installed plugins rather than advertised by ByClaw Integration.

`agentTypes` overrides the complete AgentType list consumed by the Worker. By default, the plugin still registers `BYCLAW_DSH` and `BYCLAW_DSH_<userCode>`. When temporarily replacing the default super-assistant Worker, use the target type actually reported by the ByClaw backend; the current default super-assistant entry uses `['BY_SUPER']`. One identical AgentType list reuses the consumer group that by-framework derived for the original Worker, avoiding historical-message replay in a new consumer group. Before takeover, confirm that the original Worker has stopped or suspend it with `WorkerManager.suspendWorker`; on rollback, stop DSH before restoring the original Worker.

## Verification

```sh
pnpm verify
```

This command covers resource parsing, dynamic model configuration, Skill caching, template projection, asynchronous pause/wake, `ask_user`, task plans, and the `BYCLAW_DSH` command bridge. Also run native `skill-catalog`, standard loader, live watch/revocation, and Web parent-workspace integration checks against a DSH checkout with dependencies installed:

```sh
DSH_ROOT=/absolute/path/deepseek-harness pnpm verify:skills
```

Native Web/CLI roots delegate using their existing session header's workspace. Their template children receive the same restricted Skill view as Worker-created employees. After the Worker is online in a real environment, run:

```sh
node scripts/live-e2e.mjs --agent-id 123 '做自我介绍'
node scripts/live-e2e.mjs --agent-code ARCHITECT '分析架构'
node scripts/live-e2e.mjs --agent-name '架构舵手' '分析架构'
E2E_CWD=/absolute/project/path node scripts/live-e2e.mjs --agent-id 123 '做自我介绍'
node scripts/live-e2e.mjs '@架构舵手 分析架构'
node scripts/live-e2e.mjs --main '我有哪些数字员工？请简洁列出他们分别能帮我做什么。'
```

If `.env` is outside the DSH launch directory, start the web profile with:

```sh
cd /path/to/deepseek-harness
set -a
source .env
set +a
pnpm dsh web
```

The smoke generates a random numeric Snowflake `session_id` when `E2E_SESSION_ID` is omitted. Set `E2E_SESSION_ID` to an existing numeric Snowflake to continue that ByAI conversation.

Capability verification prompts should contain only the user's business intent. Confirm autonomous CodeGraph calls from the resulting DSH session events; naming the mechanism in the inbound instruction does not prove automatic behavior.

### Model request timeouts

Redis model `instanceParam.connectTimeoutSec` limits TCP/TLS connection establishment, not the time a connected model spends preparing its response. `readTimeoutSec` covers waiting for response headers and the Harness stream-idle watchdog (including waiting for the first model event). If omitted, the read budget uses `BYCLAW_LLM_IDLE_TIME`, defaulting to 600 seconds. For example, connect=32/read=60 allows a connected model to respond after 32 seconds, up to the read budget; it does not guarantee a slow provider will finish within 60 seconds.

The transport uses an Undici dispatcher per request and closes it gracefully after the response is consumed or cancelled. Caller cancellation remains effective during response streaming. A caller-supplied fetch keeps its own transport policy. Increasing the connect budget is not the remedy for a slow model's first response; measure that latency and configure the read budget instead.

### Group member file scope and command execution

Group members' shell, subprocess (including grep/glob) and PTY calls use the existing execution backend directly. No group-specific Seatbelt/bubblewrap wrapper or isolation availability check is added. ZIP extraction uses ordinary unzip commands; Python, ffmpeg, npm and Skill rendering also retain their normal command paths. No additional extraction or isolation diagnostic tools are registered. The image keeps bubblewrap available for other optional DSH sandbox backends; group member commands do not depend on it.

Scoped file API checks, team tool permissions and member Skill registry projections remain. These are not an OS boundary for commands: a command has the file access provided by its execution backend, potentially including paths rejected by the file API. Any sandbox, authorization or session file policy enforced by the existing backend remains that backend's responsibility.

After building AgentTeams and integration, run `node scripts/group-storage-verify.mjs`. It verifies scoped file/tool restrictions and normal shell, unzip, search, Skill helper and spawnTerminal calls using temporary fixtures. The spawnTerminal fixture checks the call path without allocating a real PTY.

## Jev routing plugins

### Legacy gateway and Skill compatibility

Some gateways expose Skill APIs under `/byService` but only forward the internal orchestrator controller under `/byaiService`. The resolver retries the canonical prefix on the same origin only after an HTML 404 from the exact legacy endpoint. Both requests share a timeout and disable redirects. JSON business 404s, authorization failures and other statuses remain errors; authorization and returned-group validation still apply.

Associated Skills named `<skillCode>-<numeric.version>` (for example `ppt-master-0.1`) load under their stable, valid association code. Source files, descriptions, bodies and resource paths remain intact, and the runtime reports the name adaptation. Unrelated invalid names, path characters and empty descriptions remain invalid; existing name-collision handling still applies.

With model routing enabled, the native DSH composer model selector exposes Auto and the supplied model pool. Ordinary sessions can use Auto with their previous real model as fallback; bound ByClaw employee roots default to Auto and retain their employee-configured fallback. Manual selections persist with the session and bypass automatic model selection and cross-model fallback. Agent/team routing and child-agent models remain independent. See the [model router](../byclaw-model-router/README.md) for behavior and runtime requirements.

Agent intent routing uses `@byclaw/byclaw-agent-router` with `BYCLAW_AGENT_ROUTER_ENABLED`. Independent model routing uses `@byclaw/byclaw-model-router` with `BYCLAW_MODEL_ROUTER_ENABLED` and an explicit `BYCLAW_MODEL_ROUTER_MODEL_IDS` candidate pool. Both share the Vercel TypeSafe-compatible `BYCLAW_JEV_BASE_URL`, `BYCLAW_JEV_API_KEY` (or `AI_GATEWAY_API_KEY`), `BYCLAW_JEV_MODEL` and `BYCLAW_JEV_TIMEOUT_MS` settings in the root `.env.example`.

Model failure recovery tries the agent-configured model before another Jev selection. If a reselected model becomes unavailable, recovery continues within the remaining reselection budget. Use this repository's DSH 0.1.5-rc.2 compatibility build: startup checks support for request-error recovery with `reassemble: true`. See [model router](../byclaw-model-router/README.md) for compatibility, partial-output handling and catalog metadata, [agent router](../byclaw-agent-router/README.md) for enforced employee delegation, and [shared client](../jev-client/README.md) for the synthetic Gateway smoke command.

Employee routing is enforced only for super-assistant roots: the default ByClaw main binding or a trusted employee template with code `${USER_CODE}_main`. Directly selected ordinary employees retain their requested delegation targets and generic delegation tools. Expert groups retain their scoped coordination rules.

## Native todo execution checks / 原生 todo 执行约束

Integration now requires `@byclaw/dsh-todo-execution`. Ordinary employee Agent roots bind it before session extensions and input admission; current or persisted group-coordination metadata keeps team sessions unbound. Native `todo_write` and the existing `task_plan({todos})` alias keep their definitions and order; both pass the same sequential checks. Existing `todo/write → 2008` card delivery remains. See [插件说明](../dsh-todo-execution/README.md) for lifecycle, stopping limits and installation.


## 超级助手编排权限

默认 ByClaw 主助手，或员工编码为 `${USER_CODE}_main` 的根会话，使用编排权限。问候、澄清、一般知识解释和基于对话的简短总结可直接回答；外部信息检索、文件/代码/浏览器/命令/业务操作、多步骤分析及专业交付必须委派授权员工或专家组。复杂度由角色提示引导；业务工具权限由执行端强制限制。

超级助手使用原生工具展示，只保留 `byclaw_list_resources`、`byclaw_route_task`（开关开启时）、`byclaw_instantiate_template`、`agent_teams_status`、`ask_user_question`（已注册时）、`super_assistant_read_plan`、`todo_write` 和 `task_plan`。`super_assistant_read_plan` 只读自身最近的原生 Todo 快照，不写入计划，不代表员工进度。Bash、浏览器、文件读写、Skills、代码桥和其他业务工具均从模型请求中移除并由不可被 allow 策略覆盖的 guard 拒绝；普通员工与子 Agent 不受此白名单影响。

超级助手不绑定单 Agent Todo 顺序执行策略，已有未完成 Todo 保留，不阻止调度。超级助手可创建和更新自身调度计划，收到员工交付并核实后才标记完成；员工完成后异步回报，由超级助手汇总或继续委派。Jev 失败或没有候选时说明阻塞，不自行执行复杂任务。无需额外环境开关；Jev 是否介入仍由 `BYCLAW_AGENT_ROUTER_ENABLED` 控制。

INFO 日志 `[byclaw-super-assistant] bound` 显示会话和工具白名单；禁止调用返回 `SUPER_ASSISTANT_EXECUTION_DENIED`。本地验证：`node --import tsx/esm plugins/byclaw-integration/scripts/super-assistant-policy-verify.mjs`。

With Jev enabled, the super assistant first calls `byclaw_route_task(task)`, then dispatches through `byclaw_instantiate_template` using the returned ID and the same task. Dispatch validates the latest agent-bound, single-use selection without requesting Jev again. Re-route after a failure or restart.
