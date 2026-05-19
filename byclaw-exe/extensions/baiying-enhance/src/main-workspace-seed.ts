import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { BUILTIN_MAIN_AGENTS_MD } from "./built-in-main-agents-md.js";
import {
  isMainAgentsForeignTakeoverDone,
  markMainAgentsForeignTakeoverDone,
} from "./main-agents-foreign-takeover.js";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";
import { SUBAGENT_ROUTING_FILENAME, buildSubagentRoutingMarkdown, SUBAGENT_ROUTING_MARKER } from "./subagent-routing-seed.js";
import { buildBootstrapMd, resolveAgentWorkspaceDir } from "./workspace-seed.js";

export const MAIN_AGENTS_MARKER = "<!-- baiying-enhance: main agents template -->";

const AGENTS_FILENAME = "AGENTS.md";
const BOOTSTRAP_FILENAME = "BOOTSTRAP.md";

async function seedMainWorkspaceBootstrap(params: {
  workspaceDir: string;
  log: { info?: (m: string) => void };
}): Promise<void> {
  const bootstrapPath = path.join(params.workspaceDir, BOOTSTRAP_FILENAME);
  await fs.writeFile(bootstrapPath, buildBootstrapMd(), "utf8");
  params.log.info?.(`baiying-enhance: wrote main ${BOOTSTRAP_FILENAME} (managed no-op): ${bootstrapPath}`);
}

async function writeSubagentRoutingWithPolicy(params: {
  workspaceDir: string;
  mode: "if_missing" | "if_managed_marker" | "always";
  managedAgents: AdaptedManagedAgent[];
  log: { warn: (m: string) => void; info?: (m: string) => void };
}): Promise<void> {
  const routingDest = path.join(params.workspaceDir, SUBAGENT_ROUTING_FILENAME);
  let existing = "";
  let destStat: { size: number } | null = null;
  try {
    destStat = await fs.stat(routingDest);
    existing = await fs.readFile(routingDest, "utf8");
  } catch {
    destStat = null;
    existing = "";
  }
  const filePresent = destStat !== null;
  const hasMarker = existing.replace(/^\uFEFF/, "").startsWith(SUBAGENT_ROUTING_MARKER);

  const writeContent = async () => {
    const md = await buildSubagentRoutingMarkdown(params.managedAgents);
    await fs.writeFile(routingDest, md, "utf8");
    params.log.info?.(`baiying-enhance: wrote main ${SUBAGENT_ROUTING_FILENAME}: ${routingDest}`);
  };

  if (params.mode === "if_missing") {
    if (filePresent && destStat && destStat.size > 0) {
      params.log.info?.(
        `baiying-enhance: main ${SUBAGENT_ROUTING_FILENAME} skip (if_missing, file exists): ${routingDest}`,
      );
      return;
    }
    await writeContent();
    return;
  }

  if (params.mode === "if_managed_marker") {
    if (!filePresent || destStat?.size === 0 || existing.length === 0) {
      await writeContent();
      return;
    }
    if (hasMarker) {
      await writeContent();
      return;
    }
    params.log.warn(
      `baiying-enhance: main ${SUBAGENT_ROUTING_FILENAME} not updated — file exists without plugin marker: ${routingDest}`,
    );
    return;
  }

  await writeContent();
}

function resolveOpenclawStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || path.join(homedir(), ".openclaw");
}

function resolvePluginPath(raw: string): string {
  if (path.isAbsolute(raw)) {
    return raw;
  }
  if (raw.startsWith("~")) {
    return path.join(homedir(), raw.slice(1));
  }
  const stateDir = resolveOpenclawStateDir();
  return path.join(stateDir, raw);
}

function ensureMainAgentsMarkerPrefix(body: string): string {
  const t = body.replace(/^\uFEFF/, "");
  if (t.startsWith(MAIN_AGENTS_MARKER)) {
    return t.endsWith("\n") ? t : `${t}\n`;
  }
  return `${MAIN_AGENTS_MARKER}\n\n${t}`;
}

/** When false, do not use the built-in template bundled in `dist/index.js`. */
export function hasBuiltinMainAgentsTemplateSource(cfg: BaiyingEnhancePluginConfig): boolean {
  return cfg.useBundledMainAgentsMd !== false;
}

export function resolveEffectiveMainAgentsMdMode(cfg: BaiyingEnhancePluginConfig): "off" | "if_missing" | "if_managed_marker" | "always" {
  const explicit = cfg.mainAgentsMdMode;
  if (explicit === "off" || explicit === "if_missing" || explicit === "if_managed_marker" || explicit === "always") {
    return explicit;
  }
  const hasPath = Boolean(cfg.mainAgentsMdPath?.trim());
  const allowBuiltin = hasBuiltinMainAgentsTemplateSource(cfg);
  if (!hasPath && !allowBuiltin) {
    return "off";
  }
  return "always";
}

async function readTemplateFile(templatePath: string): Promise<string | null> {
  try {
    return await fs.readFile(templatePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolved filesystem path for a **custom** template (`mainAgentsMdPath` only).
 * Built-in copy is embedded in the bundle and has no path.
 */
export async function resolveMainAgentsTemplatePath(cfg: BaiyingEnhancePluginConfig): Promise<string | null> {
  const rawPath = cfg.mainAgentsMdPath?.trim();
  if (!rawPath) {
    return null;
  }
  return resolvePluginPath(rawPath);
}

export type MainAgentsTemplateLoad =
  | { kind: "file"; path: string; body: string }
  | { kind: "bundled"; body: string };

export async function loadMainAgentsTemplate(cfg: BaiyingEnhancePluginConfig): Promise<MainAgentsTemplateLoad | null> {
  const rawPath = cfg.mainAgentsMdPath?.trim();
  if (rawPath) {
    const p = resolvePluginPath(rawPath);
    const body = await readTemplateFile(p);
    if (body === null) {
      return null;
    }
    return { kind: "file", path: p, body };
  }
  if (!hasBuiltinMainAgentsTemplateSource(cfg)) {
    return null;
  }
  if (!BUILTIN_MAIN_AGENTS_MD || BUILTIN_MAIN_AGENTS_MD.trim().length === 0) {
    return null;
  }
  return { kind: "bundled", body: BUILTIN_MAIN_AGENTS_MD };
}

/**
 * Install or update `AGENTS.md` in the main (parent) agent workspace from a configured template.
 */
export async function seedMainAgentAgentsMd(params: {
  api: OpenClawPluginApi;
  pluginConfig: BaiyingEnhancePluginConfig;
  log: { warn: (m: string) => void; info?: (m: string) => void };
  /** Current managed baiying agents; used to generate `SUBAGENT_ROUTING.md`. */
  managedAgents?: AdaptedManagedAgent[];
}): Promise<void> {
  const mainId = params.pluginConfig.mainParentAgentId?.trim() || "main";
  const workspaceDir = resolveAgentWorkspaceDir(params.api, mainId);
  await fs.mkdir(workspaceDir, { recursive: true });
  await seedMainWorkspaceBootstrap({ workspaceDir, log: params.log });

  const mode = resolveEffectiveMainAgentsMdMode(params.pluginConfig);
  if (mode === "off") {
    params.log.info?.("baiying-enhance: main AGENTS.md seed skipped (mainAgentsMdMode=off)");
    return;
  }

  const loaded = await loadMainAgentsTemplate(params.pluginConfig);
  const templateLabel = loaded?.kind === "file" ? loaded.path : "(bundled in dist/index.js)";
  params.log.info?.(
    `baiying-enhance: main AGENTS.md seed: mode=${mode} agentId=${mainId} template=${templateLabel}`,
  );
  if (!loaded) {
    const p = params.pluginConfig.mainAgentsMdPath?.trim();
    if (p) {
      params.log.warn(`baiying-enhance: main AGENTS.md template not readable: ${resolvePluginPath(p)}`);
    } else {
      params.log.warn(
        "baiying-enhance: main AGENTS.md built-in template is empty (rebuild extension with templates/main-agents.md present).",
      );
    }
    return;
  }

  const managedAgents = params.managedAgents ?? [];

  const rawTemplate = loaded.body;
  const content = ensureMainAgentsMarkerPrefix(rawTemplate);
  params.log.info?.(`baiying-enhance: main workspace dir resolved: ${workspaceDir}`);
  const dest = path.join(workspaceDir, AGENTS_FILENAME);

  let existing = "";
  let destStat: { size: number } | null = null;
  try {
    destStat = await fs.stat(dest);
    existing = await fs.readFile(dest, "utf8");
  } catch {
    destStat = null;
    existing = "";
  }

  const filePresent = destStat !== null;
  const hasMarker = existing.replace(/^\uFEFF/, "").startsWith(MAIN_AGENTS_MARKER);

  if (mode === "if_missing") {
    if (filePresent && destStat && destStat.size > 0) {
      params.log.info?.(`baiying-enhance: main ${AGENTS_FILENAME} skip (if_missing, file exists): ${dest}`);
      // Still seed `SUBAGENT_ROUTING.md` under the same policy (e.g. AGENTS.md pre-exists from OpenClaw
      // stock while routing is missing — register-time init must not skip routing only).
      await writeSubagentRoutingWithPolicy({
        workspaceDir,
        mode,
        managedAgents,
        log: params.log,
      });
      return;
    }
    await fs.writeFile(dest, content, "utf8");
    params.log.info?.(`baiying-enhance: wrote main ${AGENTS_FILENAME} (if_missing): ${dest}`);
    await writeSubagentRoutingWithPolicy({
      workspaceDir,
      mode,
      managedAgents,
      log: params.log,
    });
    return;
  }

  if (mode === "if_managed_marker") {
    if (!filePresent || destStat?.size === 0 || existing.length === 0) {
      await fs.writeFile(dest, content, "utf8");
      params.log.info?.(`baiying-enhance: wrote main ${AGENTS_FILENAME} (if_managed_marker, new): ${dest}`);
      await writeSubagentRoutingWithPolicy({
        workspaceDir,
        mode,
        managedAgents,
        log: params.log,
      });
      return;
    }
    if (hasMarker) {
      await fs.writeFile(dest, content, "utf8");
      params.log.info?.(`baiying-enhance: updated main ${AGENTS_FILENAME} (if_managed_marker): ${dest}`);
      await writeSubagentRoutingWithPolicy({
        workspaceDir,
        mode,
        managedAgents,
        log: params.log,
      });
      return;
    }
    const takeover = params.pluginConfig.mainAgentsMdForeignTakeover !== false;
    if (takeover) {
      const stateDir = resolveOpenclawStateDir();
      const already = await isMainAgentsForeignTakeoverDone(stateDir, workspaceDir);
      if (!already) {
        await fs.writeFile(dest, content, "utf8");
        await markMainAgentsForeignTakeoverDone(stateDir, workspaceDir);
        params.log.info?.(
          `baiying-enhance: replaced existing main ${AGENTS_FILENAME} once (foreign takeover; OpenClaw default had no plugin marker): ${dest}`,
        );
        await writeSubagentRoutingWithPolicy({
          workspaceDir,
          mode,
          managedAgents,
          log: params.log,
        });
        return;
      }
    }
    params.log.warn(
      `baiying-enhance: main ${AGENTS_FILENAME} not updated — file exists without plugin marker: ${dest}. ` +
        (takeover
          ? "Foreign takeover already recorded for this workspace; delete AGENTS.md, set mainAgentsMdMode to \"always\", or remove this path from baiying-enhance/main-agents-foreign-takeover.json under OPENCLAW_STATE_DIR."
          : "Enable mainAgentsMdForeignTakeover (default true) for one-time replace of OpenClaw stock files, or set mainAgentsMdMode to \"always\"."),
    );
    await writeSubagentRoutingWithPolicy({
      workspaceDir,
      mode,
      managedAgents,
      log: params.log,
    });
    return;
  }

  if (mode === "always") {
    await fs.writeFile(dest, content, "utf8");
    params.log.info?.(`baiying-enhance: wrote main ${AGENTS_FILENAME} (always): ${dest}`);
    await writeSubagentRoutingWithPolicy({
      workspaceDir,
      mode,
      managedAgents,
      log: params.log,
    });
  }
}
