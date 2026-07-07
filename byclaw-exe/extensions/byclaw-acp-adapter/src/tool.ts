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
      description: `Optional ACP harness agent id. Defaults to ${DEFAULTS.acpAgentId}.`,
    },
    acpClientType: {
      type: "string",
      description: "Optional downstream ACP client type used to select shared-directory instructions.",
    },
    sessionId: {
      type: "string",
      description: "Optional ACP session id used as the shared task directory name.",
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
  const sessionsSpawnJson = JSON.stringify(plan.sessionsSpawn, null, JSON_INDENT_SPACES);
  return [
    `ByClaw ACP ${plan.kind} plan ${plan.id} is ready.`,
    `Call the generic ${ACP.nextType} tool with exactly the JSON object below.`,
    "Do not add context=fork, do not replace task with a short summary, and do not remove modelConfig or bundle.",
    "Do not recreate or simplify the payload from this markdown. Preserve every field, especially modelConfig and bundle.",
    "Full agentModels, team/workflow metadata, and per-agent model configuration are stored in the shared filesystem bundle referenced by details.sessionsSpawn.bundle.path.",
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
