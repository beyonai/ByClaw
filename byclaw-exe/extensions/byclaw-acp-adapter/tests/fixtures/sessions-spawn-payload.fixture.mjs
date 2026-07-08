import { DEFAULTS, PACKAGE } from "../../scripts/constants.mjs";

const modelConfigById = {
  "model-orchestrator": {
    source: "fixture-aimodel-config",
    baiyingModelId: "model-orchestrator",
    model: "claude-sonnet-4-20250514",
    modelCode: "claude-sonnet-4-20250514",
    modelName: "Claude Sonnet fixture orchestrator",
    displayName: "Claude Sonnet fixture orchestrator",
    providerKey: "fixture-anthropic",
    modelRef: "fixture-anthropic/claude-sonnet-4-20250514",
    providerApi: "anthropic-messages",
    baseUrl: "https://fixture.invalid/anthropic",
    requestDefaults: {
      temperature: 0.1,
      stream: true
    },
    hasAuthToken: true
  },
  "model-coder": {
    source: "fixture-aimodel-config",
    baiyingModelId: "model-coder",
    model: "qwen-max-fixture",
    modelCode: "qwen-max-fixture",
    modelName: "Qwen Max fixture coder",
    displayName: "Qwen Max fixture coder",
    providerKey: "fixture-openai-compatible",
    modelRef: "fixture-openai-compatible/qwen-max-fixture",
    providerApi: "openai-completions",
    baseUrl: "https://fixture.invalid/openai-compatible",
    requestDefaults: {
      temperature: 0.2,
      stream: true
    },
    hasAuthToken: true
  },
  "model-reviewer": {
    source: "fixture-aimodel-config",
    baiyingModelId: "model-reviewer",
    model: "deepseek-r1-fixture",
    modelCode: "deepseek-r1-fixture",
    modelName: "DeepSeek fixture reviewer",
    displayName: "DeepSeek fixture reviewer",
    providerKey: "fixture-responses",
    modelRef: "fixture-responses/deepseek-r1-fixture",
    providerApi: "openai-responses",
    baseUrl: "https://fixture.invalid/responses",
    requestDefaults: {
      temperature: 0,
      stream: true
    },
    reasoningConfig: {
      enabled: true,
      effort: "medium"
    },
    hasAuthToken: true
  }
};

const agents = [
  {
    id: "900001",
    redisKey: "DIG_EMPLOYEE_900001",
    name: "ByClaw Orchestrator",
    role: "orchestrator",
    description: "Coordinates the fixture team.",
    model: modelConfigById["model-orchestrator"].model,
    baiyingModelId: "model-orchestrator",
    modelConfig: modelConfigById["model-orchestrator"],
    acpAgentId: "claude",
    linkedSkills: [],
    source: {
      resourceId: "900001",
      resourceName: "ByClaw Orchestrator",
      runtime: {
        baiyingModelId: "model-orchestrator",
        acpAgentId: "claude"
      }
    }
  },
  {
    id: "900002",
    redisKey: "DIG_EMPLOYEE_900002",
    name: "ByClaw Coder",
    role: "coder",
    description: "Implements fixture changes.",
    model: modelConfigById["model-coder"].model,
    baiyingModelId: "model-coder",
    modelConfig: modelConfigById["model-coder"],
    acpAgentId: "claude",
    linkedSkills: [
      {
        id: "910001",
        redisKey: "SKILL_910001",
        name: "fixture-engineering-skill",
        code: "fixture-engineering-skill",
        description: "Fixture skill mounted on the coder digital employee.",
        skillPath: "/workspace/skills/fixture-engineering-skill",
        skillDocObjectKey: "/workspace/skills/fixture-engineering-skill/SKILL.md",
        skillType: "hub",
        source: {
          resourceId: "910001",
          resourceBizType: "SKILL"
        }
      }
    ],
    source: {
      resourceId: "900002",
      resourceName: "ByClaw Coder",
      relIds: ["910001"],
      runtime: {
        baiyingModelId: "model-coder",
        acpAgentId: "claude"
      }
    }
  },
  {
    id: "900003",
    redisKey: "DIG_EMPLOYEE_900003",
    name: "ByClaw Reviewer",
    role: "reviewer",
    description: "Reviews fixture changes.",
    model: modelConfigById["model-reviewer"].model,
    baiyingModelId: "model-reviewer",
    modelConfig: modelConfigById["model-reviewer"],
    acpAgentId: "claude",
    linkedSkills: [],
    source: {
      resourceId: "900003",
      resourceName: "ByClaw Reviewer",
      runtime: {
        baiyingModelId: "model-reviewer",
        acpAgentId: "claude"
      }
    }
  }
];

export const fixture = {
  config: {
    defaultAcpAgentId: DEFAULTS.acpAgentId,
    defaultAcpClientType: "claude-code",
    defaultCwd: "",
    sqlitePath: "",
    httpPathPrefix: `/plugins/${PACKAGE.pluginId}`,
    redis: {
      host: DEFAULTS.redisHost,
      port: DEFAULTS.redisPort,
      database: DEFAULTS.redisDatabase,
      keyPrefix: "",
      connectTimeoutMs: DEFAULTS.fixtureRedisConnectTimeoutMs
    },
    toolNames: {
      plan: "byclawAcpPlan",
      run: "byclawAcpRun"
    }
  },
  snapshot: {
    agents,
    skills: [
      {
        id: "910001",
        redisKey: "SKILL_910001",
        name: "fixture-engineering-skill",
        code: "fixture-engineering-skill",
        description: "Fixture skill mounted on the coder digital employee.",
        skillPath: "/workspace/skills/fixture-engineering-skill",
        skillDocObjectKey: "/workspace/skills/fixture-engineering-skill/SKILL.md",
        skillType: "hub",
        source: {
          resourceId: "910001",
          resourceBizType: "SKILL"
        }
      }
    ],
    teams: [
      {
        id: "fixture-team",
        name: "Fixture Team",
        memberAgentIds: ["900001", "900002", "900003"],
        coordinatorAgentId: "900001",
        source: {
          id: "fixture-team"
        }
      }
    ],
    workflows: [
      {
        id: "fixture-workflow",
        name: "Fixture Workflow",
        teamId: "fixture-team",
        steps: [
          {
            id: "coordinate",
            name: "Coordinate",
            agentId: "900001",
            instruction: "Coordinate the fixture work."
          },
          {
            id: "implement",
            name: "Implement",
            agentId: "900002",
            instruction: "Implement the fixture work."
          },
          {
            id: "review",
            name: "Review",
            agentId: "900003",
            instruction: "Review the fixture work."
          }
        ],
        source: {
          id: "fixture-workflow"
        }
      }
    ],
    loops: [
      {
        id: "fixture-loop",
        name: "Fixture Loop",
        workflowId: "fixture-workflow",
        maxIterations: 2,
        exitCriteria: ["reviewer approves"],
        source: {
          id: "fixture-loop"
        }
      }
    ]
  },
  requestCases: [
    {
      name: "agent",
      request: {
        kind: "agent",
        id: "900002",
        model: "parent-entry-model-should-not-leak-to-acp",
        language: "zh_CN",
        replyLanguage: "zh_CN",
        languageProvided: true,
        input: {
          title: "agent payload fixture"
        }
      },
      expectedKind: "agent",
      expectedId: "900002",
      expectedAgentIds: ["900002"],
      expectedCoordinatorId: "900002"
    },
    {
      name: "remote-default-overrides-legacy-claude",
      config: {
        defaultAcpAgentId: "byclaw-remote-claude"
      },
      request: {
        kind: "agent",
        id: "900002",
        acpAgentId: DEFAULTS.acpAgentId,
        acpClientType: "codex",
        input: {
          title: "remote bridge should use configured default ACP agent"
        }
      },
      expectedKind: "agent",
      expectedId: "900002",
      expectedAgentIds: ["900002"],
      expectedCoordinatorId: "900002",
      expectedAcpAgentId: "byclaw-remote-claude"
    },
    {
      name: "agent-mounted-skill-fallback",
      request: {
        kind: "workflow",
        input: {
          title: "agent mounted skill workflow fixture",
          instructions: "Read linkedSkills and skillPath/SKILL.md before running the downstream client."
        }
      },
      expectedKind: "agent",
      expectedId: "900002",
      expectedAgentIds: ["900002"],
      expectedCoordinatorId: "900002"
    },
    {
      name: "team",
      request: {
        kind: "team",
        id: "fixture-team",
        input: {
          title: "team payload fixture"
        }
      },
      expectedAgentIds: ["900001", "900002", "900003"],
      expectedCoordinatorId: "900001"
    },
    {
      name: "workflow",
      request: {
        kind: "workflow",
        id: "fixture-workflow",
        input: {
          title: "workflow payload fixture"
        }
      },
      expectedAgentIds: ["900001", "900002", "900003"],
      expectedCoordinatorId: "900001"
    },
    {
      name: "loop",
      request: {
        kind: "loop",
        id: "fixture-loop",
        input: {
          title: "loop payload fixture"
        }
      },
      expectedAgentIds: ["900001", "900002", "900003"],
      expectedCoordinatorId: "900001"
    },
    {
      name: "loop-id-with-workflow-kind",
      request: {
        kind: "workflow",
        id: "fixture-loop",
        input: {
          title: "loop id with stale workflow kind fixture"
        }
      },
      expectedAgentIds: ["900001", "900002", "900003"],
      expectedCoordinatorId: "900001",
      expectedKind: "loop",
      expectedId: "fixture-loop"
    }
  ]
};
