import fs from "node:fs";
import path from "node:path";
import type {
  ByclawAcpPlan,
  ByclawAcpPlanRequest,
  ByclawAgentTeam,
  ByclawLoop,
  ByclawRegistrySnapshot,
  ByclawSkillResource,
  ByclawWorkflow,
  JsonRecord,
  NormalizedByclawAgent,
  ResolvedByclawAcpAdapterConfig,
} from "./types.js";
import {
  buildClaudeTeamMetadata,
  claudeAgentName,
  materializeClaudeCodeAgents,
} from "./claude-agents.js";
import {
  ACP,
  ACP_CLIENT_TYPES,
  BUNDLE,
  CLAUDE,
  DEFAULTS,
  ENV,
  JSON_INDENT_SPACES,
  LOOKUP,
  METADATA_KEYS,
  PATHS,
  REDIS_KEYS,
  RESPONSE_LANGUAGE,
  SESSION_FILES,
} from "./constants.js";
import { compactByclawSkill } from "./skill-paths.js";

const DEFAULT_CLAUDE_CODE_MODEL =
  process.env[ENV.byclawAcpClaudeModel] || process.env[ENV.anthropicModel] || DEFAULTS.claudeCodeModel;

type ResponseLanguagePolicy = {
  language: string;
  languageProvided: boolean;
  source: string;
  instruction: string;
};

type FixedWorkSpecs = {
  sessionFiles: {
    source: string;
    byaiChannelSessionId: string;
    sessionRoot: string;
    policyMarkdown: string;
  };
};

function stringify(value: unknown): string {
  return JSON.stringify(value, null, JSON_INDENT_SPACES);
}

function withoutUndefined<T extends JsonRecord>(value: T): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function normalizeResponseLanguage(language: string | undefined): string {
  const raw = typeof language === "string" ? language.trim() : "";
  if (!raw) {
    return DEFAULTS.replyLanguage;
  }
  return raw.toLowerCase().startsWith("en") ? RESPONSE_LANGUAGE.enUs : RESPONSE_LANGUAGE.zhCn;
}

function responseLanguageInstruction(language: string): string {
  return language === RESPONSE_LANGUAGE.enUs
    ? RESPONSE_LANGUAGE.englishInstruction
    : RESPONSE_LANGUAGE.chineseInstruction;
}

function resolveResponseLanguage(request: ByclawAcpPlanRequest): ResponseLanguagePolicy {
  const rawLanguage = request.replyLanguage || request.language;
  const language = normalizeResponseLanguage(rawLanguage);
  return {
    language,
    languageProvided: request.languageProvided ?? Boolean(rawLanguage),
    source: RESPONSE_LANGUAGE.source,
    instruction: responseLanguageInstruction(language),
  };
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isEnglishResponseLanguage(language: string): boolean {
  return language === RESPONSE_LANGUAGE.enUs;
}

function byaiSessionRoot(sessionId: string): string {
  return path.posix.join(SESSION_FILES.root, sessionId.trim());
}

function renderSessionFilesPolicyMarkdown(params: {
  byaiChannelSessionId: string;
  responseLanguage: ResponseLanguagePolicy;
}): string {
  const sessionRoot = byaiSessionRoot(params.byaiChannelSessionId);
  if (isEnglishResponseLanguage(params.responseLanguage.language)) {
    return [
      "## Session files (mandatory)",
      "**Precedence**: These path rules override vague workspace paths or assumptions about the process cwd.",
      `- **ByAI Channel Session ID**: \`${params.byaiChannelSessionId}\`.`,
      `- **Session Root** (all persisted files for this session): \`${sessionRoot}\`.`,
      "- **MUST** join tool-returned paths with Session Root into a **full absolute path** before any read, citation, or display. Using `/object/...`, `/view/...`, or `/qa/...` **without** Session Root is **incorrect**; do not claim you read a file if you did not use the joined path.",
      "- Typical sources: `view` / `object` -> `data.file_url`, `data.overflow_notice`; `doc` (KG_DOC / KG_DB / KG_QA) terminal text may be English (`Report saved to: /qa/xxx.md`) or another locale; the path after the colon is still relative to Session Root.",
      "- Examples:",
      `  - \`/object/abc/123.json\` -> \`${sessionRoot}/object/abc/123.json\``,
      `  - \`/view/abc/overflow.md\` -> \`${sessionRoot}/view/abc/overflow.md\``,
      `  - \`/qa/report.md\` -> \`${sessionRoot}/qa/report.md\``,
      "- After correct joining, if read still fails, retry per policy (~1-2 s apart, >=3 tries) before stating the file is missing or drawing conclusions from unread content.",
      "## Response file address (on demand)",
      "When you need to provide a generated file link to the user, always use Markdown format: `[file_name]({{file_preview_prefix}}/file_path)`.",
      `You MUST use the placeholder \`${SESSION_FILES.previewPrefixPlaceholder}\` as the path prefix.`,
      "Example:",
      `If the actual file path is \`${sessionRoot}/hello.html\`, output:`,
      `[hello.html](${SESSION_FILES.previewPrefixPlaceholder}${sessionRoot}/hello.html)`,
    ].join("\n");
  }
  return [
    "## Session Files（强制 · 会话落盘路径）",
    "**优先级**：以下路径规则优先于对工作区、进程目录的模糊猜测。",
    `- **ByAI Channel Session ID**：\`${params.byaiChannelSessionId}\`。`,
    `- **Session Root**（本会话唯一落盘根目录）：\`${sessionRoot}\`。`,
    "- **必须**先将工具返回路径与 Session Root 拼成**完整绝对路径**，再读取、引用或展示。单独使用 `/object/...`、`/view/...`、`/qa/...` 而不带 Session Root 属于**错误用法**；若未用拼接后的路径实际读取，**不得**声称已读该文件。",
    "- 常见来源：`view` / `object` 的 `file_url`、`overflow_notice`；`doc`（KG_DOC / KG_DB / KG_QA）终态可能是中文提示（如「报告已保存到：/qa/xxx.md」）或英文（如 `Report saved to: /qa/xxx.md`），**冒号后的路径**仍相对于 Session Root。",
    "- 示例：",
    `  - \`/object/abc/123.json\` -> \`${sessionRoot}/object/abc/123.json\``,
    `  - \`/view/abc/overflow.md\` -> \`${sessionRoot}/view/abc/overflow.md\``,
    `  - \`/qa/report.md\` -> \`${sessionRoot}/qa/report.md\``,
    "- 拼接正确仍失败时，按规范重试（约 1-2 秒间隔、至少 3 次）；**禁止**在未读到内容时编造结论或断言文件不存在。",
    "## Response file address（按需）",
    "当你在回复中需要提供生成的文件链接给用户时，请使用 Markdown 格式展示，格式为 `[文件名]({{file_preview_prefix}}/文件路径)`。",
    `务必使用占位符 \`${SESSION_FILES.previewPrefixPlaceholder}\` 作为路径前缀。`,
    "示例：",
    `文件实际路径为 \`${sessionRoot}/hello.html\`，则输出：`,
    `[hello.html](${SESSION_FILES.previewPrefixPlaceholder}${sessionRoot}/hello.html)`,
  ].join("\n");
}

function buildFixedWorkSpecs(params: {
  byaiChannelSessionId: string;
  responseLanguage: ResponseLanguagePolicy;
}): FixedWorkSpecs {
  return {
    sessionFiles: {
      source: RESPONSE_LANGUAGE.source,
      byaiChannelSessionId: params.byaiChannelSessionId,
      sessionRoot: byaiSessionRoot(params.byaiChannelSessionId),
      policyMarkdown: renderSessionFilesPolicyMarkdown(params),
    },
  };
}

function compactModelConfig(modelConfig: JsonRecord | undefined): JsonRecord | undefined {
  if (!modelConfig) {
    return undefined;
  }
  return withoutUndefined({
    baiyingModelId: modelConfig.baiyingModelId,
    model: modelConfig.model,
    modelName: modelConfig.modelName,
    providerApi: modelConfig.providerApi,
    baseUrl: modelConfig.baseUrl,
    requestDefaults: modelConfig.requestDefaults,
    access: modelConfig.access,
  });
}

function safePathPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BUNDLE.pathPartMaxLength) || BUNDLE.fallbackPathPart;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, JSON_INDENT_SPACES), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function atomicWriteText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function compactAgent(agent: NormalizedByclawAgent, cwd: string): JsonRecord {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    description: agent.description,
    model: agent.model,
    baiyingModelId: agent.baiyingModelId,
    modelConfig: compactModelConfig(agent.modelConfig),
    acpAgentId: agent.acpAgentId,
    linkedSkills: agent.linkedSkills.map((skill) => compactSkill(skill, { cwd, agentId: agent.id })),
  };
}

function compactSkill(
  skill: ByclawSkillResource,
  context: { cwd: string; agentId?: string },
): JsonRecord {
  return compactByclawSkill({ ...context, skill });
}

function compactWorkflow(workflow: ByclawWorkflow): JsonRecord {
  return {
    id: workflow.id,
    name: workflow.name,
    teamId: workflow.teamId,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      name: step.name,
      agentId: step.agentId,
      instruction: step.instruction,
    })),
  };
}

function compactLoop(loop: ByclawLoop): JsonRecord {
  return {
    id: loop.id,
    name: loop.name,
    workflowId: loop.workflowId,
    maxIterations: loop.maxIterations,
    exitCriteria: loop.exitCriteria,
  };
}

function compactClaudeTeam(value: JsonRecord): JsonRecord {
  const rawAgents = Array.isArray(value.agents) ? value.agents : [];
  return {
    runtime: value.runtime,
    teamId: value.teamId,
    teamName: value.teamName,
    workflowId: value.workflowId,
    workflowName: value.workflowName,
    loopId: value.loopId,
    loopName: value.loopName,
    agentsDir: value.agentsDir,
    agents: rawAgents.map((agent) => {
      const item = isRecord(agent) ? agent : {};
      return {
        byclawAgentId: item.byclawAgentId,
        name: item.name,
        displayName: item.displayName,
        nativeSubagentId: item.nativeSubagentId,
        nativeSubagentName: item.nativeSubagentName,
        filePath: item.filePath,
        role: item.role,
        model: item.model,
        baiyingModelId: item.baiyingModelId,
      };
    }),
  };
}

function buildAgentModelsMetadata(members: NormalizedByclawAgent[], cwd: string): JsonRecord {
  const agents = members.map((agent) => {
    const nativeSubagentId = claudeAgentName(agent);
    return {
      byclawAgentId: agent.id,
      nativeSubagentId,
      nativeSubagentName: agent.name,
      displayName: agent.name,
      role: agent.role,
      model: agent.model,
      acpAgentId: agent.acpAgentId,
      linkedSkills: agent.linkedSkills.map((skill) => compactSkill(skill, { cwd, agentId: agent.id })),
      ...(agent.baiyingModelId ? { baiyingModelId: agent.baiyingModelId } : {}),
      ...(agent.modelConfig ? { modelConfig: compactModelConfig(agent.modelConfig) } : {}),
    };
  });
  const byNativeSubagentId = Object.fromEntries(
    agents.map((agent) => [
      agent.nativeSubagentId,
      {
        byclawAgentId: agent.byclawAgentId,
        nativeSubagentId: agent.nativeSubagentId,
        nativeSubagentName: agent.nativeSubagentName,
        displayName: agent.displayName,
      },
    ]),
  );
  const byByclawAgentId = Object.fromEntries(
    agents.map((agent) => [
      agent.byclawAgentId,
      {
        byclawAgentId: agent.byclawAgentId,
        nativeSubagentId: agent.nativeSubagentId,
        nativeSubagentName: agent.nativeSubagentName,
        displayName: agent.displayName,
      },
    ]),
  );
  return {
    version: BUNDLE.version,
    source: BUNDLE.source,
    runtime: CLAUDE.nativeSubagentsRuntime,
    agents,
    byNativeSubagentId,
    byByclawAgentId,
  };
}

function firstAgent(snapshot: ByclawRegistrySnapshot): NormalizedByclawAgent {
  const agent = snapshot.agents[0];
  if (!agent) {
    throw new Error(`No ByClaw ${REDIS_KEYS.digitalEmployeePrefix} metadata found in Redis.`);
  }
  return agent;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function lookupToken(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  return String(value)
    .trim()
    .toLowerCase()
    .replace(new RegExp(`^${LOOKUP.digitalEmployeeTokenPrefix}`, "u"), "")
    .replace(new RegExp(`^${LOOKUP.baiyingAgentTokenPrefix}`, "u"), "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function looseLookupToken(value: unknown): string {
  return lookupToken(value).replace(/-/gu, "");
}

function sourceString(agent: NormalizedByclawAgent, key: string): string {
  const source = isRecord(agent.source) ? agent.source : {};
  const value = source[key];
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function agentLookupCandidates(agent: NormalizedByclawAgent): string[] {
  return [
    agent.id,
    agent.redisKey,
    `${REDIS_KEYS.digitalEmployeePrefix}${agent.id}`,
    agent.name,
    agent.role,
    claudeAgentName(agent),
    sourceString(agent, "resourceCode"),
    sourceString(agent, "resourceName"),
    sourceString(agent, "agentCode"),
    sourceString(agent, "roleCode"),
  ].filter(Boolean);
}

function matchesAgentLookup(agent: NormalizedByclawAgent, id: string): boolean {
  const target = lookupToken(id);
  const looseTarget = looseLookupToken(id);
  if (!target) {
    return false;
  }
  return agentLookupCandidates(agent).some((candidate) => {
    const normalized = lookupToken(candidate);
    return normalized === target || looseLookupToken(candidate) === looseTarget;
  });
}

function findAgent(snapshot: ByclawRegistrySnapshot, id?: string): NormalizedByclawAgent {
  if (!id) {
    return firstAgent(snapshot);
  }
  const agent = snapshot.agents.find((item) => matchesAgentLookup(item, id));
  if (!agent) {
    throw new Error(`ByClaw agent not found: ${id}`);
  }
  return agent;
}

function findTeam(snapshot: ByclawRegistrySnapshot, id?: string): ByclawAgentTeam {
  const team = id
    ? snapshot.teams.find((item) => item.id === id)
    : snapshot.teams[0];
  if (!team) {
    throw new Error(id ? `ByClaw team not found: ${id}` : `No ${REDIS_KEYS.teamPrefix} metadata found.`);
  }
  return team;
}

function findWorkflow(snapshot: ByclawRegistrySnapshot, id?: string): ByclawWorkflow {
  const workflow = id
    ? snapshot.workflows.find((item) => item.id === id)
    : snapshot.workflows[0];
  if (!workflow) {
    throw new Error(id ? `ByClaw workflow not found: ${id}` : `No ${REDIS_KEYS.workflowPrefix} metadata found.`);
  }
  return workflow;
}

function findLoop(snapshot: ByclawRegistrySnapshot, id?: string): ByclawLoop {
  const loop = id ? snapshot.loops.find((item) => item.id === id) : snapshot.loops[0];
  if (!loop) {
    throw new Error(id ? `ByClaw loop not found: ${id}` : `No ${REDIS_KEYS.loopPrefix} metadata found.`);
  }
  return loop;
}

function inputLookupText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input === undefined || input === null) {
    return "";
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function inputMentionsAgentMountedSkills(input: unknown): boolean {
  const text = inputLookupText(input).toLowerCase();
  return LOOKUP.linkedSkillInputRe.test(text);
}

function inferLinkedSkillAgentTarget(
  snapshot: ByclawRegistrySnapshot,
  input: unknown,
): { kind: "agent"; id: string } | undefined {
  if (!inputMentionsAgentMountedSkills(input)) {
    return undefined;
  }
  const agentsWithSkills = snapshot.agents.filter((agent) => agent.linkedSkills.length > 0);
  if (agentsWithSkills.length === 0) {
    return undefined;
  }
  const text = inputLookupText(input);
  const exact = agentsWithSkills.find((agent) =>
    agentLookupCandidates(agent).some((candidate) => {
      const normalized = lookupToken(candidate);
      return normalized && (text.includes(String(candidate)) || lookupToken(text).includes(normalized));
    }),
  );
  return { kind: "agent", id: (exact || agentsWithSkills[0]).id };
}

function inferPlanTargetFromInput(
  snapshot: ByclawRegistrySnapshot,
  input: unknown,
): { kind: ByclawAcpPlan["kind"]; id: string } | undefined {
  const text = inputLookupText(input);
  if (!text) {
    return undefined;
  }
  const candidates = [
    ...snapshot.loops.map((item) => ({ kind: "loop" as const, id: item.id })),
    ...snapshot.workflows.map((item) => ({ kind: "workflow" as const, id: item.id })),
    ...snapshot.teams.map((item) => ({ kind: "team" as const, id: item.id })),
    ...snapshot.agents.map((item) => ({ kind: "agent" as const, id: item.id })),
  ]
    .filter((item) => item.id)
    .sort((a, b) => b.id.length - a.id.length);
  return candidates.find((item) => text.includes(item.id));
}

function resolvePlanTargetById(
  snapshot: ByclawRegistrySnapshot,
  id?: string,
): { kind: ByclawAcpPlan["kind"]; id: string } | undefined {
  if (!id) {
    return undefined;
  }
  if (snapshot.loops.some((item) => item.id === id)) {
    return { kind: "loop", id };
  }
  if (snapshot.workflows.some((item) => item.id === id)) {
    return { kind: "workflow", id };
  }
  if (snapshot.teams.some((item) => item.id === id)) {
    return { kind: "team", id };
  }
  const agent = snapshot.agents.find((item) => matchesAgentLookup(item, id));
  if (agent) {
    return { kind: "agent", id: agent.id };
  }
  return undefined;
}

function inferPlanKind(snapshot: ByclawRegistrySnapshot, id?: string): ByclawAcpPlan["kind"] {
  if (!id) {
    return "agent";
  }
  if (snapshot.workflows.some((item) => item.id === id)) {
    return "workflow";
  }
  if (snapshot.loops.some((item) => item.id === id)) {
    return "loop";
  }
  if (snapshot.teams.some((item) => item.id === id)) {
    return "team";
  }
  if (snapshot.agents.some((item) => matchesAgentLookup(item, id))) {
    return "agent";
  }
  return "agent";
}

function agentById(snapshot: ByclawRegistrySnapshot, id: string): NormalizedByclawAgent | undefined {
  return snapshot.agents.find((agent) => matchesAgentLookup(agent, id));
}

function collectLinkedSkills(members: NormalizedByclawAgent[], cwd: string): JsonRecord[] {
  const byId = new Map<string, { skill: ByclawSkillResource; agentId: string }>();
  for (const member of members) {
    for (const skill of member.linkedSkills) {
      byId.set(skill.id, { skill, agentId: member.id });
    }
  }
  return Array.from(byId.values()).map(({ skill, agentId }) => compactSkill(skill, { cwd, agentId }));
}

function markdownJson(value: unknown): string {
  return ["```json", stringify(value), "```"].join("\n");
}

function markdownInput(input: unknown): string {
  return typeof input === "string" ? input : markdownJson(input ?? {});
}

function clientInstructionFileName(clientType: string): string {
  return `${safePathPart(clientType)}${BUNDLE.clientInstructionFileExtension}`;
}

function clientSharedDirName(clientType: string): string {
  if (clientType === ACP_CLIENT_TYPES.claudeCode) {
    return BUNDLE.clientDirNames.claudeCode;
  }
  if (clientType === ACP_CLIENT_TYPES.codex) {
    return BUNDLE.clientDirNames.codex;
  }
  return safePathPart(clientType);
}

function resolveOpenclawStateDir(cwd: string): string {
  const configured = process.env[ENV.openclawStateDir];
  return configured && configured.trim()
    ? path.resolve(configured.trim())
    : path.join(cwd, PATHS.openclawDir);
}

function resolveSharedRootDir(cwd: string): string {
  return path.dirname(resolveOpenclawStateDir(cwd));
}

function renderQueryMarkdown(params: {
  kind: ByclawAcpPlan["kind"];
  id: string;
  name: string;
  input: unknown;
  responseLanguage: ResponseLanguagePolicy;
}): string {
  return [
    "# ByClaw ACP Query",
    "",
    `- Target kind: ${params.kind}`,
    `- Target id: ${params.id}`,
    `- Target name: ${params.name}`,
    `- Reply language: ${params.responseLanguage.language}`,
    `- Reply instruction: ${params.responseLanguage.instruction}`,
    "",
    "## User Query",
    "",
    markdownInput(params.input),
    "",
  ].join("\n");
}

function renderMetadataMarkdown(params: {
  kind: ByclawAcpPlan["kind"];
  id: string;
  name: string;
  model: string;
  clientType: string;
  cwd: string;
  responseLanguage: ResponseLanguagePolicy;
  fixedWorkSpecs: FixedWorkSpecs;
  agentModels: JsonRecord;
  claudeTeam: JsonRecord;
  members: NormalizedByclawAgent[];
  linkedSkills: JsonRecord[];
  team?: ByclawAgentTeam;
  workflow?: ByclawWorkflow;
  loop?: ByclawLoop;
}): string {
  return [
    "# ByClaw ACP Metadata",
    "",
    "## Run Target",
    "",
    markdownJson({
      kind: params.kind,
      id: params.id,
      name: params.name,
      model: params.model,
      clientType: params.clientType,
      cwd: params.cwd,
      responseLanguage: params.responseLanguage,
    }),
    "",
    "## Response Language",
    "",
    markdownJson(params.responseLanguage),
    "",
    "## Fixed Work Specs",
    "",
    "The downstream ACP client must follow these fixed working rules before reading, citing, or producing files.",
    "",
    params.fixedWorkSpecs.sessionFiles.policyMarkdown,
    "",
    "### Fixed Work Specs JSON",
    "",
    markdownJson(params.fixedWorkSpecs),
    "",
    "## Agent Roster",
    "",
    "The downstream ACP client must choose subagents from this roster when the client supports subagents.",
    "",
    markdownJson(params.agentModels),
    "",
    "## Native Client Team",
    "",
    markdownJson(compactClaudeTeam(params.claudeTeam)),
    "",
    "## Members",
    "",
    markdownJson(params.members.map((agent) => compactAgent(agent, params.cwd))),
    "",
    "## Linked Skills",
    "",
    markdownJson(params.linkedSkills),
    "",
    ...(params.team ? ["## ByClaw Team", "", markdownJson(params.team), ""] : []),
    ...(params.workflow ? ["## ByClaw Workflow", "", markdownJson(compactWorkflow(params.workflow)), ""] : []),
    ...(params.loop ? ["## ByClaw Loop", "", markdownJson(compactLoop(params.loop)), ""] : []),
  ].join("\n");
}

function renderClientInstructions(params: {
  clientType: string;
  responseLanguage: ResponseLanguagePolicy;
  fixedWorkSpecs: FixedWorkSpecs;
}): string {
  const common = [
    "# ACP Client Instructions",
    "",
    `Client type: ${params.clientType}`,
    `Reply language: ${params.responseLanguage.language}`,
    "",
    params.responseLanguage.instruction,
    "",
    "1. Read `query.md` first and treat it as the user request.",
    "2. Read `metadata.md` before planning. It is the authority for agent roster, skill paths, workflow, loop, and model metadata.",
    "3. Use `plan-bundle.json` only when machine-readable detail is needed.",
    "4. Do not invent agents or skills that are absent from metadata.",
    "5. Follow the responseLanguage policy from `metadata.md` for all user-visible output.",
    "6. Preserve proof: list which roster member handled each work item and cite evidence paths or command output.",
    "7. Follow the Fixed Work Specs below; they are mandatory for all downstream agents and subagents.",
    "",
    "## Fixed Work Specs",
    "",
    params.fixedWorkSpecs.sessionFiles.policyMarkdown,
  ];
  if (params.clientType === ACP_CLIENT_TYPES.codex) {
    return [
      ...common,
      "",
      "## Codex",
      "",
      "- Use the main Codex agent as coordinator.",
      "- When spawning subagents is available, derive subagent prompts from `metadata.md` roster entries.",
      "- Keep code changes scoped to the user query and verify with the repository commands that match the touched module.",
      "",
    ].join("\n");
  }
  return [
    ...common,
    "",
    "## Claude Code",
    "",
    "- Use Task/Agent subagents when available.",
    "- `subagent_type` or subagent name must come from `metadata.md` roster entries.",
    "- Each roster member in the relevant workflow should produce proof or an explicit skip reason.",
    "",
  ].join("\n");
}

function buildTask(params: {
  kind: string;
  name: string;
  input: unknown;
  metadata: JsonRecord;
  bundlePath: string;
  clientType: string;
  responseLanguage: ResponseLanguagePolicy;
  fixedWorkSpecs: FixedWorkSpecs;
  sharedDir: string;
  queryPath: string;
  metadataPath: string;
  clientInstructionsPath: string;
  members?: NormalizedByclawAgent[];
  claudeTeam?: JsonRecord;
  workflow?: ByclawWorkflow;
  loop?: ByclawLoop;
}): string {
  return [
    `你是通过 OpenClaw ACP 接入的 ${params.clientType} client，下游任务来自 ByClaw ${params.kind}: ${params.name}。`,
    `回复语言: ${params.responseLanguage.language}。${params.responseLanguage.instruction}`,
    "",
    "用户 query:",
    "",
    markdownInput(params.input),
    "",
    "共享上下文目录已经写入 OpenClaw 与 ACP client 可见的文件系统。",
    `- sharedDir: ${params.sharedDir}`,
    `- query: ${params.queryPath}`,
    `- metadata: ${params.metadataPath}`,
    `- clientInstructions: ${params.clientInstructionsPath}`,
    `- machineBundle: ${params.bundlePath}`,
    `- byaiChannelSessionId: ${params.fixedWorkSpecs.sessionFiles.byaiChannelSessionId}`,
    `- sessionFilesRoot: ${params.fixedWorkSpecs.sessionFiles.sessionRoot}`,
    "",
    "执行顺序:",
    "1. 先读取 query.md，确认用户原始请求。",
    "2. 再读取 metadata.md，按其中 agent roster、linkedSkills、workflow/loop 和模型配置驱动主 agent。",
    "3. 遵守 metadata.md 中的 responseLanguage；所有用户可见输出必须符合该语言策略。",
    "4. 遵守 metadata.md 和 clientInstructions 中的 Fixed Work Specs，尤其是 Session Files 路径拼接规则。",
    "5. 按 clientInstructions 中当前 client 类型的规则派生或调用子 agent。",
    "6. 完成后输出 summary、proof/evidence、risks、verdict、next_action。",
  ].join("\n");
}

function materializePlanBundle(params: {
  cwd: string;
  kind: ByclawAcpPlan["kind"];
  id: string;
  name: string;
  model: string;
  modelConfig?: JsonRecord;
  clientType: string;
  responseLanguage: ResponseLanguagePolicy;
  sessionId?: string;
  agentModels: JsonRecord;
  input: unknown;
  members: NormalizedByclawAgent[];
  claudeTeam: JsonRecord;
  team?: ByclawAgentTeam;
  workflow?: ByclawWorkflow;
  loop?: ByclawLoop;
}): JsonRecord {
  const generatedSessionId = [
    safePathPart(params.kind),
    safePathPart(params.id),
    String(Date.now()),
    Math.random().toString(BUNDLE.randomRadix).slice(BUNDLE.randomSliceStart, BUNDLE.randomSliceEnd),
  ].join("-");
  const byaiChannelSessionId = nonEmptyString(params.sessionId) || generatedSessionId;
  const sessionId = safePathPart(byaiChannelSessionId);
  const sharedDir = path.join(
    resolveSharedRootDir(params.cwd),
    PATHS.byclawDir,
    PATHS.acpRunsDir,
    clientSharedDirName(params.clientType),
    sessionId,
  );
  const bundlePath = path.join(sharedDir, PATHS.planBundleFileName);
  const queryPath = path.join(sharedDir, BUNDLE.queryFileName);
  const metadataPath = path.join(sharedDir, BUNDLE.metadataFileName);
  const clientInstructionsPath = path.join(
    sharedDir,
    BUNDLE.clientsDirName,
    clientInstructionFileName(params.clientType),
  );
  const linkedSkills = collectLinkedSkills(params.members, params.cwd);
  const fixedWorkSpecs = buildFixedWorkSpecs({
    byaiChannelSessionId,
    responseLanguage: params.responseLanguage,
  });
  const bundle = {
    version: BUNDLE.version,
    generatedAt: new Date().toISOString(),
    kind: params.kind,
    id: params.id,
    name: params.name,
    cwd: params.cwd,
    clientType: params.clientType,
    sessionId,
    byaiChannelSessionId,
    responseLanguage: params.responseLanguage,
    fixedWorkSpecs,
    model: params.model,
    modelConfig: compactModelConfig(params.modelConfig),
    input: params.input ?? {},
    agentModels: params.agentModels,
    claudeTeam: compactClaudeTeam(params.claudeTeam),
    members: params.members.map((agent) => compactAgent(agent, params.cwd)),
    linkedSkills,
    sharedContext: {
      sharedDir,
      sessionId,
      byaiChannelSessionId,
      queryPath,
      metadataPath,
      clientInstructionsPath,
      bundlePath,
      sessionFilesRoot: fixedWorkSpecs.sessionFiles.sessionRoot,
    },
    ...(params.team ? { byclawTeam: params.team } : {}),
    ...(params.workflow ? { byclawWorkflow: compactWorkflow(params.workflow) } : {}),
    ...(params.loop ? { byclawLoop: compactLoop(params.loop) } : {}),
    instructions: {
      role: "ByClaw orchestrator coordinates; Claude Code native subagents do the work.",
      attributionSource: BUNDLE.attributionSource,
      responseLanguage: params.responseLanguage,
      requiredRuntimeFields: [
        "subagent_type",
        "toolCallId",
        "nativeSubagentId",
        "displayName",
        "byclawAgentId",
        "role",
        "workflowStepId",
        "model",
      ],
      visibleOutputPolicy: BUNDLE.visibleOutputPolicy,
    },
  };
  atomicWriteText(
    queryPath,
    renderQueryMarkdown({
      kind: params.kind,
      id: params.id,
      name: params.name,
      input: params.input,
      responseLanguage: params.responseLanguage,
    }),
  );
  atomicWriteText(
    metadataPath,
    renderMetadataMarkdown({
      kind: params.kind,
      id: params.id,
      name: params.name,
      model: params.model,
      clientType: params.clientType,
      cwd: params.cwd,
      responseLanguage: params.responseLanguage,
      fixedWorkSpecs,
      agentModels: params.agentModels,
      claudeTeam: params.claudeTeam,
      members: params.members,
      linkedSkills,
      team: params.team,
      workflow: params.workflow,
      loop: params.loop,
    }),
  );
  atomicWriteText(
    clientInstructionsPath,
    renderClientInstructions({
      clientType: params.clientType,
      responseLanguage: params.responseLanguage,
      fixedWorkSpecs,
    }),
  );
  atomicWriteJson(bundlePath, bundle);
  return {
    path: bundlePath,
    sharedDir,
    sessionId,
    queryPath,
    metadataPath,
    clientInstructionsPath,
    clientType: params.clientType,
    responseLanguage: params.responseLanguage,
    fixedWorkSpecs,
    bytes: Buffer.byteLength(JSON.stringify(bundle)),
    sha256Hint: `${params.kind}:${params.id}`,
  };
}

function buildPlan(params: {
  config: ResolvedByclawAcpAdapterConfig;
  kind: ByclawAcpPlan["kind"];
  id: string;
  name: string;
  model: string;
  modelConfig?: JsonRecord;
  agentModels?: JsonRecord;
  bundle?: JsonRecord;
  responseLanguage: ResponseLanguagePolicy;
  request: ByclawAcpPlanRequest;
  metadata: JsonRecord;
  task: string;
}): ByclawAcpPlan {
  const acpAgentId = params.request.acpAgentId || params.config.defaultAcpAgentId;
  const cwd = params.request.cwd || params.config.defaultCwd;
  const model = params.model;
  return {
    kind: params.kind,
    id: params.id,
    name: params.name,
    acpAgentId,
    model,
    cwd,
    replyLanguage: params.responseLanguage.language,
    languageProvided: params.responseLanguage.languageProvided,
    task: params.task,
    metadata: params.metadata,
    sessionsSpawn: {
      runtime: ACP.runtime,
      agentId: acpAgentId,
      streamTo: ACP.streamTo,
      mode: ACP.mode,
      cwd,
      model,
      ...(params.modelConfig ? { modelConfig: compactModelConfig(params.modelConfig) } : {}),
      ...(params.bundle ? { bundle: params.bundle } : {}),
      task: params.task,
      label: `ByClaw ${params.kind}: ${params.name}`,
    },
  };
}

/**
 * Build the natural-language `content` handed to a remote ACP agent via
 * `executeViaCallAgent`. The plan's `task` already embeds the user query, the
 * on-disk shared-context file paths (query.md / metadata.md / plan-bundle.json)
 * and the read-then-execute ordering, so the remote agent reads the structured
 * bundle from the filesystem rather than receiving it inline in the prompt.
 */
export function buildCallAgentContentFromPlan(plan: ByclawAcpPlan): string {
  return plan.task;
}

export function createByclawAcpPlan(params: {
  config: ResolvedByclawAcpAdapterConfig;
  snapshot: ByclawRegistrySnapshot;
  request: ByclawAcpPlanRequest;
}): ByclawAcpPlan {
  const { config, snapshot, request } = params;
  const resolvedTarget = resolvePlanTargetById(snapshot, request.id);
  const inferredTarget =
    resolvedTarget ||
    (request.id
      ? undefined
      : inferPlanTargetFromInput(snapshot, request.input) ||
        inferLinkedSkillAgentTarget(snapshot, request.input));
  const effectiveRequest = inferredTarget
    ? { ...request, kind: inferredTarget.kind, id: inferredTarget.id }
    : request;
  const kind = effectiveRequest.kind || inferPlanKind(snapshot, effectiveRequest.id);
  const cwd = request.cwd || config.defaultCwd;
  const clientType = request.acpClientType || config.defaultAcpClientType;
  const sessionId = request.sessionId;
  const responseLanguage = resolveResponseLanguage(request);

  if (kind === "agent") {
    const agent = findAgent(snapshot, effectiveRequest.id);
    const materialized = materializeClaudeCodeAgents({ cwd, members: [agent] });
    const claudeTeam = buildClaudeTeamMetadata({ materialized });
    const agentModels = buildAgentModelsMetadata([agent], cwd);
    const bundle = materializePlanBundle({
      cwd,
      kind,
      id: agent.id,
      name: agent.name,
      model: agent.model,
      modelConfig: agent.modelConfig,
      clientType,
      responseLanguage,
      sessionId,
      agentModels,
      input: effectiveRequest.input,
      members: [agent],
      claudeTeam,
    });
    const task = buildTask({
      kind,
      name: agent.name,
      input: effectiveRequest.input,
      metadata: agent as unknown as JsonRecord,
      bundlePath: String(bundle.path),
      clientType,
      responseLanguage,
      fixedWorkSpecs: bundle.fixedWorkSpecs,
      sharedDir: String(bundle.sharedDir),
      queryPath: String(bundle.queryPath),
      metadataPath: String(bundle.metadataPath),
      clientInstructionsPath: String(bundle.clientInstructionsPath),
      members: [agent],
      claudeTeam,
    });
    return buildPlan({
      config,
      kind,
      id: agent.id,
      name: agent.name,
      model: agent.model,
      modelConfig: agent.modelConfig,
      agentModels,
      bundle,
      responseLanguage,
      request: { ...effectiveRequest, acpAgentId: request.acpAgentId || agent.acpAgentId },
      metadata: {
        ...(agent as unknown as JsonRecord),
        [METADATA_KEYS.claudeTeam]: claudeTeam,
        [METADATA_KEYS.agentModels]: agentModels,
        [METADATA_KEYS.responseLanguage]: responseLanguage,
        [METADATA_KEYS.fixedWorkSpecs]: bundle.fixedWorkSpecs,
        [METADATA_KEYS.bundle]: bundle,
      },
      task,
    });
  }

  if (kind === "team") {
    const team = findTeam(snapshot, effectiveRequest.id);
    const members = team.memberAgentIds.map((id) => agentById(snapshot, id)).filter(Boolean) as NormalizedByclawAgent[];
    const coordinator = team.coordinatorAgentId ? agentById(snapshot, team.coordinatorAgentId) : members[0];
    const materialized = materializeClaudeCodeAgents({ cwd, members });
    const claudeTeam = buildClaudeTeamMetadata({ materialized, team });
    const agentModels = buildAgentModelsMetadata(members, cwd);
    const bundle = materializePlanBundle({
      cwd,
      kind,
      id: team.id,
      name: team.name,
      model: coordinator?.model || DEFAULT_CLAUDE_CODE_MODEL,
      modelConfig: coordinator?.modelConfig,
      clientType,
      responseLanguage,
      sessionId,
      agentModels,
      input: effectiveRequest.input,
      members,
      claudeTeam,
      team,
    });
    const task = buildTask({
      kind,
      name: team.name,
      input: effectiveRequest.input,
      metadata: team as unknown as JsonRecord,
      bundlePath: String(bundle.path),
      clientType,
      responseLanguage,
      fixedWorkSpecs: bundle.fixedWorkSpecs,
      sharedDir: String(bundle.sharedDir),
      queryPath: String(bundle.queryPath),
      metadataPath: String(bundle.metadataPath),
      clientInstructionsPath: String(bundle.clientInstructionsPath),
      members,
      claudeTeam,
    });
    return buildPlan({
      config,
      kind,
      id: team.id,
      name: team.name,
      model: coordinator?.model || DEFAULT_CLAUDE_CODE_MODEL,
      modelConfig: coordinator?.modelConfig,
      agentModels,
      bundle,
      responseLanguage,
      request: { ...effectiveRequest, acpAgentId: request.acpAgentId || coordinator?.acpAgentId },
      metadata: {
        ...(team as unknown as JsonRecord),
        [METADATA_KEYS.byclawTeam]: team,
        [METADATA_KEYS.claudeTeam]: claudeTeam,
        [METADATA_KEYS.agentModels]: agentModels,
        [METADATA_KEYS.responseLanguage]: responseLanguage,
        [METADATA_KEYS.fixedWorkSpecs]: bundle.fixedWorkSpecs,
        [METADATA_KEYS.bundle]: bundle,
      },
      task,
    });
  }

  if (kind === "workflow") {
    const workflow = findWorkflow(snapshot, effectiveRequest.id);
    const team = workflow.teamId ? snapshot.teams.find((item) => item.id === workflow.teamId) : undefined;
    const members = (team?.memberAgentIds || workflow.steps.map((step) => step.agentId))
      .map((id) => agentById(snapshot, id))
      .filter(Boolean) as NormalizedByclawAgent[];
    const coordinator = members[0];
    const materialized = materializeClaudeCodeAgents({ cwd, members });
    const claudeTeam = buildClaudeTeamMetadata({ materialized, team, workflow });
    const agentModels = buildAgentModelsMetadata(members, cwd);
    const bundle = materializePlanBundle({
      cwd,
      kind,
      id: workflow.id,
      name: workflow.name,
      model: coordinator?.model || DEFAULT_CLAUDE_CODE_MODEL,
      modelConfig: coordinator?.modelConfig,
      clientType,
      responseLanguage,
      sessionId,
      agentModels,
      input: effectiveRequest.input,
      members,
      claudeTeam,
      team,
      workflow,
    });
    const task = buildTask({
      kind,
      name: workflow.name,
      input: effectiveRequest.input,
      metadata: workflow as unknown as JsonRecord,
      bundlePath: String(bundle.path),
      clientType,
      responseLanguage,
      fixedWorkSpecs: bundle.fixedWorkSpecs,
      sharedDir: String(bundle.sharedDir),
      queryPath: String(bundle.queryPath),
      metadataPath: String(bundle.metadataPath),
      clientInstructionsPath: String(bundle.clientInstructionsPath),
      members,
      claudeTeam,
      workflow,
    });
    return buildPlan({
      config,
      kind,
      id: workflow.id,
      name: workflow.name,
      model: coordinator?.model || DEFAULT_CLAUDE_CODE_MODEL,
      modelConfig: coordinator?.modelConfig,
      agentModels,
      bundle,
      responseLanguage,
      request: { ...effectiveRequest, acpAgentId: request.acpAgentId || coordinator?.acpAgentId },
      metadata: {
        ...(workflow as unknown as JsonRecord),
        [METADATA_KEYS.byclawTeam]: team,
        [METADATA_KEYS.byclawWorkflow]: workflow,
        [METADATA_KEYS.claudeTeam]: claudeTeam,
        [METADATA_KEYS.agentModels]: agentModels,
        [METADATA_KEYS.responseLanguage]: responseLanguage,
        [METADATA_KEYS.fixedWorkSpecs]: bundle.fixedWorkSpecs,
        [METADATA_KEYS.bundle]: bundle,
      },
      task,
    });
  }

  const loop = findLoop(snapshot, effectiveRequest.id);
  const workflow = findWorkflow(snapshot, loop.workflowId);
  const team = workflow.teamId ? snapshot.teams.find((item) => item.id === workflow.teamId) : undefined;
  const members = (team?.memberAgentIds || workflow.steps.map((step) => step.agentId))
    .map((id) => agentById(snapshot, id))
    .filter(Boolean) as NormalizedByclawAgent[];
  const coordinator = members[0];
  const materialized = materializeClaudeCodeAgents({ cwd, members });
  const claudeTeam = buildClaudeTeamMetadata({ materialized, team, workflow, loop });
  const agentModels = buildAgentModelsMetadata(members, cwd);
  const bundle = materializePlanBundle({
    cwd,
    kind,
    id: loop.id,
    name: loop.name,
    model: coordinator?.model || DEFAULT_CLAUDE_CODE_MODEL,
    modelConfig: coordinator?.modelConfig,
    clientType,
    responseLanguage,
    sessionId,
    agentModels,
    input: effectiveRequest.input,
    members,
    claudeTeam,
    team,
    workflow,
    loop,
  });
  const task = buildTask({
    kind,
    name: loop.name,
    input: effectiveRequest.input,
    metadata: loop as unknown as JsonRecord,
    bundlePath: String(bundle.path),
    clientType,
    responseLanguage,
    fixedWorkSpecs: bundle.fixedWorkSpecs,
    sharedDir: String(bundle.sharedDir),
    queryPath: String(bundle.queryPath),
    metadataPath: String(bundle.metadataPath),
    clientInstructionsPath: String(bundle.clientInstructionsPath),
    members,
    claudeTeam,
    workflow,
    loop,
  });
  return buildPlan({
    config,
    kind,
    id: loop.id,
    name: loop.name,
    model: coordinator?.model || DEFAULT_CLAUDE_CODE_MODEL,
    modelConfig: coordinator?.modelConfig,
    agentModels,
    bundle,
    responseLanguage,
    request: { ...effectiveRequest, acpAgentId: request.acpAgentId || coordinator?.acpAgentId },
    metadata: {
      ...(loop as unknown as JsonRecord),
      [METADATA_KEYS.byclawTeam]: team,
      [METADATA_KEYS.byclawWorkflow]: workflow,
      [METADATA_KEYS.byclawLoop]: loop,
      [METADATA_KEYS.claudeTeam]: claudeTeam,
      [METADATA_KEYS.agentModels]: agentModels,
      [METADATA_KEYS.responseLanguage]: responseLanguage,
      [METADATA_KEYS.fixedWorkSpecs]: bundle.fixedWorkSpecs,
      [METADATA_KEYS.bundle]: bundle,
    },
    task,
  });
}
