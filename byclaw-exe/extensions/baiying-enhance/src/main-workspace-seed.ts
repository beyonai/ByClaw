import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { loadBuiltinMainAgentsMd } from "./built-in-main-agents-md.js";
import {
  isMainAgentsForeignTakeoverDone,
  markMainAgentsForeignTakeoverDone,
} from "./main-agents-foreign-takeover.js";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";
import { SUBAGENT_ROUTING_FILENAME, buildSubagentRoutingMarkdown, SUBAGENT_ROUTING_MARKER } from "./subagent-routing-seed.js";
import { resolveAgentWorkspaceDir } from "./workspace-seed.js";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import {
  loadMainWorkspaceContextTemplate,
  resolveMainContextTemplateParamCode,
  type MainWorkspaceContextFileName,
  type MainWorkspaceContextTemplate,
  type MainWorkspaceContextWritePolicy,
} from "./main-context-template.js";

export const MAIN_AGENTS_MARKER = "<!-- baiying-enhance: main agents template -->";
export const MAIN_CONTEXT_MARKER = "<!-- baiying-enhance: main context template -->";

const AGENTS_FILENAME = "AGENTS.md";
const BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
const MAIN_CONTEXT_FILENAMES = ["SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md"] as const;
const MAIN_CONTEXT_APPEND_FILENAMES = new Set<MainWorkspaceContextFileName>([
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
]);

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

function ensureMarkerPrefix(marker: string, body: string): string {
  const t = body.replace(/^\uFEFF/, "");
  if (t.startsWith(marker)) {
    return t.endsWith("\n") ? t : `${t}\n`;
  }
  return `${marker}\n\n${t}`;
}

function ensureMainAgentsMarkerPrefix(body: string): string {
  return ensureMarkerPrefix(MAIN_AGENTS_MARKER, body);
}

function hasMarker(content: string, marker: string): boolean {
  return content.replace(/^\uFEFF/, "").startsWith(marker);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readExistingFile(filePath: string): Promise<{
  filePresent: boolean;
  size: number;
  content: string;
}> {
  try {
    const stat = await fs.stat(filePath);
    return {
      filePresent: true,
      size: stat.size,
      content: await fs.readFile(filePath, "utf8"),
    };
  } catch {
    return { filePresent: false, size: 0, content: "" };
  }
}

async function writeMainContextFileWithPolicy(params: {
  workspaceDir: string;
  filename: string;
  content: string;
  mode: MainWorkspaceContextWritePolicy;
  log: { warn: (m: string) => void; info?: (m: string) => void };
}): Promise<void> {
  if (params.mode === "off") {
    return;
  }
  const dest = path.join(params.workspaceDir, params.filename);
  const existing = await readExistingFile(dest);
  const writeContent = async (reason: string) => {
    await fs.writeFile(dest, params.content, "utf8");
    params.log.info?.(`baiying-enhance: wrote main ${params.filename} (${reason}): ${dest}`);
  };

  if (params.mode === "if_missing") {
    if (existing.filePresent && existing.size > 0) {
      params.log.info?.(`baiying-enhance: main ${params.filename} skip (if_missing, file exists): ${dest}`);
      return;
    }
    await writeContent("if_missing");
    return;
  }

  if (params.mode === "if_managed_marker") {
    if (!existing.filePresent || existing.size === 0 || existing.content.length === 0) {
      await writeContent("if_managed_marker, new");
      return;
    }
    if (hasMarker(existing.content, MAIN_CONTEXT_MARKER)) {
      await writeContent("if_managed_marker");
      return;
    }
    params.log.warn(
      `baiying-enhance: main ${params.filename} not updated — file exists without main context marker: ${dest}`,
    );
    return;
  }

  await writeContent("always");
}

function mainContextBlockMarkers(filename: string): { start: string; end: string } {
  return {
    start: `<!-- baiying-enhance: main context ${filename}:start -->`,
    end: `<!-- baiying-enhance: main context ${filename}:end -->`,
  };
}

function upsertMainContextBlock(params: {
  existing: string;
  filename: string;
  content: string;
}): string {
  const { start, end } = mainContextBlockMarkers(params.filename);
  const block = `${start}\n\n${params.content.trim()}\n\n${end}`;
  const startIndex = params.existing.indexOf(start);
  if (startIndex >= 0) {
    const endIndex = params.existing.indexOf(end, startIndex + start.length);
    if (endIndex >= 0) {
      const before = params.existing.slice(0, startIndex).replace(/\s+$/, "");
      const after = params.existing.slice(endIndex + end.length).replace(/^\s+/, "");
      return `${before ? `${before}\n\n` : ""}${block}${after ? `\n\n${after}` : ""}\n`;
    }
  }
  const base = params.existing.replace(/\s+$/, "");
  return `${base ? `${base}\n\n` : ""}${block}\n`;
}

async function appendMainContextFileBlock(params: {
  workspaceDir: string;
  filename: string;
  content: string;
  mode: MainWorkspaceContextWritePolicy;
  log: { warn: (m: string) => void; info?: (m: string) => void };
}): Promise<void> {
  if (params.mode === "off") {
    return;
  }
  const bootstrapPath = path.join(params.workspaceDir, BOOTSTRAP_FILENAME);
  if (await pathExists(bootstrapPath)) {
    params.log.info?.(
      `baiying-enhance: main ${params.filename} append skipped (bootstrap still present): ${bootstrapPath}`,
    );
    return;
  }
  const dest = path.join(params.workspaceDir, params.filename);
  const existing = await readExistingFile(dest);
  if (!existing.filePresent || existing.size === 0 || existing.content.length === 0) {
    params.log.info?.(
      `baiying-enhance: main ${params.filename} append skipped (waiting for OpenClaw bootstrap output): ${dest}`,
    );
    return;
  }
  // 追加策略只维护插件自己的托管块，避免覆盖 OpenClaw 原生生成内容或用户手写内容。
  const next = upsertMainContextBlock({
    existing: existing.content,
    filename: params.filename,
    content: params.content,
  });
  if (next === existing.content) {
    params.log.info?.(`baiying-enhance: main ${params.filename} append block unchanged: ${dest}`);
    return;
  }
  await fs.writeFile(dest, next, "utf8");
  params.log.info?.(`baiying-enhance: updated main ${params.filename} append block: ${dest}`);
}

function resolveMainContextMergeStrategy(params: {
  filename: MainWorkspaceContextFileName;
  configured?: "append" | "replace";
}): "append" | "replace" {
  if (!MAIN_CONTEXT_APPEND_FILENAMES.has(params.filename)) {
    return "replace";
  }
  return params.configured ?? "append";
}

async function writeMainContextFilesWithPolicy(params: {
  workspaceDir: string;
  template: MainWorkspaceContextTemplate | null;
  mode: MainWorkspaceContextWritePolicy;
  log: { warn: (m: string) => void; info?: (m: string) => void };
}): Promise<void> {
  if (!params.template || params.mode === "off") {
    return;
  }
  for (const filename of MAIN_CONTEXT_FILENAMES) {
    const fileConfig = params.template.files[filename];
    const prompt = fileConfig?.priorityPrompt?.trim();
    if (!prompt) {
      continue;
    }
    // 只处理主 workspace 的上下文文件；AGENTS.md 仍走原有 main AGENTS 逻辑，便于保留旧模板回退。
    const mergeStrategy = resolveMainContextMergeStrategy({
      filename,
      configured: fileConfig?.mergeStrategy,
    });
    if (mergeStrategy === "append") {
      await appendMainContextFileBlock({
        workspaceDir: params.workspaceDir,
        filename,
        content: prompt,
        mode: params.mode,
        log: params.log,
      });
      continue;
    }
    await writeMainContextFileWithPolicy({
      workspaceDir: params.workspaceDir,
      filename,
      content: ensureMarkerPrefix(MAIN_CONTEXT_MARKER, prompt),
      mode: params.mode,
      log: params.log,
    });
  }
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

function resolveMainContextFallbackWritePolicy(cfg: BaiyingEnhancePluginConfig): MainWorkspaceContextWritePolicy {
  const explicit = cfg.mainAgentsMdMode;
  if (explicit === "off" || explicit === "if_missing" || explicit === "if_managed_marker" || explicit === "always") {
    return explicit;
  }
  // Redis context 本身就是模板来源；如果旧 AGENTS.md 模板源不存在，不应把主 context 也推导成 off。
  return "always";
}

function hasMainContextFilePrompts(template: MainWorkspaceContextTemplate | null): boolean {
  return Boolean(template && Object.keys(template.files).length > 0);
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
  const BUILTIN_MAIN_AGENTS_MD = await loadBuiltinMainAgentsMd();
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
  /** Optional Redis-backed system config store for main workspace context templates. */
  redisJsonStore?: BaiyingRedisJsonStore;
}): Promise<void> {
  const mainId = params.pluginConfig.mainParentAgentId?.trim() || "main";
  const workspaceDir = resolveAgentWorkspaceDir(params.api, mainId);
  await fs.mkdir(workspaceDir, { recursive: true });
  const managedAgents = params.managedAgents ?? [];

  const mode = resolveEffectiveMainAgentsMdMode(params.pluginConfig);
  const contextTemplate = await loadMainWorkspaceContextTemplate({
    redisJsonStore: params.redisJsonStore,
    redisKey: params.pluginConfig.mainContextTemplateRedisKey,
    paramCode: params.pluginConfig.mainContextTemplateParamCode,
    log: params.log,
  });
  const contextMode = contextTemplate?.writePolicy ?? resolveMainContextFallbackWritePolicy(params.pluginConfig);
  const contextAgentsPrompt =
    contextMode !== "off" ? contextTemplate?.files[AGENTS_FILENAME]?.priorityPrompt?.trim() : "";
  const hasContextPrompts = contextMode !== "off" && hasMainContextFilePrompts(contextTemplate);
  const writeContextFiles = () =>
    writeMainContextFilesWithPolicy({
      workspaceDir,
      template: contextTemplate,
      mode: contextMode,
      log: params.log,
    });
  const writeSubagentRouting = (routingMode: "if_missing" | "if_managed_marker" | "always") =>
    writeSubagentRoutingWithPolicy({
      workspaceDir,
      mode: routingMode,
      managedAgents,
      log: params.log,
    });

  if (mode === "off" && !contextAgentsPrompt) {
    if (hasContextPrompts) {
      params.log.info?.(
        `baiying-enhance: main context seed only: mode=${contextMode} agentId=${mainId} template=redis:${resolveMainContextTemplateParamCode(params.pluginConfig.mainContextTemplateParamCode)}`,
      );
      await writeContextFiles();
      return;
    }
    params.log.info?.("baiying-enhance: main workspace seed skipped (mainAgentsMdMode=off and no Redis context template)");
    return;
  }

  const loaded = contextAgentsPrompt ? null : await loadMainAgentsTemplate(params.pluginConfig);
  const templateLabel = contextAgentsPrompt
    ? `redis:${resolveMainContextTemplateParamCode(params.pluginConfig.mainContextTemplateParamCode)}`
    : loaded?.kind === "file"
      ? loaded.path
      : "(bundled in dist/index.js)";
  params.log.info?.(
    `baiying-enhance: main AGENTS.md seed: mode=${contextAgentsPrompt ? contextMode : mode} agentId=${mainId} template=${templateLabel}`,
  );
  if (!contextAgentsPrompt && !loaded) {
    const p = params.pluginConfig.mainAgentsMdPath?.trim();
    if (p) {
      params.log.warn(`baiying-enhance: main AGENTS.md template not readable: ${resolvePluginPath(p)}`);
    } else {
      params.log.warn(
        "baiying-enhance: main AGENTS.md built-in template is empty (rebuild extension with templates/main-agents.md present).",
      );
    }
    await writeContextFiles();
    return;
  }

  const rawTemplate = contextAgentsPrompt || loaded!.body;
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

  const agentsMode = contextAgentsPrompt ? contextMode : mode;

  if (agentsMode === "if_missing") {
    if (filePresent && destStat && destStat.size > 0) {
      params.log.info?.(`baiying-enhance: main ${AGENTS_FILENAME} skip (if_missing, file exists): ${dest}`);
      await writeContextFiles();
      // Still seed `SUBAGENT_ROUTING.md` under the same policy (e.g. AGENTS.md pre-exists from OpenClaw
      // stock while routing is missing — register-time init must not skip routing only).
      await writeSubagentRouting(agentsMode);
      return;
    }
    await fs.writeFile(dest, content, "utf8");
    params.log.info?.(`baiying-enhance: wrote main ${AGENTS_FILENAME} (if_missing): ${dest}`);
    await writeContextFiles();
    await writeSubagentRouting(agentsMode);
    return;
  }

  if (agentsMode === "if_managed_marker") {
    if (!filePresent || destStat?.size === 0 || existing.length === 0) {
      await fs.writeFile(dest, content, "utf8");
      params.log.info?.(`baiying-enhance: wrote main ${AGENTS_FILENAME} (if_managed_marker, new): ${dest}`);
      await writeContextFiles();
      await writeSubagentRouting(agentsMode);
      return;
    }
    if (hasMarker) {
      await fs.writeFile(dest, content, "utf8");
      params.log.info?.(`baiying-enhance: updated main ${AGENTS_FILENAME} (if_managed_marker): ${dest}`);
      await writeContextFiles();
      await writeSubagentRouting(agentsMode);
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
        await writeContextFiles();
        await writeSubagentRouting(agentsMode);
        return;
      }
    }
    params.log.warn(
      `baiying-enhance: main ${AGENTS_FILENAME} not updated — file exists without plugin marker: ${dest}. ` +
        (takeover
          ? "Foreign takeover already recorded for this workspace; delete AGENTS.md, set mainAgentsMdMode to \"always\", or remove this path from baiying-enhance/main-agents-foreign-takeover.json under OPENCLAW_STATE_DIR."
          : "Enable mainAgentsMdForeignTakeover (default true) for one-time replace of OpenClaw stock files, or set mainAgentsMdMode to \"always\"."),
    );
    await writeContextFiles();
    await writeSubagentRouting(agentsMode);
    return;
  }

  if (agentsMode === "always") {
    await fs.writeFile(dest, content, "utf8");
    params.log.info?.(`baiying-enhance: wrote main ${AGENTS_FILENAME} (always): ${dest}`);
    await writeContextFiles();
    await writeSubagentRouting(agentsMode);
  }
}

export async function seedMainSubagentRouting(params: {
  api: OpenClawPluginApi;
  pluginConfig: BaiyingEnhancePluginConfig;
  log: { warn: (m: string) => void; info?: (m: string) => void };
  managedAgents?: AdaptedManagedAgent[];
}): Promise<void> {
  const mainId = params.pluginConfig.mainParentAgentId?.trim() || "main";
  const workspaceDir = resolveAgentWorkspaceDir(params.api, mainId);
  await fs.mkdir(workspaceDir, { recursive: true });
  const mode = resolveEffectiveMainAgentsMdMode(params.pluginConfig);
  await writeSubagentRoutingWithPolicy({
    workspaceDir,
    mode: mode === "off" ? "if_managed_marker" : mode,
    managedAgents: params.managedAgents ?? [],
    log: params.log,
  });
}
