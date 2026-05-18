import { promises as fs } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import type { CorePersonaExtension } from "./core-persona-definition.js";
import { parseCorePersonaDefinition } from "./core-persona-definition.js";
import { resolveDefaultManagedWorkspacePath } from "./workspace-paths.js";

const MARKER = "<!-- baiying-enhance: managed seed -->";

function stripLeadingBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

// Inline the filenames from openclaw's workspace.ts to avoid relative imports.
const SOUL_FILENAME = "SOUL.md";
const AGENTS_FILENAME = "AGENTS.md";
export const BUSINESS_EXTENSIONS_FILENAME = "BYAI_BUSINESS_EXTENSIONS.md";
const IDENTITY_FILENAME = "IDENTITY.md";
const USER_FILENAME = "USER.md";
const TOOLS_FILENAME = "TOOLS.md";

type BaiyingAgentItem = {
  resourceId?: string;
  name?: string;
  /** 平台「核心人格」长文，应对 OpenClaw `SOUL.md` 与 LLM 人设（优于散装 instructions 字段）。 */
  corePersonaDefinition?: string;
  instructions?: string;
  intro?: string;
  descText?: string;
  avatar?: string;
  openingQuestion?: string;
  integrationType?: string;
  agentSseUrl?: string;
  relResourceInfoList?: Array<{
    resourceId?: string;
    resourceName?: string;
    resourceType?: string;
    resourceBizType?: string;
    resourceCode?: string;
    resourceDesc?: string;
  }>;
  coreCompetencies?: Array<{
    coreCompetency?: string;
    description?: string;
    acceptBoundary?: string[];
    rejectBoundary?: string[];
    example?: string[];
  }>;
};

function parseOpeningQuestions(raw: string | undefined): string[] {
  if (!raw || typeof raw !== "string") {
    return [];
  }
  const t = raw.trim();
  if (!t) {
    return [];
  }
  try {
    const parsed = JSON.parse(t) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x));
    }
  } catch {
    // ignore
  }
  return [t];
}

function getFirstAgentItem(raw: unknown): BaiyingAgentItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const list = (raw as { agent_list?: unknown }).agent_list;
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  const first = list[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const o = first as Record<string, unknown>;
  const relResourceInfoList = Array.isArray(o.relResourceInfoList)
    ? (o.relResourceInfoList as NonNullable<BaiyingAgentItem["relResourceInfoList"]>)
    : Array.isArray(o.relResourceList)
      ? (o.relResourceList as NonNullable<BaiyingAgentItem["relResourceInfoList"]>)
      : undefined;
  return { ...(first as BaiyingAgentItem), relResourceInfoList } as BaiyingAgentItem;
}

/** Parse raw Baiying detail format (resourceId + resourceName at root) into BaiyingAgentItem. */
function getRawDetailItem(raw: unknown): BaiyingAgentItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const d = raw as Record<string, unknown>;
  if (typeof d.resourceId !== "string" || typeof d.resourceName !== "string") {
    return null;
  }

  const str = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : "");

  // Parse prologue JSON for descText, openingQuestion.
  let prologue: Record<string, unknown> | null = null;
  if (typeof d.prologue === "string" && d.prologue.trim()) {
    try {
      prologue = JSON.parse(d.prologue) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  // Compose instructions from multiple fields (used when `corePersonaDefinition` 为空时兜底)。
  const instructionParts = [
    str(d.roleAttributes),
    str(d.processingFlow),
    str(d.ability),
    str(d.constraints),
    str(d.personalityDimensions),
    str(d.wordPreferences),
    str(d.sentenceAndTone),
    str(d.faqs),
  ].filter(Boolean);

  const corePersona = str(d.corePersonaDefinition) || undefined;

  // Parse coreCompetencies JSON string.
  let coreCompetencies: BaiyingAgentItem["coreCompetencies"] = undefined;
  if (typeof d.coreCompetencies === "string" && d.coreCompetencies.trim()) {
    try {
      const parsed = JSON.parse(d.coreCompetencies);
      if (Array.isArray(parsed)) {
        coreCompetencies = parsed;
      }
    } catch {
      // ignore
    }
  }

  return {
    resourceId: str(d.resourceId),
    name: str(d.resourceName),
    corePersonaDefinition: corePersona,
    instructions: instructionParts.join("\n\n") || undefined,
    intro: str(d.resourceDesc),
    descText: str(prologue?.descText),
    avatar: str(d.avatar),
    openingQuestion:
      typeof prologue?.openingQuestion === "string" ? prologue.openingQuestion : undefined,
    integrationType: str(d.integrationType) || undefined,
    agentSseUrl: str(d.agentSseUrl) || undefined,
    relResourceInfoList: Array.isArray(d.relResourceInfoList)
      ? d.relResourceInfoList
      : Array.isArray(d.relResourceList)
        ? d.relResourceList
        : undefined,
    coreCompetencies,
  };
}

export function buildByaiBusinessExtensionsMd(extensions: CorePersonaExtension[]): string | null {
  if (extensions.length === 0) {
    return null;
  }
  const lines: string[] = [MARKER, "", "# 百应业务拓展属性", ""];
  for (const e of extensions) {
    const heading =
      (e.name && e.name.trim()) || (e.key && e.key.trim()) || "拓展项";
    lines.push(`### ${heading}`, "");
    if (e.value?.trim()) {
      lines.push(e.value.trim(), "");
    }
    if (e.key?.trim()) {
      lines.push(`- 平台 key: \`${e.key.trim()}\``, "");
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function buildSoul(item: BaiyingAgentItem): string {
  const rawPersona =
    typeof item.corePersonaDefinition === "string" && item.corePersonaDefinition.trim()
      ? item.corePersonaDefinition.trim()
      : undefined;
  const parsed = parseCorePersonaDefinition(rawPersona);
  const fromInstructions =
    typeof item.instructions === "string" && item.instructions.trim()
      ? item.instructions.trim()
      : "";

  let body: string;
  if (parsed.extensions.length > 0) {
    body = fromInstructions || "You are a helpful assistant.";
    body += "\n\n百应业务拓展属性详见工作区文件 `BYAI_BUSINESS_EXTENSIONS.md`。";
  } else {
    const persona = parsed.narrativeText?.trim() || "";
    body = persona || fromInstructions || "You are a helpful assistant.";
  }

  const parts: string[] = [MARKER, ""];

  // For INTERFACE/A2A agents, prepend tool usage guidance.
  if (item.integrationType === "INTERFACE" || item.integrationType === "A2A") {
    parts.push(
      "## Tool usage",
      "",
      "You have access to the `baiying_call` tool which connects to your backend service.",
      "Use it to fulfill user requests that require calling your backend capabilities.",
      "",
    );
  }

  parts.push(body, "");
  return parts.join("\n");
}

export function buildAgentsMd(item: BaiyingAgentItem): string {
  const lines: string[] = [MARKER, ""];
  if (typeof item.descText === "string" && item.descText.trim()) {
    lines.push("## Greeting", "", item.descText.trim(), "");
  }
  if (typeof item.intro === "string" && item.intro.trim()) {
    lines.push("## Capabilities overview", "", item.intro.trim(), "");
  }
  const cc = item.coreCompetencies;
  if (Array.isArray(cc) && cc.length > 0) {
    lines.push("## Core competencies", "");
    for (const c of cc) {
      const title = typeof c.coreCompetency === "string" ? c.coreCompetency : "Competency";
      lines.push(`### ${title}`, "");
      if (typeof c.description === "string" && c.description.trim()) {
        lines.push(c.description.trim(), "");
      }
      if (Array.isArray(c.acceptBoundary) && c.acceptBoundary.length > 0) {
        lines.push("**In scope:**", ...c.acceptBoundary.map((x) => `- ${x}`), "");
      }
      if (Array.isArray(c.rejectBoundary) && c.rejectBoundary.length > 0) {
        lines.push("**Out of scope:**", ...c.rejectBoundary.map((x) => `- ${x}`), "");
      }
      if (Array.isArray(c.example) && c.example.length > 0) {
        lines.push("**Examples:**", ...c.example.map((x) => `- ${x}`), "");
      }
    }
  }

  const personaExt = parseCorePersonaDefinition(
    typeof item.corePersonaDefinition === "string" && item.corePersonaDefinition.trim()
      ? item.corePersonaDefinition.trim()
      : undefined,
  );
  if (personaExt.extensions.length > 0) {
    lines.push("## 百应业务拓展属性", "");
    for (const e of personaExt.extensions) {
      const label = (e.name && e.name.trim()) || (e.key && e.key.trim()) || "拓展项";
      const val =
        e.value?.trim() ? e.value.trim() : "（未填写 value）";
      lines.push(`- **${label}**：${val}`);
    }
    lines.push("", "完整条目与平台 key 见同目录 `BYAI_BUSINESS_EXTENSIONS.md`。", "");
  }

  // Associated resources section.
  const res = item.relResourceInfoList;
  if (Array.isArray(res) && res.length > 0) {
    lines.push("## Associated resources", "");
    lines.push("The following resources are available via the `baiying_call` tool:", "");
    for (const r of res) {
      const name = r.resourceName ?? r.resourceId ?? "resource";
      const rType = r.resourceBizType ?? r.resourceType ?? "UNKNOWN";
      const desc = r.resourceDesc ? `: ${r.resourceDesc}` : "";
      lines.push(`- **${name}** (${rType})${desc}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildIdentityMd(item: BaiyingAgentItem): string {
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Agent";
  const lines = [MARKER, "", `## Name`, "", name, ""];
  if (typeof item.avatar === "string" && item.avatar.trim()) {
    lines.push("## Avatar (source system path)", "", item.avatar.trim(), "");
  }
  return `${lines.join("\n")}\n`;
}

function buildUserMd(item: BaiyingAgentItem): string {
  const qs = parseOpeningQuestions(item.openingQuestion);
  const lines = [MARKER, "", "## Suggested opening questions", ""];
  if (qs.length === 0) {
    lines.push("(none extracted from JSON)", "");
  } else {
    for (const q of qs) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function isDocResourceType(resourceType: string | undefined): boolean {
  const t = (resourceType ?? "").trim().toUpperCase();
  return t === "DOC" || t === "ATOM" || t === "KG_DOC" || t === "KG_DB" || t === "KG_QA";
}

function buildToolsMd(item: BaiyingAgentItem, fallbackAgentId?: string): string {
  const lines = [MARKER, "", "# Tools", "", "## baiying_call", ""];
  lines.push(
    "Use `baiying_call` to access Baiying backend resources associated with this agent.",
    "",
    "Suggested parameters:",
    "- `query`: natural-language task summary",
    "- `agent_id`: required by executor for DOC resources; if omitted, plugin can auto-fill it from agent.json `resourceId`",
    "- `resource_id`: target parent resource ID",
    "- `resource_type`: optional resource type hint such as `TOOLKIT`, `TOOL`, `MCP`, `OBJECT`, `VIEW`, `KG_DOC`",
    "- `action`: required when a `TOOLKIT` or `MCP` resource exposes multiple child tools; usually not needed for `OBJECT`/`VIEW` callAgent dispatch",
    "- `arguments`: structured backend parameters",
    "",
  );

  const res = item.relResourceInfoList;
  const resolvedAgentId =
    (typeof item.resourceId === "string" && item.resourceId.trim() ? item.resourceId.trim() : "") ||
    (typeof fallbackAgentId === "string" && fallbackAgentId.trim() ? fallbackAgentId.trim() : "");
  if (Array.isArray(res) && res.length > 0) {
    lines.push("## Available resources", "");
    for (const r of res) {
      const name = r.resourceName ?? r.resourceId ?? "resource";
      const resourceId = r.resourceId ?? "unknown";
      const rType = r.resourceBizType ?? r.resourceType ?? "UNKNOWN";
      const resourceCode = r.resourceCode ? `, code: ${r.resourceCode}` : "";
      const agentIdPart =
        isDocResourceType(rType) && resolvedAgentId ? `agent_id: ${resolvedAgentId}, ` : "";
      const desc = r.resourceDesc ? ` - ${r.resourceDesc}` : "";
      lines.push(`- **${name}** [${agentIdPart}id: ${resourceId}, type: ${rType}${resourceCode}]${desc}`);
    }
    lines.push("");
  } else {
    lines.push("## Available resources", "", "(none declared in Baiying export)", "");
  }

  lines.push(
    "## Notes",
    "",
    "- `TOOLKIT` and `MCP` resources may expose child actions discovered from Redis snapshots or remote metadata.",
    "- For DOC resources (`KG_DOC`/`KG_DB`/`KG_QA`), executor requires `agent_id`. `baiying_call` will auto-fill it from the current agent.json `resourceId` and send it as top-level payload `agent_id`.",
    "- `OBJECT` and `VIEW` resources are dispatched through SDK `callAgent` to `BYCLAW_DATA`; `baiying_call` fills `call_object_ids` / `call_view_ids` from the selected resource code.",
    "- For large `OBJECT`/`VIEW` results, backend may return `file_url`, and `file_url` is a local file path; treat it as the authoritative full payload and use this local path for downstream business processing.",
    "- If both inline summary fields and `file_url` are present, prefer the local-file content from `file_url` for detailed reasoning; if unavailable, explicitly state the limitation in your response.",
    "- IMPORTANT: when `file_url` is returned, reading it is mandatory; because file write/publication can lag, retry at least 3 times with a 1-2 second interval before deciding the file is unavailable.",
    "- If the executor reports `ACTION_REQUIRED`, call again with a concrete `action`.",
    "- If parameter validation fails, use the returned `input_properties.fields` (`name` = JSON key, optional `description`) and retry with `arguments`.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

/** Write file only if it does not exist. Returns true if written. */
async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch {
    await fs.writeFile(filePath, content, "utf8");
    return true;
  }
}

/** Check if file content starts with the managed seed marker (leading UTF-8 BOM ignored). */
async function isManagedFile(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return stripLeadingBom(content).startsWith(MARKER);
  } catch {
    return false;
  }
}

/**
 * Resolve workspace directory for an agent entry.
 * Uses config lookup when available, falls back to default path.
 */
export function resolveAgentWorkspaceDir(api: OpenClawPluginApi, agentId: string): string {
  // Try to read from config first (in case agent has a custom workspace path).
  try {
    const cfg = api.runtime.config.loadConfig() as any;
    const agentList = cfg?.agents?.list;
    if (Array.isArray(agentList)) {
      const entry = agentList.find((a: any) => a.id === agentId);
      if (entry?.workspace) {
        return entry.workspace;
      }
    }
  } catch {
    // ignore config read errors
  }
  return resolveDefaultManagedWorkspacePath(agentId);
}

/**
 * Ensure workspace directory exists and seed/update managed markdown files from the agent JSON.
 *
 * On first run: creates workspace dir + all .md files.
 * On subsequent runs: only overwrites files that carry the managed seed marker
 * (i.e. files the plugin generated), leaving user-edited files untouched.
 */
export async function seedManagedAgentWorkspace(params: {
  api: OpenClawPluginApi;
  adapted: AdaptedManagedAgent;
}): Promise<void> {
  const dir = resolveAgentWorkspaceDir(params.api, params.adapted.agentId);
  await fs.mkdir(dir, { recursive: true });

  // Read source JSON for content extraction.
  let raw: unknown = params.adapted.sourceJson;
  if (raw === undefined && params.adapted.sourceFilePath) {
    try {
      raw = JSON.parse(await fs.readFile(params.adapted.sourceFilePath, "utf8"));
    } catch {
      raw = {};
    }
  }
  if (raw === undefined) {
    raw = {};
  }

  const baiying = getFirstAgentItem(raw) ?? getRawDetailItem(raw);

  // Determine content for each managed file.
  const soulContent = baiying
    ? buildSoul(baiying)
    : params.adapted.systemPrompt?.trim()
      ? `${MARKER}\n\n${params.adapted.systemPrompt.trim()}\n`
      : null;

  const agentsContent = baiying ? buildAgentsMd(baiying) : null;
  const identityContent = baiying ? buildIdentityMd(baiying) : null;
  const userContent = baiying ? buildUserMd(baiying) : null;
  const toolsContent = baiying ? buildToolsMd(baiying, params.adapted.sourceKey) : null;

  const businessExtContent = baiying
    ? buildByaiBusinessExtensionsMd(
        parseCorePersonaDefinition(
          typeof baiying.corePersonaDefinition === "string" && baiying.corePersonaDefinition.trim()
            ? baiying.corePersonaDefinition.trim()
            : undefined,
        ).extensions,
      )
    : null;

  // For each file: write if missing, or overwrite if the existing file is managed (has marker).
  const writeManagedFile = async (filename: string, content: string | null) => {
    if (!content) return;
    const filePath = path.join(dir, filename);
    const managed = await isManagedFile(filePath);
    if (managed) {
      // File was generated by us - safe to overwrite with updated content.
      await fs.writeFile(filePath, content, "utf8");
    } else {
      // File doesn't exist or was user-edited - only write if missing.
      await writeIfMissing(filePath, content);
    }
  };

  /** When generated content is absent, remove prior plugin-managed file so stale sections do not linger. */
  const removeManagedFileIfPresent = async (filename: string) => {
    const filePath = path.join(dir, filename);
    if (await isManagedFile(filePath)) {
      await fs.unlink(filePath);
    }
  };

  await writeManagedFile(SOUL_FILENAME, soulContent);
  await writeManagedFile(AGENTS_FILENAME, agentsContent);
  await writeManagedFile(IDENTITY_FILENAME, identityContent);
  await writeManagedFile(USER_FILENAME, userContent);
  await writeManagedFile(TOOLS_FILENAME, toolsContent);
  if (businessExtContent) {
    await writeManagedFile(BUSINESS_EXTENSIONS_FILENAME, businessExtContent);
  } else {
    await removeManagedFileIfPresent(BUSINESS_EXTENSIONS_FILENAME);
  }

  // Ensure TOOLS.md exists even when source JSON has no Baiying payload.
  await writeIfMissing(path.join(dir, TOOLS_FILENAME), `${MARKER}\n\n# Tools\n\n(none)\n`);
}
