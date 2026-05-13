import { promises as fs } from "node:fs";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { MANAGED_AGENT_PREFIX, type BaiyingCoreCompetency } from "./types.js";

export const SUBAGENT_ROUTING_MARKER = "<!-- baiying-enhance: subagent routing seed -->";
export const SUBAGENT_ROUTING_FILENAME = "SUBAGENT_ROUTING.md";

/** Total output budget (many agents × compact cards). */
const MAX_TOTAL_CHARS = 9000;
/** One-line role / resourceDesc cap — enough to disambiguate intent, avoid SOUL-sized paste. */
const MAX_ROLE_LINE = 220;
const MAX_INSTRUCTION_FALLBACK = 200;
/** Per-side bullet fragments merged into one routing line. */
const MAX_SCOPE_FRAGMENTS = 2;
const MAX_SCOPE_CHARS = 44;
const MAX_EXAMPLES_INLINE = 2;
const MAX_EXAMPLE_CHARS = 48;

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

function truncate(s: string, max: number): string {
  const t = s.trim();
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

function parseSourceJsonHints(raw: unknown): {
  resourceDesc?: string;
  instructionsSnippet?: string;
} {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.resourceId === "string" && typeof o.resourceName === "string") {
    const rd = typeof o.resourceDesc === "string" && o.resourceDesc.trim() ? o.resourceDesc.trim() : undefined;
    return { resourceDesc: rd };
  }
  const list = o.agent_list;
  if (Array.isArray(list) && list.length > 0 && list[0] && typeof list[0] === "object") {
    const first = list[0] as Record<string, unknown>;
    const ins = typeof first.instructions === "string" ? first.instructions.trim() : "";
    return ins ? { instructionsSnippet: ins } : {};
  }
  return {};
}

function mergeBoundaryFragments(
  competencies: BaiyingCoreCompetency[] | undefined,
  key: "acceptBoundary" | "rejectBoundary",
  maxFragments: number,
): string[] {
  if (!Array.isArray(competencies) || competencies.length === 0) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of competencies) {
    const arr = c[key];
    if (!Array.isArray(arr)) continue;
    for (const x of arr) {
      const s = String(x).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(truncate(s, MAX_SCOPE_CHARS));
      if (out.length >= maxFragments) return out;
    }
  }
  return out;
}

function collectExampleFragments(competencies: BaiyingCoreCompetency[] | undefined): string[] {
  if (!Array.isArray(competencies) || competencies.length === 0) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of competencies) {
    if (!Array.isArray(c.example)) continue;
    for (const x of c.example) {
      const s = String(x).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(truncate(s, MAX_EXAMPLE_CHARS));
      if (out.length >= MAX_EXAMPLES_INLINE) return out;
    }
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

function oneLineRoleForAgent(
  adapted: AdaptedManagedAgent,
  hints: { resourceDesc?: string; instructionsSnippet?: string },
): string {
  if (hints.resourceDesc?.trim()) {
    return truncate(hints.resourceDesc, MAX_ROLE_LINE);
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

/**
 * Build compact markdown for main-workspace `SUBAGENT_ROUTING.md`.
 * Optimized for intent routing density, not full persona replication.
 */
export async function buildSubagentRoutingMarkdown(managed: AdaptedManagedAgent[]): Promise<string> {
  const managedOnly = managed
    .filter((m) => typeof m.agentId === "string" && m.agentId.startsWith(MANAGED_AGENT_PREFIX))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  const lines: string[] = [
    "# Sub-agent routing (baiying-enhance)",
    "",
    "Dense **hints only**. **Not** an allowlist — call `agents_list` in the same turn before `sessions_spawn`.",
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
    let hints: { resourceDesc?: string; instructionsSnippet?: string } = {};
    if (adapted.sourceFilePath) {
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
    const roleLine = oneLineRoleForAgent(adapted, hints);
    const inFr = mergeBoundaryFragments(adapted.coreCompetencies, "acceptBoundary", MAX_SCOPE_FRAGMENTS);
    const outFr = mergeBoundaryFragments(adapted.coreCompetencies, "rejectBoundary", MAX_SCOPE_FRAGMENTS);
    const exFr = collectExampleFragments(adapted.coreCompetencies);

    const card: string[] = [
      `## ${displayName}`,
      `- \`${adapted.agentId}\` · **${integ}** · **${kind}**`,
      `- **role**: ${roleLine}`,
    ];

    if (inFr.length > 0 || outFr.length > 0) {
      const parts: string[] = [];
      if (inFr.length > 0) parts.push(`in: ${inFr.join(" · ")}`);
      if (outFr.length > 0) parts.push(`out: ${outFr.join(" · ")}`);
      card.push(`- **scope**: ${parts.join(" | ")}`);
    }
    if (exFr.length > 0) {
      card.push(`- **ex**: ${exFr.join(" · ")}`);
    }

    if (!hints.resourceDesc && hints.instructionsSnippet && !adapted.coreCompetencies?.length) {
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
