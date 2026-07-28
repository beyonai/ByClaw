import type {
  AgentCapabilityCompileInput,
  AgentCapabilityExample,
  AgentCapabilitySourceItem,
} from "@byclaw/by-conductor";

export interface DigitalEmployeeCapabilityRow {
  agent_id: string | number;
  system_code: string | null;
  resource_code: string | null;
  resource_name: string;
  resource_desc: string | null;
  tags: string | null;
  resource_d_verid: string | number | null;
  resource_r_verid: string | number | null;
  create_time: unknown;
  update_time: unknown;
  ability: string | null;
  constraints: string | null;
  faqs: string | null;
  processing_flow: string | null;
  core_competencies: string | null;
  core_persona_definition: string | null;
  skills: string | null;
  target_content: string | null;
}

export interface RelatedCapabilityResource {
  agent_id: string | number;
  resource_code: string | null;
  resource_name: string;
  resource_desc: string | null;
  resource_biz_type: string | null;
}

export interface AgentCapabilityBackfillSource {
  agentId: string;
  systemCode: string;
  sourceVersion: string;
  input: AgentCapabilityCompileInput;
}

/** 将数字员工主表、扩展表和关联资源快照转换为能力卡编译器的稳定输入。 */
export function buildAgentCapabilityBackfillSource(
  row: DigitalEmployeeCapabilityRow,
  relations: readonly RelatedCapabilityResource[],
): AgentCapabilityBackfillSource {
  const target = recordValue(parseJsonRecursively(row.target_content));
  const agentId = textValue(row.agent_id);
  const systemCode = textValue(target?.systemCode) || textValue(row.system_code) || "BYAI";
  const name = textValue(target?.resourceName) || textValue(row.resource_name);
  if (!agentId || !name) {
    throw new Error("Digital employee resource_id and resource_name are required");
  }

  const personaRaw =
    target?.relPrompt ??
    target?.corePersonaDefinition ??
    row.core_persona_definition;
  const instructions = buildInstructions({
    personaRaw,
    ability: target?.ability ?? row.ability,
    processingFlow: target?.processingFlow ?? row.processing_flow,
    coreCompetencies:
      target?.coreCompetencies ?? row.core_competencies,
  });
  const relationSkills = relations
    .filter((relation) => normalizedBizType(relation) === "SKILL")
    .map(toSourceItem);
  const relationTools = relations
    .filter((relation) => TOOL_RESOURCE_TYPES.has(normalizedBizType(relation)))
    .map(toSourceItem);
  const skills = uniqueSourceItems([
    ...sourceItems(target?.relSkills ?? target?.skills ?? row.skills),
    ...relationSkills,
  ]);
  const tools = uniqueSourceItems([
    ...sourceItems(target?.relTools),
    ...relationTools,
  ]);
  const coreCompetencies =
    arrayValue(parseJsonRecursively(target?.coreCompetencies ?? row.core_competencies)) ?? [];
  const constraints = uniqueTexts([
    ...textList(target?.constraints ?? row.constraints),
    ...coreCompetencies.flatMap((item) =>
      textList(recordValue(item)?.rejectBoundary),
    ),
  ]);
  const examples = uniqueExamples([
    ...examplesFromValue(target?.faqs ?? row.faqs),
    ...coreCompetencies.flatMap((item) =>
      examplesFromValue(recordValue(item)?.example),
    ),
  ]);
  const knowledgeDomains = uniqueTexts([
    ...textList(target?.tags ?? row.tags),
    ...relations
      .filter((relation) =>
        KNOWLEDGE_RESOURCE_TYPES.has(normalizedBizType(relation)),
      )
      .map((relation) => relation.resource_name),
  ]);

  return {
    agentId,
    systemCode,
    sourceVersion: buildSourceVersion(row),
    input: {
      locale: textValue(target?.language) || "zh-CN",
      agent: {
        ...(textValue(target?.resourceCode) || textValue(row.resource_code)
          ? {
              code:
                textValue(target?.resourceCode) ||
                textValue(row.resource_code),
            }
          : {}),
        name,
        ...(textValue(target?.resourceDesc) || textValue(row.resource_desc)
          ? {
              description:
                textValue(target?.resourceDesc) ||
                textValue(row.resource_desc),
            }
          : {}),
        ...(instructions ? { instructions } : {}),
        ...(skills.length > 0 ? { skills } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(knowledgeDomains.length > 0 ? { knowledgeDomains } : {}),
        ...(constraints.length > 0 ? { constraints } : {}),
        ...(examples.length > 0 ? { examples } : {}),
      },
    },
  };
}

const TOOL_RESOURCE_TYPES = new Set([
  "MCP",
  "MCP_TOOL",
  "PLUGIN",
  "TOOL",
  "TOOLKIT",
]);
const KNOWLEDGE_RESOURCE_TYPES = new Set([
  "DB",
  "DOC",
  "KG_DB",
  "KG_DOC",
  "KG_QA",
  "KG_TERM",
]);

function normalizedBizType(relation: RelatedCapabilityResource): string {
  return textValue(relation.resource_biz_type).toUpperCase();
}

function toSourceItem(
  relation: RelatedCapabilityResource,
): AgentCapabilitySourceItem {
  return {
    ...(textValue(relation.resource_code)
      ? { code: textValue(relation.resource_code) }
      : {}),
    name: textValue(relation.resource_name),
    ...(textValue(relation.resource_desc)
      ? { description: textValue(relation.resource_desc) }
      : {}),
  };
}

function buildInstructions(input: {
  personaRaw: unknown;
  ability: unknown;
  processingFlow: unknown;
  coreCompetencies: unknown;
}): string {
  const sections: string[] = [];
  const persona = parseJsonRecursively(input.personaRaw);
  const personaEntries = arrayValue(persona);
  if (personaEntries) {
    for (const entry of personaEntries) {
      const item = recordValue(entry);
      const content = textValue(item?.value);
      if (!content) {
        continue;
      }
      const title =
        textValue(item?.name) || textValue(item?.nameEn) || textValue(item?.key);
      sections.push(title ? `## ${title}\n\n${content}` : content);
    }
  } else {
    const content = textValue(persona);
    if (content) {
      sections.push(content);
    }
  }
  appendSection(sections, "核心能力", input.ability);
  appendSection(sections, "处理流程", input.processingFlow);

  const competencies = arrayValue(parseJsonRecursively(input.coreCompetencies)) ?? [];
  const competencyLines = competencies.flatMap((entry) => {
    const item = recordValue(entry);
    const name =
      textValue(item?.coreCompetency) || textValue(item?.name);
    const description = textValue(item?.description);
    if (!name && !description) {
      return [];
    }
    return [`- ${[name, description].filter(Boolean).join("：")}`];
  });
  if (competencyLines.length > 0) {
    sections.push(`## 核心能力清单\n\n${competencyLines.join("\n")}`);
  }
  return uniqueTexts(sections).join("\n\n");
}

function appendSection(sections: string[], title: string, value: unknown): void {
  const content = textValue(parseJsonRecursively(value));
  if (content) {
    sections.push(`## ${title}\n\n${content}`);
  }
}

function sourceItems(value: unknown): AgentCapabilitySourceItem[] {
  const parsed = parseJsonRecursively(value);
  const list = arrayValue(parsed);
  if (!list) {
    return [];
  }
  return list.flatMap((entry) => {
    const item = recordValue(entry);
    if (!item) {
      return [];
    }
    const code =
      textValue(item.skillCode) ||
      textValue(item.resourceCode) ||
      textValue(item.code);
    const name =
      textValue(item.resourceName) ||
      textValue(item.label) ||
      textValue(item.name) ||
      code;
    if (!name) {
      return [];
    }
    const description =
      textValue(item.resourceDesc) || textValue(item.description);
    return [
      {
        ...(code ? { code } : {}),
        name,
        ...(description ? { description } : {}),
      },
    ];
  });
}

function examplesFromValue(value: unknown): AgentCapabilityExample[] {
  const parsed = parseJsonRecursively(value);
  const list = arrayValue(parsed);
  if (!list) {
    return [];
  }
  return list.flatMap((entry) => {
    const item = recordValue(entry);
    if (!item) {
      return [];
    }
    const request =
      textValue(item.request) ||
      textValue(item.question) ||
      textValue(item.input);
    const expectedOutcome =
      textValue(item.expectedOutcome) ||
      textValue(item.answer) ||
      textValue(item.output);
    return request && expectedOutcome ? [{ request, expectedOutcome }] : [];
  });
}

function textList(value: unknown): string[] {
  const parsed = parseJsonRecursively(value);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => {
      if (typeof entry === "string" || typeof entry === "number") {
        return splitText(String(entry));
      }
      return [];
    });
  }
  return splitText(textValue(parsed));
}

function splitText(value: string): string[] {
  return value
    .split(/\r?\n|[；;]/)
    .map((entry) => entry.replace(/^[-*•\d.)、\s]+/, "").trim())
    .filter(Boolean);
}

function uniqueSourceItems(
  items: readonly AgentCapabilitySourceItem[],
): AgentCapabilitySourceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = (item.code || item.name).trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueTexts(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueExamples(
  examples: readonly AgentCapabilityExample[],
): AgentCapabilityExample[] {
  const seen = new Set<string>();
  return examples.filter((example) => {
    const key = `${example.request}\u0000${example.expectedOutcome}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildSourceVersion(row: DigitalEmployeeCapabilityRow): string {
  const timestamp = timestampValue(row.update_time) || timestampValue(row.create_time);
  return [
    `r:${textValue(row.resource_r_verid) || "0"}`,
    `d:${textValue(row.resource_d_verid) || "0"}`,
    `updated:${timestamp || "unknown"}`,
  ].join(":");
}

function timestampValue(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const text = textValue(value);
  if (!text) {
    return "";
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text;
}

function parseJsonRecursively(value: unknown, depth = 0): unknown {
  if (depth >= 4 || typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{"-]|^(?:true|false|null|\d)/.test(trimmed)) {
    return value;
  }
  try {
    return parseJsonRecursively(JSON.parse(trimmed) as unknown, depth + 1);
  } catch {
    return value;
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}
