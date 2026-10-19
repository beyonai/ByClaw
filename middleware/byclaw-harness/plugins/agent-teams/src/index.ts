/**
 * AgentTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `agent_teams_*` tools and one usage
 * section into the global system prompt. After installation any session can
 * run multi-agent teamwork through natural language (e.g. "use AgentTeams to research X"):
 * the model creates a team (it becomes the captain), spawns members as
 * durable continuable subagents, breaks the goal into tasks with
 * dependencies, wakes members with messages, relays reports, and collects
 * results.
 *
 * Installation (bundle): `dsh plugin --profile <name> add @byclaw/dsh-agent-teams`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module dsh-agent-teams
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Declaration merge only: makes ctx.llm, ctx.subagents and ctx.systemPrompt visible.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { readFile } from 'node:fs/promises'
import { resolveTeamStateRoot } from './runtime-state.ts'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectArchivedTeamsActivity, collectTeamsActivity } from './snapshot.ts'
import { defaultCatalogDir } from './catalog.ts'
import { installAgentTeamsLifecycle } from './lifecycle.ts'
import {
  AGENT_TEAMS_MODEL_OVERRIDES,
  createAgentTeamsModelOverrideService,
} from './model-overrides.ts'

export type { ByClawMemberSource, GroupTaskBlocker, GroupTaskSummary, GroupTaskSummaryInitial, GroupTaskSummaryOutcome } from './types.ts'
export {
  AGENT_TEAMS_MODEL_OVERRIDES,
  type AgentTeamsModelOverrideService,
} from './model-overrides.ts'

/** Register the AgentTeams model guidance for the lifetime of the plugin fiber. */
export function registerAgentTeamsUsageSection(ctx: Context, toolNames: string, order: number): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'agent-teams:usage',
    order,
    text: agentTeamsUsageSectionText(toolNames),
  }), 'agent-teams: usage section')
}

/**
 * Structural slice of the web server service, compatible with both the
 * published `dsh-host-webserver@0.0.1-rc.1` (`ctx.httpServer` /
 * `HttpServerService`) and the renamed `webServer` / `WebServer` in later
 * builds: the beta transition renames the service without changing the route
 * registration shape.
 */
interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Web-server service key candidates, newest first. */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'] as const
/** Workspace registry service key candidates, newest first. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'] as const

export const name = 'agent-teams'
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents']

/** Plugin configuration. */
export interface Config {
  /**
   * Logical state namespace (default `.agent-teams`). Host-owned runtime state
   * is keyed by workspace and namespace under `$DSH_HOME/runtime/byclaw-agent-teams/`.
   */
  stateDir?: string
  /** `ctx.subagents` provider used to spawn members; must support continuable children; AgentTeams applies the member persona itself (default `spawn`). */
  memberProvider?: string
  /** Optional model override applied to every member. */
  memberModel?: string
  /** Member delegation depth cap (default `1`; `0` forbids delegation entirely). */
  memberMaxDepth?: number
  /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
  promptSectionOrder?: number
  /** Enable deterministic draft/start and receipt gates. */
  controlledWorkflow?: boolean
  /** Automatic task-attempt ceiling (default `3`). */
  maxTaskAttempts?: number
  /** Machine-global expert-template and runtime-pointer directory. */
  catalogDir?: string
}

export const Config: z<Config> = z.object({
  stateDir: z.string().default('.agent-teams'),
  memberProvider: z.string().default('spawn'),
  memberModel: z.string(),
  memberMaxDepth: z.natural().default(1),
  promptSectionOrder: z.natural().default(117),
  controlledWorkflow: z.boolean().default(false),
  maxTaskAttempts: z.natural().min(1).default(3),
  catalogDir: z.string(),
})

/** The model-facing usage policy: when and how to drive AgentTeams. */
export function agentTeamsUsageSectionText(toolNames: string): string {
  return `AgentTeams runtime teams are owned by their creating captain session. When the user asks which teams exist or what a team contains, call agent_teams_list_instances or agent_teams_get_instance for global metadata; do not call agent_teams_status unless this session already belongs to that team. Use agent_teams_list_templates to inspect reusable expert rosters. When the user asks this session to give a discovered team new work, call agent_teams_submit_task with one independent, contract-complete task and a member selected from the metadata. This appends work without joining the team or changing existing tasks and ends the current turn. Never poll or sleep while it runs: its terminal downstream event wakes this requester in a new turn. After that wake, call agent_teams_get_submitted_task at most once if authoritative state is still needed.

When the user asks to run something with AgentTeams (e.g. "use AgentTeams to do X"), you are the captain of a multi-agent team. Follow this protocol:
1. Call agent_teams_create with a team name and the goal as description. You become the captain and may lead one team at a time. When using template_id, inspect agent_teams_list_templates and pass template_members: [] to assemble the team dynamically, or list only the exact template member names needed now. Omitting template_members instantiates the full roster for compatibility; choose that only when every member is needed. Reusing the same captain/template runtime leaves its roster unchanged. Existing runtime teams discovered globally remain owned by their original session and cannot be controlled from this session.
2. Call agent_teams_add_member once per additional role the goal needs (researcher, engineer, reviewer, ...). For members of this team's template, pass template_member with the exact template member name to retain its role, provider/model, enterprise persona and Skills; use name for its unique team name. Inspect your existing roster before adding a member, and add missing specialists as later requests need them. Without template_member, a custom member snapshots your current provider, model, and reasoning effort. Members are durable subagents: they wait for your messages, then work a full turn. Never ask the user to choose model settings per member; only pass provider/model when the user explicitly requests a different route for that role.
3. Break the goal into tasks with agent_teams_create_task and wire dependencies. In controlled mode, explicitly provide description, dependencies (including []), assignee, acceptance_criteria, and required_tools (including []), then call agent_teams_start once after the complete DAG for that request is present. After a successful batch completes, creating the next task reopens the same team as a draft; append that request's DAG and call agent_teams_start again. Assign role-specific work when useful; unassigned ready work belongs to the shared pool in legacy mode. The scheduler automatically claims one ready task for each truly idle member and wakes it, including across later rounds.
4. Lead by delegation: agent_teams_start dispatches the DAG and pauses your current turn. Never poll agent_teams_status while members work. A member report asynchronously wakes you in a new turn; inspect status once then, send guidance only when needed, and end that turn again if work remains. Do not duplicate a teammate's work merely because its turn is slow.
5. If work is blocked, stale, or needs takeover, always call agent_teams_reassign_task first. Reassign to another idle member, or use assignee=captain before doing it yourself. Reassignment revokes the old attempt and waits for that member to quiesce, preventing late results from overwriting the new attempt.
6. Tasks carry attempt_id capabilities. Members must use the current attempt_id for updates; stale-attempt errors mean ownership changed. Member events, not polling, drive each captain continuation until every required task is terminal and every member is idle/ready.
7. Present the team's results to the user. Keep the runtime team for later requests in the same conversation so new tasks append to one activity history; delete it only when the user explicitly asks to end or abandon the team.

Tools: ${toolNames}`
}

export function apply(ctx: Context, config: Config): void {
  const modelOverrides = createAgentTeamsModelOverrideService()
  ctx.provide(AGENT_TEAMS_MODEL_OVERRIDES, modelOverrides)
  const resolved: ToolsConfig = {
    stateDir: config.stateDir ?? '.agent-teams',
    memberProvider: config.memberProvider ?? 'spawn',
    memberModel: config.memberModel,
    memberMaxDepth: config.memberMaxDepth ?? 1,
    controlledWorkflow: config.controlledWorkflow ?? false,
    maxTaskAttempts: config.maxTaskAttempts ?? 3,
    catalogDir: config.catalogDir ?? defaultCatalogDir(),
    modelOverrides,
  }

  // Provider registration is a sibling plugin's effect (`subagent-spawn` /
  // `subagent-fork` rows), which can land after this mount under the Loader's
  // concurrent activation — so capability validation happens at the first
  // member spawn (`spawnMember`), the earliest point the provider list is
  // settled, rather than here.

  const toolNames = [
    'agent_teams_list_instances',
    'agent_teams_get_instance',
    'agent_teams_list_templates',
    'agent_teams_submit_task',
    'agent_teams_get_submitted_task',
    'agent_teams_create',
    'agent_teams_save_template',
    'agent_teams_add_member',
    'agent_teams_remove_member',
    'agent_teams_create_task',
    'agent_teams_start',
    'agent_teams_reassign_task',
    'agent_teams_claim_task',
    'agent_teams_update_task',
    'agent_teams_send_message',
    'agent_teams_status',
    'agent_teams_delete',
  ].join(', ')
  registerAgentTeamsUsageSection(ctx, toolNames, config.promptSectionOrder ?? 117)

  registerAgentTeamsTools(ctx, resolved)
  installAgentTeamsLifecycle(ctx, resolved.stateDir)

  // The activity panel data/artwork routes need the Web server and the
  // workspace registry, which headless profiles do not mount; under
  // concurrent activation they may also bind after this plugin. Register the
  // routes lazily: try now, then on each service binding event. In a webless
  // profile the plugin stays tool-only and never blocks boot.
  let webRegistered = false
  const registerWebSurface = (): void => {
    if (webRegistered) return
    const webServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])) as WebRouteHost | undefined
    const workspaceRegistry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1])) as WorkspaceRegistry | undefined
    if (webServer === undefined || workspaceRegistry === undefined) return
    webRegistered = true

    // Activity panel data route: the browser floater polls this for team
    // snapshots (disk truth + live subagent activity). Mirrors the Claude
    // Code desktop watcher's server-side snapshot pattern.
    ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-agent-teams/state',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const roots = workspaceRegistry.list().map((workspace) => ({
        workspace: workspace.title,
        stateRoot: resolveTeamStateRoot(workspace.path, resolved.stateDir),
      }))
      // ?archived=1 serves teams moved to archive/ (post-delete review).
      const snapshots = url.searchParams.get('archived') === '1'
        ? await collectArchivedTeamsActivity(ctx, roots)
        : await collectTeamsActivity(ctx, roots)
      const body = JSON.stringify({ teams: snapshots })
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    },
  }), 'agent-teams: activity route')

  // Whale mascot artwork: serve the packaged role/action images to the
  // activity panel. An explicit allowlist guards the route (no path
  // traversal); the images ship with the bundle (files: assets/).
  const artDir = fileURLToPath(new URL('../assets/agent-teams/', import.meta.url))
  const ART_ALLOWLIST = new Set([
    'team-lead.png', 'researcher.png', 'engineer.png', 'designer.png',
    'qa-engineer.png', 'security-reviewer.png', 'data-analyst.png',
    'docs-coordinator.png', 'action-working.png', 'action-thinking.png',
    'action-reporting.png', 'action-celebrating.png', 'action-sleeping.png',
    'action-sending.png',
  ])
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/plugins/dsh-agent-teams/assets',
    handler: async (req, res) => {
      let name: string
      try {
        name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.split('/').pop() ?? '')
      } catch {
        // Malformed percent-encoding: treat as an unknown asset, not a 400.
        res.writeHead(404)
        res.end()
        return
      }
      if (!ART_ALLOWLIST.has(name)) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const data = await readFile(join(artDir, name))
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400',
        })
        res.end(data)
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams: artwork read failed for ${name}: ${String(error)}`)
        res.writeHead(404)
        res.end()
      }
      },
    }), 'agent-teams: artwork route')
  }

  registerWebSurface()
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name as (typeof WEB_SERVER_KEYS)[number])
      || WORKSPACE_KEYS.includes(name as (typeof WORKSPACE_KEYS)[number])) {
      registerWebSurface()
    }
  })
}

export { cancelCaptainTeam, resumeCaptainTeam } from './lifecycle.ts'

export * from './group-scope.ts'
export * from './group-context.ts'
export * from './runtime-state.ts'

export * from './group-assistance.ts'

export { setGroupTaskSummary, validateGroupTaskSummary, groupTaskSummaryOutcome, finalizeGroupTaskSummary, renderGroupTaskSummary, assertGroupTaskAdmission } from './group-summary.ts'

export * from './group-errors.ts'

export { withTeamLock } from './state.ts'
