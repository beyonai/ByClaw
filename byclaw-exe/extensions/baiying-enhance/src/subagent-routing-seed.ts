import { promises as fs } from "node:fs";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { parseCorePersonaDefinition } from "./core-persona-definition.js";
import { MANAGED_AGENT_PREFIX, type BaiyingCoreCompetency } from "./types.js";

export const SUBAGENT_ROUTING_MARKER = "<!-- baiying-enhance: subagent routing seed -->";
export const SUBAGENT_ROUTING_FILENAME = "SUBAGENT_ROUTING.md";

/** Total output budget (many agents × compact cards). */
const MAX_TOTAL_CHARS = 9000;
/** One-line role / resourceDesc cap — enough to disambiguate intent, avoid SOUL-sized paste. */
const MAX_ROLE_LINE = 160;
const MAX_INSTRUCTION_FALLBACK = 200;
const MAX_PERSONA_LINE = 180;
const MAX_PERSONA_FRAGMENTS = 3;
const MAX_PERSONA_FRAGMENT_CHARS = 64;
const MAX_COMPETENCIES_INLINE = 4;
const MAX_COMPETENCY_CHARS = 88;
/** Per-side bullet fragments merged into one routing line. */
const MAX_ROUTE_FRAGMENTS = 4;
const MAX_ROUTE_CHARS = 64;
const MAX_AVOID_FRAGMENTS = 3;
const MAX_AVOID_CHARS = 56;
const MAX_EXAMPLES_INLINE = 3;
const MAX_EXAMPLE_CHARS = 48;
const MAX_RESOURCE_FRAGMENTS = 4;
const MAX_RESOURCE_CHARS = 48;

type RoutingHints = {
  resourceDesc?: string;
  instructionsSnippet?: string;
  corePersonaSummary?: string;
  coreCompetencies?: BaiyingCoreCompetency[];
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

function compactInline(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  const t = compactInline(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function ensureRoutingMarkerPrefix(body: string): string {
  const t = stripBom(body);
  if (t.startsWith(SUBAGENT_ROUTING_MARKER)) {
    return t.endsWith("\n") ? t : `${t}\n`;
  }
  return `${SUBAGENT_ROUTING_MARKER}\n\n${t}`;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function parseJsonArrayish(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((s) => String(s).trim()).filter(Boolean) : [];
}

function normalizeCompetencies(raw: unknown): BaiyingCoreCompetency[] {
  const arr = parseJsonArrayish(raw);
  const out: BaiyingCoreCompetency[] = [];
  for (const item of arr) {
    const o = asRecord(item);
    if (!o) continue;
    const c: BaiyingCoreCompetency = {};
    if (typeof o.coreCompetency === "string" && o.coreCompetency.trim()) {
      c.coreCompetency = o.coreCompetency.trim();
    }
    if (typeof o.description === "string" && o.description.trim()) {
      c.description = o.description.trim();
    }
    const acceptBoundary = normalizeStringList(o.acceptBoundary);
    const rejectBoundary = normalizeStringList(o.rejectBoundary);
    const example = normalizeStringList(o.example);
    if (acceptBoundary.length > 0) c.acceptBoundary = acceptBoundary;
    if (rejectBoundary.length > 0) c.rejectBoundary = rejectBoundary;
    if (example.length > 0) c.example = example;
    if (c.coreCompetency || c.description || c.acceptBoundary || c.rejectBoundary || c.example) {
      out.push(c);
    }
  }
  return out;
}

function summarizeCorePersonaDefinition(raw: unknown): string | undefined {
  if (Array.isArray(raw)) {
    raw = JSON.stringify(raw);
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const parsed = parseCorePersonaDefinition(raw.trim());
  if (parsed.extensions.length > 0) {
    const fragments: string[] = [];
    for (const e of parsed.extensions) {
      const label = (e.name && e.name.trim()) || (e.key && e.key.trim()) || "persona";
      const value = e.value?.trim() || "";
      const text = value ? `${label}: ${value}` : label;
      fragments.push(truncate(text, MAX_PERSONA_FRAGMENT_CHARS));
      if (fragments.length >= MAX_PERSONA_FRAGMENTS) break;
    }
    return fragments.length > 0 ? fragments.join(" · ") : undefined;
  }
  return parsed.narrativeText ? truncate(parsed.narrativeText, MAX_PERSONA_LINE) : undefined;
}

function parseSourceJsonHints(raw: unknown): RoutingHints {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const detail =
    typeof o.resourceId === "string" && typeof o.resourceName === "string"
      ? o
      : Array.isArray(o.agent_list) && o.agent_list.length > 0
        ? asRecord(o.agent_list[0])
        : null;

  const hints: RoutingHints = {};
  if (detail) {
    if (typeof detail.resourceDesc === "string" && detail.resourceDesc.trim()) {
      hints.resourceDesc = detail.resourceDesc.trim();
    }
    const competencies = normalizeCompetencies(detail.coreCompetencies ?? o.coreCompetencies);
    if (competencies.length > 0) {
      hints.coreCompetencies = competencies;
    }
    const persona = summarizeCorePersonaDefinition(
      detail.corePersonaDefinition ?? o.corePersonaDefinition,
    );
    if (persona) {
      hints.corePersonaSummary = persona;
    }
  }
  if (typeof o.resourceId === "string" && typeof o.resourceName === "string") {
    return hints;
  }
  const list = o.agent_list;
  if (Array.isArray(list) && list.length > 0 && list[0] && typeof list[0] === "object") {
    const first = list[0] as Record<string, unknown>;
    const ins = typeof first.instructions === "string" ? first.instructions.trim() : "";
    if (ins) {
      hints.instructionsSnippet = ins;
    }
    return hints;
  }
  return hints;
}

function collectDistributedFragments(
  competencies: BaiyingCoreCompetency[] | undefined,
  key: "acceptBoundary" | "rejectBoundary" | "example",
  maxFragments: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(competencies) || competencies.length === 0) {
    return [];
  }
  const buckets = competencies
    .map((c) => normalizeStringList(c[key]))
    .filter((arr) => arr.length > 0);
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < maxFragments; i += 1) {
    let added = false;
    for (const bucket of buckets) {
      const s = bucket[i];
      if (!s) continue;
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(truncate(s, maxChars));
      added = true;
      if (out.length >= maxFragments) return out;
    }
    if (!added) {
      return out;
    }
  }
  return out;
}

function collectCompetencyFragments(competencies: BaiyingCoreCompetency[] | undefined): string[] {
  if (!Array.isArray(competencies) || competencies.length === 0) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of competencies) {
    const name = typeof c.coreCompetency === "string" ? c.coreCompetency.trim() : "";
    const desc = typeof c.description === "string" ? c.description.trim() : "";
    const s = name && desc ? `${name}: ${desc}` : name || desc;
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(truncate(s, MAX_COMPETENCY_CHARS));
    if (out.length >= MAX_COMPETENCIES_INLINE) return out;
  }
  return out;
}

function routingKindLabel(integrationType: string | undefined): string {
  const t = (integrationType ?? "").trim().toUpperCase();
  if (t === "INTERFACE" || t === "A2A" || t === "PAGE") {
    return `BACKEND:${t}`;
  }
  return "LLM";
}

function normalizeIntegrationType(integrationType: string | undefined): string {
  return (integrationType ?? "").trim().toUpperCase();
}

function requiresBaiyingCall(integrationType: string | undefined): boolean {
  const t = normalizeIntegrationType(integrationType);
  return t === "INTERFACE" || t === "A2A" || t === "PAGE";
}

function oneLineRoleForAgent(
  adapted: AdaptedManagedAgent,
  hints: RoutingHints,
): string {
  const resourceDesc = hints.resourceDesc?.trim() || adapted.resourceDesc?.trim();
  if (resourceDesc) {
    return truncate(resourceDesc, MAX_ROLE_LINE);
  }
  const sp = adapted.systemPrompt?.trim();
  if (sp) {
    return truncate(sp, MAX_ROLE_LINE);
  }
  if (hints.instructionsSnippet?.trim()) {
    return truncate(hints.instructionsSnippet, MAX_INSTRUCTION_FALLBACK);
  }
  return "(no role snippet; see agents_list / sub-agent workspace)";
}

function effectiveCoreCompetencies(
  adapted: AdaptedManagedAgent,
  hints: RoutingHints,
): BaiyingCoreCompetency[] | undefined {
  if (Array.isArray(adapted.coreCompetencies) && adapted.coreCompetencies.length > 0) {
    return adapted.coreCompetencies;
  }
  return hints.coreCompetencies;
}

function pushUniqueFragment(params: {
  out: string[];
  seen: Set<string>;
  value: string | undefined;
  maxChars: number;
  maxFragments: number;
}): void {
  const value = params.value?.trim();
  if (!value || params.out.length >= params.maxFragments) return;
  const fragment = truncate(value, params.maxChars);
  if (!fragment || params.seen.has(fragment)) return;
  params.seen.add(fragment);
  params.out.push(fragment);
}

function buildRouteFragments(params: {
  roleLine: string;
  competencyFragments: string[];
  acceptFragments: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const role = params.roleLine.startsWith("(no role snippet") ? "" : params.roleLine;
  pushUniqueFragment({
    out,
    seen,
    value: role,
    maxChars: MAX_ROLE_LINE,
    maxFragments: MAX_ROUTE_FRAGMENTS,
  });
  for (const fragment of params.acceptFragments) {
    pushUniqueFragment({
      out,
      seen,
      value: fragment,
      maxChars: MAX_ROUTE_CHARS,
      maxFragments: MAX_ROUTE_FRAGMENTS,
    });
  }
  for (const fragment of params.competencyFragments) {
    pushUniqueFragment({
      out,
      seen,
      value: fragment,
      maxChars: MAX_ROUTE_CHARS,
      maxFragments: MAX_ROUTE_FRAGMENTS,
    });
  }
  if (out.length === 0) {
    out.push("(see agents_list / sub-agent workspace)");
  }
  return out;
}

function buildDispatchContract(integrationType: string | undefined): string {
  if (requiresBaiyingCall(integrationType)) {
    return "spawn brief 必须明确要求该 agent 使用 `baiying_call` 执行；不要只返回自然语言说明。";
  }
  return "派发一个边界清晰的子任务；要求结构化结果、依据、假设与不确定性。";
}

function buildEvidenceContract(integrationType: string | undefined): string {
  // const t = normalizeIntegrationType(integrationType);
  // if (t === "PAGE") {
  //   return "页面/原型链接、页面ID/产物ID、`baiying_call` 结果、生成状态或失败原因。";
  // }
  // if (requiresBaiyingCall(integrationType)) {
  //   return "`baiying_call` 工具结果、业务数据/执行状态或失败原因。";
  // }
  return "结构化结论、关键依据、假设与不确定性。";
}

function collectResourceFragments(adapted: AdaptedManagedAgent): string[] {
  const resources = adapted.associatedResources ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    const type = (resource.resourceBizType || resource.resourceType || "UNKNOWN").trim();
    const name = resource.resourceName?.trim() || resource.resourceId;
    pushUniqueFragment({
      out,
      seen,
      value: `${type}: ${name}`,
      maxChars: MAX_RESOURCE_CHARS,
      maxFragments: MAX_RESOURCE_FRAGMENTS,
    });
    if (out.length >= MAX_RESOURCE_FRAGMENTS) return out;
  }
  return out;
}

/**
 * Build compact markdown for main-workspace `SUBAGENT_ROUTING.md`.
 * Optimized for parent-agent routing and dispatch contracts, not full persona replication.
 */
export async function buildSubagentRoutingMarkdown(managed: AdaptedManagedAgent[]): Promise<string> {
  const managedOnly = managed
    .filter((m) => typeof m.agentId === "string" && m.agentId.startsWith(MANAGED_AGENT_PREFIX))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  const lines: string[] = [
    "# Sub-agent routing (baiying-enhance)",
    "",
    "Dense **routing + dispatch hints only**. **Not** an allowlist — call `agents_list` in the same turn before `sessions_spawn`.",
    "",
    "Use each card to choose the agent, then copy its `dispatch` and `evidence` requirements into the spawn brief.",
    "",
    "---",
    "",
  ];

  if (managedOnly.length === 0) {
    lines.push("## Registry", "", "No `baiying-agent-*` in scan. Use `agents_list`.", "");
    const body = lines.join("\n").trim();
    return ensureRoutingMarkerPrefix(`${body}\n`);
  }

  for (const adapted of managedOnly) {
    let hints: RoutingHints = {};
    if (adapted.sourceJson !== undefined) {
      hints = parseSourceJsonHints(adapted.sourceJson);
    } else if (adapted.sourceFilePath) {
      try {
        const rawText = await fs.readFile(adapted.sourceFilePath, "utf8");
        hints = parseSourceJsonHints(JSON.parse(rawText) as unknown);
      } catch {
        hints = {};
      }
    }

    const displayName =
      (typeof adapted.listEntry.name === "string" && adapted.listEntry.name.trim()
        ? adapted.listEntry.name.trim()
        : adapted.agentId) || adapted.agentId;

    const integ = adapted.integrationType?.trim() || "NONE";
    const kind = routingKindLabel(adapted.integrationType);
    const tags = requiresBaiyingCall(adapted.integrationType) ? " · **requires:baiying_call**" : "";
    const roleLine = oneLineRoleForAgent(adapted, hints);
    const competencies = effectiveCoreCompetencies(adapted, hints);
    const capFr = collectCompetencyFragments(competencies);
    const routeFr = buildRouteFragments({
      roleLine,
      competencyFragments: capFr,
      acceptFragments: collectDistributedFragments(
        competencies,
        "acceptBoundary",
        MAX_ROUTE_FRAGMENTS,
        MAX_ROUTE_CHARS,
      ),
    });
    const avoidFr = collectDistributedFragments(
      competencies,
      "rejectBoundary",
      MAX_AVOID_FRAGMENTS,
      MAX_AVOID_CHARS,
    );
    const exFr = collectDistributedFragments(
      competencies,
      "example",
      MAX_EXAMPLES_INLINE,
      MAX_EXAMPLE_CHARS,
    );
    const resourceFr = collectResourceFragments(adapted);

    const card: string[] = [
      `## ${displayName}`,
      `- **agentId**: \`${adapted.agentId}\` · **${integ}** · **${kind}**${tags}`,
      `- **route**: ${routeFr.join(" · ")}`,
    ];

    if (avoidFr.length > 0) {
      card.push(`- **avoid**: ${avoidFr.join(" · ")}`);
    }
    card.push(`- **dispatch**: ${buildDispatchContract(adapted.integrationType)}`);
    card.push(`- **evidence**: ${buildEvidenceContract(adapted.integrationType)}`);
    if (resourceFr.length > 0) {
      card.push(`- **resources**: ${resourceFr.join(" · ")}`);
    }
    if (exFr.length > 0) {
      card.push(`- **ex**: ${exFr.join(" · ")}`);
    }

    if (!hints.resourceDesc && hints.instructionsSnippet && !competencies?.length) {
      card.push(`- _sparse export — confirm with \`agents_list\`._`);
    }

    lines.push(...card, "", "---", "");
  }

  let body = lines.join("\n").trim();
  if (body.length > MAX_TOTAL_CHARS) {
    body = `${truncate(body, MAX_TOTAL_CHARS - 72)}\n\n_…truncated; see sub-agent workspaces._\n`;
  }
  return ensureRoutingMarkerPrefix(`${body}\n`);
}
