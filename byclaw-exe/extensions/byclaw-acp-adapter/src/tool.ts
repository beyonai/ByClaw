import type { ByclawAcpPlanRequest, ResolvedByclawAcpAdapterConfig } from "./types.js";
import { ACP, DEFAULTS, JSON_INDENT_SPACES, METADATA_KEYS } from "./constants.js";
import { createByclawAcpPlan } from "./planner.js";
import type { ByclawRegistry } from "./registry.js";
import type { ByclawAcpRunStore } from "./sqlite-store.js";

const planParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["agent", "team", "workflow", "loop"],
      default: "agent",
      description:
        "Plan target kind. Use agent for the current digital employee and any agent-mounted skill workflow. Use team/workflow/loop only when the user explicitly asks for a ByClaw agent team, workflow, or loop.",
    },
    id: {
      type: "string",
      description:
        "ByClaw agent/team/workflow/loop id. For the current digital employee, pass its resourceId/digital employee id so mounted linkedSkills can be propagated to ACP.",
    },
    input: {
      description: "User task input to pass into the ACP Claude Code plan.",
    },
    model: {
      type: "string",
      description:
        "Deprecated compatibility field. The downstream ACP model is resolved from Redis digital-employee metadata, not from the OpenClaw entrance model.",
    },
    cwd: {
      type: "string",
      description: `Optional working directory override for ${ACP.nextType}.`,
    },
    acpAgentId: {
      type: "string",
      description:
        "Optional ACP harness agent id override. Normally omit this so the adapter runtime config selects the local or remote ACP client.",
    },
    acpClientType: {
      type: "string",
      description: "Optional downstream ACP client type used to select shared-directory instructions.",
    },
    sessionId: {
      type: "string",
      description:
        "Real byai-channel session_id. Used as the shared task directory name under .byclaw/acp-runs/{ACP_CLIENT_TYPE}/{sessionId}; do not pass agent id, run id, or a generated id.",
    },
    language: {
      type: "string",
      description: "Current byai-channel reply language metadata, for example zh_CN or en_US.",
    },
    replyLanguage: {
      type: "string",
      description:
        "Optional explicit downstream ACP client reply language. Defaults to language, then the adapter default.",
    },
    languageProvided: {
      type: "boolean",
      description: "Whether byai-channel received an explicit language from LANG or inbound metadata.",
    },
  },
} as const;

function summarizePlanForDetails(plan: ReturnType<typeof createByclawAcpPlan>) {
  return {
    kind: plan.kind,
    id: plan.id,
    name: plan.name,
    acpAgentId: plan.acpAgentId,
    model: plan.model,
    cwd: plan.cwd,
    replyLanguage: plan.replyLanguage,
    languageProvided: plan.languageProvided,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildSessionsSpawnToolArgs(plan: ReturnType<typeof createByclawAcpPlan>) {
  const payload = plan.sessionsSpawn;
  return {
    task: stringField(payload.task),
    ...(stringField(payload.label) ? { label: stringField(payload.label) } : {}),
    runtime: stringField(payload.runtime),
    agentId: stringField(payload.agentId),
    streamTo: stringField(payload.streamTo),
    mode: stringField(payload.mode),
    cwd: stringField(payload.cwd),
    model: stringField(payload.model),
  };
}

function renderSessionsSpawnMirror(plan: ReturnType<typeof createByclawAcpPlan>) {
  const agentModels = plan.metadata[METADATA_KEYS.agentModels];
  const agentModelCount =
    agentModels && typeof agentModels === "object" && Array.isArray(agentModels.agents)
      ? agentModels.agents.length
      : 0;
  const bundle =
    plan.sessionsSpawn[METADATA_KEYS.bundle] && typeof plan.sessionsSpawn[METADATA_KEYS.bundle] === "object"
      ? (plan.sessionsSpawn[METADATA_KEYS.bundle] as Record<string, unknown>)
      : undefined;
  const bundlePath = typeof bundle?.path === "string" ? bundle.path : "";
  const sessionsSpawnJson = JSON.stringify(buildSessionsSpawnToolArgs(plan), null, JSON_INDENT_SPACES);
  return [
    `ByClaw ACP ${plan.kind} plan ${plan.id} is ready.`,
    `Call the generic ${ACP.nextType} tool with exactly the JSON object below.`,
    "Do not add attachments, context=fork, bundle, modelConfig, or a short task summary.",
    "The task text already includes shared filesystem paths for query.md, metadata.md, bootstrap artifacts, and plan-bundle.json.",
    "Full agentModels, team/workflow metadata, and per-agent model configuration are stored in the shared filesystem bundle referenced inside the task text.",
    `Response language: ${plan.replyLanguage}. The downstream ACP client must follow the responseLanguage policy in metadata.md and plan-bundle.json.`,
    `Summary: runtime=${plan.sessionsSpawn.runtime}; agentId=${plan.sessionsSpawn.agentId}; model=${plan.sessionsSpawn.model}; modelConfig=${plan.sessionsSpawn.modelConfig ? "present" : "missing"}; bundle=${bundlePath || "missing"}; agentModelsInBundle=${agentModelCount}.`,
    `${ACP.nextType} arguments:`,
    "```json",
    sessionsSpawnJson,
    "```",
  ].join("\n");
}

export function createByclawAcpPlanTool(params: {
  config: ResolvedByclawAcpAdapterConfig;
  registry: ByclawRegistry;
}) {
  return {
    name: params.config.toolNames.plan,
    label: "ByClaw ACP Plan",
    description:
      `Read ByClaw digital-employee metadata from Redis and build a Claude Code ACP ${ACP.nextType} plan. For a current digital employee or agent-mounted skill workflow, call this with kind=agent and that digital employee id; use workflow/team only for explicit team orchestration.`,
    parameters: planParameters,
    async execute(_toolCallId: string, input: ByclawAcpPlanRequest) {
      const plan = createByclawAcpPlan({
        config: params.config,
        snapshot: await params.registry.snapshot(),
        request: input,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: renderSessionsSpawnMirror(plan),
          },
        ],
        details: {
          plan: summarizePlanForDetails(plan),
          sessionsSpawn: plan.sessionsSpawn,
        },
      };
    },
  };
}

export function createByclawAcpRunTool(params: {
  config: ResolvedByclawAcpAdapterConfig;
  registry: ByclawRegistry;
  store: ByclawAcpRunStore;
}) {
  return {
    name: params.config.toolNames.run,
    label: "ByClaw ACP Run",
    description:
      `Build a ByClaw ACP Claude Code ${ACP.nextType} plan and persist a local SQLite run ledger row. For a current digital employee or agent-mounted skill workflow, call this with kind=agent and that digital employee id; use workflow/team only for explicit team orchestration.`,
    parameters: planParameters,
    async execute(_toolCallId: string, input: ByclawAcpPlanRequest) {
      const plan = createByclawAcpPlan({
        config: params.config,
        snapshot: await params.registry.snapshot(),
        request: input,
      });
      const run = params.store.createRun({ plan, input: input.input ?? {} });
      const sessionsSpawn = {
        ...plan.sessionsSpawn,
        label: run.runId,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Created ByClaw ACP run ${run.runId}.`,
              renderSessionsSpawnMirror({ ...plan, sessionsSpawn }),
            ].join("\n"),
          },
        ],
        details: {
          run: {
            runId: run.runId,
            pipelineRunId: run.pipelineRunId,
            kind: run.kind,
            byclawId: run.byclawId,
            status: run.status,
          },
          plan: summarizePlanForDetails(plan),
          sessionsSpawn,
        },
      };
    },
  };
}
