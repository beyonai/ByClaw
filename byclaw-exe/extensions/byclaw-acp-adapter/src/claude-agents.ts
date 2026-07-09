import fs from "node:fs";
import path from "node:path";
import type {
  ByclawAgentTeam,
  ByclawLoop,
  ByclawWorkflow,
  JsonRecord,
  NormalizedByclawAgent,
} from "./types.js";
import { CLAUDE, JSON_INDENT_SPACES } from "./constants.js";
import { compactByclawSkill } from "./skill-paths.js";

type ClaudeAgentMaterialization = {
  agentsDir: string;
  agents: Array<{
    byclawAgentId: string;
    name: string;
    displayName: string;
    nativeSubagentId: string;
    nativeSubagentName: string;
    filePath: string;
    role: string;
    model: string;
    baiyingModelId?: string;
    linkedSkills: JsonRecord[];
  }>;
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function claudeAgentName(agent: NormalizedByclawAgent): string {
  const role = slugPart(agent.role || agent.name || agent.id);
  const id = slugPart(agent.id);
  return `${CLAUDE.agentNamePrefix}-${role || id || CLAUDE.fallbackAgentSlug}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function compactSkill(params: { cwd: string; agent: NormalizedByclawAgent; skillIndex: number }): JsonRecord {
  return compactByclawSkill({
    cwd: params.cwd,
    agentId: params.agent.id,
    skill: params.agent.linkedSkills[params.skillIndex],
  });
}

function renderBusinessFramework(agent: NormalizedByclawAgent, linkedSkillCount: number): string[] {
  return [
    "## Business Framework",
    "",
    `- Identity: ${agent.name}`,
    `- Role boundary: ${agent.role || "defined by upstream metadata"}`,
    `- Business description: ${agent.description || "defined by upstream metadata"}`,
    `- Linked skill count: ${linkedSkillCount}`,
    "",
    "## Operating Rules",
    "",
    "- Treat upstream ByClaw metadata as the authority for identity, role boundary, available skills, and business context.",
    "- Work only within the role boundary and task context described by metadata; do not infer a domain-specific workflow that is not present in metadata.",
    "- If linked skills exist, read the referenced skill documentation before applying that skill workflow.",
    "- Produce business-facing output with summary, evidence or proof, risks, and next_action.",
    "- Do not output internal protocol markers, hidden state JSON, or transport events.",
  ];
}

function renderAgentFile(agent: NormalizedByclawAgent, cwd: string): string {
  const name = claudeAgentName(agent);
  const description = compact(`${agent.name} (${agent.role}): ${agent.description}`);
  const linkedSkills = agent.linkedSkills.map((_, index) => compactSkill({ cwd, agent, skillIndex: index }));
  return [
    "---",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    ...(agent.model ? [`model: ${yamlString(agent.model)}`] : []),
    "---",
    "",
    `# ${agent.name}`,
    "",
    ...renderBusinessFramework(agent, linkedSkills.length),
    "",
    "## ByClaw Metadata",
    "",
    `- Digital employee id: ${agent.id}`,
    `- Role: ${agent.role}`,
    `- Preferred model: ${agent.model}`,
    ...(agent.baiyingModelId ? [`- Baiying model config id: ${agent.baiyingModelId}`] : []),
    `- ACP downstream agent: ${agent.acpAgentId}`,
    `- Linked skills: ${linkedSkills.length}`,
    ...(linkedSkills.length
      ? [
          "",
          "## Linked Skills",
          "",
          "这些 skill 来自上游数字员工关联资源，是本 agent 的实际可用业务能力。执行前优先读取绝对路径 skillDocPath；没有 skillDocPath 时再读取 skillPath/SKILL.md。",
          "",
          "```json",
          JSON.stringify(linkedSkills, null, JSON_INDENT_SPACES),
          "```",
        ]
      : []),
    "## Source",
    "",
    "```json",
    JSON.stringify(agent.source, null, JSON_INDENT_SPACES),
    "```",
    "",
  ].join("\n");
}

function atomicWriteFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function materializeClaudeCodeAgents(params: {
  cwd: string;
  members: NormalizedByclawAgent[];
}): ClaudeAgentMaterialization | undefined {
  if (!params.members.length) {
    return undefined;
  }
  const agentsDir = path.join(params.cwd, CLAUDE.agentsDirName, CLAUDE.agentsSubdirName);
  fs.mkdirSync(agentsDir, { recursive: true });
  const agents = params.members.map((agent) => {
    const name = claudeAgentName(agent);
    const filePath = path.join(agentsDir, `${name}.md`);
    atomicWriteFile(filePath, renderAgentFile(agent, params.cwd));
    const linkedSkills = agent.linkedSkills.map((_, index) =>
      compactSkill({ cwd: params.cwd, agent, skillIndex: index }),
    );
    return {
      byclawAgentId: agent.id,
      name,
      displayName: agent.name,
      nativeSubagentId: name,
      nativeSubagentName: agent.name,
      filePath,
      role: agent.role,
      model: agent.model,
      ...(agent.baiyingModelId ? { baiyingModelId: agent.baiyingModelId } : {}),
      linkedSkills,
    };
  });
  return { agentsDir, agents };
}

export function buildClaudeTeamMetadata(params: {
  materialized?: ClaudeAgentMaterialization;
  team?: ByclawAgentTeam;
  workflow?: ByclawWorkflow;
  loop?: ByclawLoop;
}): JsonRecord {
  return {
    runtime: CLAUDE.nativeSubagentsRuntime,
    ...(params.team ? { teamId: params.team.id, teamName: params.team.name } : {}),
    ...(params.workflow
      ? { workflowId: params.workflow.id, workflowName: params.workflow.name }
      : {}),
    ...(params.loop ? { loopId: params.loop.id, loopName: params.loop.name } : {}),
    agentsDir: params.materialized?.agentsDir,
    agents: params.materialized?.agents ?? [],
  };
}

export function formatClaudeAgentRoster(materialized?: { agents?: unknown[] }): string {
  if (!materialized?.agents?.length) {
    return "[]";
  }
  return JSON.stringify(
    materialized.agents.map((agent) => {
      const item = agent && typeof agent === "object" ? (agent as Record<string, unknown>) : {};
      return {
        name: item.name,
        displayName: item.displayName,
        nativeSubagentId: item.nativeSubagentId,
        nativeSubagentName: item.nativeSubagentName,
        byclawAgentId: item.byclawAgentId,
        role: item.role,
        model: item.model,
        baiyingModelId: item.baiyingModelId,
        linkedSkills: Array.isArray(item.linkedSkills) ? item.linkedSkills : [],
      };
    }),
    null,
    JSON_INDENT_SPACES,
  );
}
