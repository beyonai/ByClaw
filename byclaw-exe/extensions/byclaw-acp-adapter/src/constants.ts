export const JSON_INDENT_SPACES = 2;

export const PLUGIN = {
  id: "byclaw-acp-adapter",
  runtimeServiceId: "byclaw-acp-adapter-runtime",
  name: "ByClaw ACP Adapter",
  description:
    "Adapt ByClaw digital employees from Redis into OpenClaw ACP Claude Code agent/team/workflow/loop plans.",
} as const;

export const ENV = {
  byclawAcpClaudeModel: "BYCLAW_ACP_CLAUDE_MODEL",
  anthropicModel: "ANTHROPIC_MODEL",
  openclawStateDir: "OPENCLAW_STATE_DIR",
  redisHost: "REDIS_HOST",
  redisPort: "REDIS_PORT",
  redisUsername: "REDIS_USERNAME",
  redisPassword: "REDIS_PASSWORD",
  redisDatabase: "REDIS_DATABASE",
  redisConnectTimeoutMs: "REDIS_CONNECT_TIMEOUT_MS",
  byclawAcpAimodelConfigRedisKey: "BYCLAW_ACP_AIMODEL_CONFIG_REDIS_KEY",
  byclawAcpDefaultCwd: "BYCLAW_ACP_DEFAULT_CWD",
} as const;

export const DEFAULTS = {
  acpAgentId: "claude",
  claudeCodeModel: "anthropic/sonnet",
  replyLanguage: "zh_CN",
  stateDirName: ".openclaw-state",
  redisHost: "127.0.0.1",
  redisPort: 6379,
  redisDatabase: 0,
  redisConnectTimeoutMs: 5000,
  minRedisConnectTimeoutMs: 1000,
  runListLimit: 50,
  minRunListLimit: 1,
  maxRunListLimit: 200,
} as const;

export const TOOL_NAMES = {
  plan: "byclawAcpPlan",
  run: "byclawAcpRun",
  callAcpAgent: "call_acp_agent",
} as const;

export const ACP_MODE = {
  callAgent: "callAgent",
  acp: "acp",
  default: "callAgent",
} as const;

export const CALL_ACP_AGENT = {
  targetAgentTypePrefix: "BYCLAW_CODE_",
  responseType: "code_agent",
  asyncParentMessageId: "-1",
  defaultRequesterSessionKey: "agent:main:main",
  defaultAgentId: "main",
  langfuseParentObservationAttempts: 20,
  langfuseParentObservationDelayMs: 50,
} as const;

export const HTTP = {
  pathPrefix: `/plugins/${PLUGIN.id}`,
  routes: {
    registry: "registry",
    plan: "plan",
    run: "run",
  },
  methods: {
    get: "GET",
    post: "POST",
  },
  status: {
    ok: 200,
    badRequest: 400,
    methodNotAllowed: 405,
    internalServerError: 500,
  },
  headers: {
    allow: "allow",
    contentType: "content-type",
  },
  contentTypes: {
    jsonUtf8: "application/json; charset=utf-8",
  },
  maxBodyBytes: 512 * 1024,
} as const;

export const GATEWAY = {
  errorCode: "byclaw_acp_adapter_error",
  methods: {
    registry: "byclaw.acp.registry",
    plan: "byclaw.acp.plan",
    run: "byclaw.acp.run",
    runsList: "byclaw.acp.runs.list",
    runsShow: "byclaw.acp.runs.show",
  },
  scopes: {
    read: "operator.read",
    write: "operator.write",
  },
} as const;

export const ACP = {
  runtime: "acp",
  streamTo: "parent",
  mode: "run",
  nextType: "sessions_spawn",
} as const;

export const ACP_CLIENT_TYPES = {
  claudeCode: "claude-code",
  codex: "codex",
} as const;

export const CLAUDE = {
  nativeSubagentsRuntime: "claude-code-native-subagents",
  agentNamePrefix: "byclaw",
  fallbackAgentSlug: "agent",
  agentsDirName: ".claude",
  agentsSubdirName: "agents",
} as const;

export const PATHS = {
  openclawDir: ".openclaw",
  openclawStateDir: DEFAULTS.stateDirName,
  workspaceDir: "workspace",
  skillsDir: "skills",
  skillDocFileName: "SKILL.md",
  byclawDir: ".byclaw",
  acpRunsDir: "acp-runs",
  planBundleFileName: "plan-bundle.json",
  byclawRunsDir: "byclaw-runs",
  proofDir: "proof",
  stateSnapshotFileName: "state.snapshot.json",
} as const;

export const SQLITE = {
  fileName: `${PLUGIN.id}.sqlite`,
  busyTimeoutMs: 5000,
  journalMode: "WAL",
} as const;

export const REDIS_KEYS = {
  aimodelConfig: "byai:aimodel:config",
  digitalEmployeePrefix: "DIG_EMPLOYEE_",
  skillPrefix: "SKILL_",
  teamPrefix: "BYCLAW_AGENT_TEAM_",
  workflowPrefix: "BYCLAW_WORKFLOW_",
  loopPrefix: "BYCLAW_LOOP_",
  digitalEmployeePattern: "DIG_EMPLOYEE_*",
  skillPattern: "SKILL_*",
  teamPattern: "BYCLAW_AGENT_TEAM_*",
  workflowPattern: "BYCLAW_WORKFLOW_*",
  loopPattern: "BYCLAW_LOOP_*",
} as const;

export const REDIS_RESP = {
  crlf: "\r\n",
  simpleString: "+",
  error: "-",
  integer: ":",
  bulkString: "$",
  array: "*",
  nullLength: 0,
  protocolOffset: 1,
  lineTerminatorBytes: 2,
} as const;

export const REDIS_COMMANDS = {
  auth: "AUTH",
  select: "SELECT",
  get: "GET",
  hget: "HGET",
  keys: "KEYS",
  mget: "MGET",
} as const;

export const MODEL_PROVIDER_API = {
  anthropicMessages: "anthropic-messages",
  openaiResponses: "openai-responses",
  openaiCompletions: "openai-completions",
} as const;

export const MODEL_PROVIDER_MARKERS = {
  anthropic: "anthropic",
  claude: "claude",
  responses: "responses",
} as const;

export const MODEL_DEFAULTS = {
  providerKeyPrefix: "baiying-m",
  unknownProviderKey: "unknown",
  type: "LLM",
} as const;

export const METADATA_KEYS = {
  byclawTeam: "byclawTeam",
  byclawWorkflow: "byclawWorkflow",
  byclawLoop: "byclawLoop",
  claudeTeam: "claudeTeam",
  agentModels: "agentModels",
  responseLanguage: "responseLanguage",
  fixedWorkSpecs: "fixedWorkSpecs",
  bundle: "bundle",
} as const;

export const RESPONSE_LANGUAGE = {
  zhCn: "zh_CN",
  enUs: "en_US",
  source: "byai-channel",
  chineseInstruction: "请使用简体中文响应；除非用户在当前 query 中明确要求其它语言，否则不要切换语言。",
  englishInstruction:
    "Respond in English unless the user explicitly requests another language in the current query.",
} as const;

export const BUNDLE = {
  version: 1,
  metadataBootstrapProtocolVersion: 1,
  source: "byclaw-digital-employee-redis",
  fallbackPathPart: "byclaw-acp",
  attributionSource: "acp-tooluse-runtime-metadata",
  visibleOutputPolicy: "business-only-no-internal-agent-event-markers",
  pathPartMaxLength: 80,
  randomRadix: 36,
  randomSliceStart: 2,
  randomSliceEnd: 8,
  queryFileName: "query.md",
  metadataFileName: "metadata.md",
  runsDirName: "runs",
  bootstrapContractFileName: "bootstrap-contract.json",
  bootstrapReceiptFileName: "bootstrap-receipt.json",
  clientDirNames: {
    claudeCode: "claudeCode",
    codex: "codex",
  },
} as const;

export const SESSION_FILES = {
  root: "/by/.sessions",
  previewPrefixPlaceholder: "{{file_preview_prefix}}",
} as const;

export const SKILL_PATHS = {
  safePathPartMaxLength: 120,
  fallbackDirName: "skill",
  virtualRoot: `/${PATHS.openclawDir}`,
  skillsMarker: `/${PATHS.skillsDir}/`,
  agentWorkspaceSource: "agent-workspace-skills",
  workspaceSource: "workspace-skills",
  stateSource: "openclaw-state-skills",
  skillPathSource: "skillPath",
  virtualSkillPathSource: "virtual-skillPath",
  relativeSkillPathSource: "relative-skillPath",
  skillDocObjectKeySource: "skillDocObjectKey",
  virtualSkillDocObjectKeySource: "virtual-skillDocObjectKey",
  relativeSkillDocObjectKeySource: "relative-skillDocObjectKey",
} as const;

export const PIPELINE = {
  acpRunIdPrefix: "byclaw-acp",
  runIdPrefix: "run",
  flowIdPrefix: "task-flow",
  taskIdSeparator: ":",
  randomRadix: 36,
  randomSliceStart: 2,
  randomSliceEnd: 10,
  isoDateStart: 0,
  isoDateEnd: 10,
  defaultSourceKind: "byclaw_acp",
  manualSourceKind: "manual",
  defaultHumanGate: "A3",
  defaultWorkboardBoardId: "byclaw-rd",
  defaultTaskRole: "worker",
  defaultTaskRoleInstructionRole: "agent",
  claimTtlMs: 60 * 60 * 1000,
  statuses: {
    planned: "planned",
    planning: "planning",
    ready: "ready",
    proposed: "proposed",
  },
  events: {
    pipelineRunCreated: "pipeline_run_created",
    pipelineTaskCreated: "pipeline_task_created",
  },
  artifact: {
    kind: "state_snapshot",
    source: "orchestrator",
    owner: "orchestrator",
    visibility: "human",
    generatedFrom: "sqlite",
    authority: "byclaw_pipeline_runs",
  },
  loopContract: {
    cadence: "event-driven",
    actor: "orchestrator",
    stateFlow: "Task Flow",
    stateTasks: "Workboard cards",
    stateMirror: "byclaw-runs/<runId>/",
    makers: ["req-analyst", "arch-designer", "coder"],
    checkers: ["arch-designer", "reviewer", "tester", "CI"],
    maxAgentTurns: 20,
  },
} as const;

export const LOOKUP = {
  digitalEmployeeTokenPrefix: "dig_employee_",
  baiyingAgentTokenPrefix: "baiying-agent-",
  linkedSkillInputRe:
    /\blinkedskills\b|\bskillpath\b|\bskill\.md\b|\bskills?\b|挂载\s*skill|关联\s*skill|挂载技能|关联技能/u,
} as const;
