/**
 * Serializable configuration and defaults for the sidebar host half. Loader
 * schema validation normally fills defaults; {@link resolveSidebarConfig}
 * applies the same defaults for direct callers that bypass the Loader.
 * @module dsh-better-sidebar/config
 */

import z from '@deepseek-ai/schemastery'
import {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TITLE_BAR_STRIP_DEFAULT,
  TITLE_BAR_STRIP_MAX,
  TITLE_BAR_STRIP_MIN,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from './prefs-shared.ts'

export {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TITLE_BAR_STRIP_DEFAULT,
  TITLE_BAR_STRIP_MAX,
  TITLE_BAR_STRIP_MIN,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from './prefs-shared.ts'

/** Tunable sidebar host limits (every field optional; defaults fill in). */
export interface SidebarConfig {
  /** Read cap of one text file (bytes); larger files return truncated. */
  readLimit?: number
  /** Media route cap (bytes); larger binaries are refused. */
  mediaLimit?: number
  /** Upload route cap (bytes); larger files are refused without touching disk. */
  uploadLimit?: number
  /** Explorer row bound of one level. */
  listLimit?: number
  /** Terminals per session. */
  terminalsPerSession?: number
  /** How long a disconnected terminal process survives awaiting a reconnect. */
  reconnectGraceMs?: number
  /**
   * Terminal shell (absolute path or bare executable name) for BOTH the UI
   * terminal tabs and the model-facing `terminal_*` tools. Empty = auto:
   * POSIX follows `$SHELL` then the account login shell; Windows follows
   * `DSH_SIDEBAR_SHELL`, then probes for `pwsh.exe`, then falls back to the
   * inbox `powershell.exe` (5.1). Set it from `cordis.patch.yml` / profile
   * plugin config, e.g. `config: { shell: /bin/zsh }`.
   */
  shell?: string
  /**
   * Optional arguments passed to the shell executable. When non-empty these
   * REPLACE the automatic platform defaults (POSIX `-l` / Windows none), so
   * the deployment has full control over how the shell starts. When omitted
   * the existing default behavior is kept.
   */
  shellArgs?: string[]
  /**
   * The user workspace lives in a separate tool environment (the shared
   * host: `ctx.fs` / `ctx.subprocess` point at the user's tool sandbox), not
   * on this host. When true, the explorer, editor reads/writes, uploads,
   * media/HTML previews and Git run through `ctx.fs` / `ctx.subprocess`, and
   * terminals through `ctx.subprocess.spawnTerminal` without the host
   * process environment. Default false: node-pty, host fs and host git.
   */
  workspaceOnToolEnvironment?: boolean
}

/** Schemastery schema for the ordinary (restart-applied) host settings. */
const HostConfig: z<SidebarConfig> = z.object({
  readLimit: z.number().step(1).min(1).default(512 * 1024),
  mediaLimit: z.number().step(1).min(1).default(20 * 1024 * 1024),
  uploadLimit: z.number().step(1).min(1).default(128 * 1024 * 1024),
  listLimit: z.number().step(1).min(1).default(1000),
  terminalsPerSession: z.number().step(1).min(1).default(3),
  reconnectGraceMs: z.number().step(1).min(0).default(30_000),
  shell: z.string().default(''),
  shellArgs: z.array(z.string()).default([]),
  workspaceOnToolEnvironment: z.boolean().default(false),
})

/** Fully defaulted sidebar host settings. */
export interface ResolvedSidebarConfig {
  readLimit: number
  mediaLimit: number
  uploadLimit: number
  listLimit: number
  terminalsPerSession: number
  reconnectGraceMs: number
  /** The configured terminal shell; empty means the host auto-resolves it. */
  shell: string
  /** Explicit shell arguments; empty means use the platform defaults. */
  shellArgs: string[]
  /** Workspace operations run in the tool environment (`ctx.fs` / `ctx.subprocess`). */
  workspaceOnToolEnvironment: boolean
}

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 *
 * @param config - Deployment-provided sidebar host settings.
 * @returns Complete settings consumed by the host half.
 */
export function resolveSidebarConfig(config: SidebarConfig | undefined): ResolvedSidebarConfig {
  return {
    readLimit: config?.readLimit ?? 512 * 1024,
    mediaLimit: config?.mediaLimit ?? 20 * 1024 * 1024,
    uploadLimit: config?.uploadLimit ?? 128 * 1024 * 1024,
    listLimit: config?.listLimit ?? 1000,
    terminalsPerSession: config?.terminalsPerSession ?? 3,
    reconnectGraceMs: config?.reconnectGraceMs ?? 30_000,
    shell: config?.shell?.trim() ?? '',
    shellArgs: config?.shellArgs ?? [],
    workspaceOnToolEnvironment: config?.workspaceOnToolEnvironment ?? false,
  }
}

// ── User-facing "Side card" preferences ─────────────────────────────────────

/** Schemastery schema for the user-facing preferences (validated by the settings service). */
export const PrefsSchema: z<SidebarPrefs> = z.object({
  openByDefault: z.boolean().default(false),
  defaultWidthPercent: z.number().step(1).min(WIDTH_PERCENT_MIN).max(WIDTH_PERCENT_MAX).default(WIDTH_PERCENT_DEFAULT),
  autoOpenSubagent: z.boolean().default(true),
  autoOpenJobs: z.boolean().default(true),
  agentTerminalTools: z.boolean().default(false),
  agentOpenTools: z.boolean().default(false),
  bottomPanelAutoTerminal: z.boolean().default(true),
  terminalFontFamily: z.string().default(''),
  terminalFontSize: z.number().step(1).min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX).default(TERMINAL_FONT_SIZE_DEFAULT),
  interceptOpenPath: z.boolean().default(true),
  editorExplorer: z.boolean().default(false),
  terminalShell: z.string().default(''),
  terminalShellArgs: z.string().default(''),
  titleBarScheme: z.union([z.const('auto'), z.const('web'), z.const('preset'), z.const('custom')]),
  titleBarPresetId: z.string(),
  customCss: z.string(),
  titleBarCompat: z.boolean().default(false),
  titleBarStripPx: z.number().step(1).min(TITLE_BAR_STRIP_MIN).max(TITLE_BAR_STRIP_MAX).default(TITLE_BAR_STRIP_DEFAULT),
  htmlViewerNoSandbox: z.boolean().default(false),
  htmlViewerDefaultUnsafe: z.boolean().default(false),
  browserNoSandbox: z.boolean().default(false),
  browserInterceptLinks: z.boolean().default(true),
  browserInterceptHttp: z.boolean().default(true),
  browserInterceptHttps: z.boolean().default(false),
  browserAllowedLoopback: z.string().default(''),
  // Per-feature enable switches are OPEN maps (any tab/viewer id, built-in or
  // external): an absent key means enabled, so old documents resolve to {}
  // (everything on) with no migration. Non-boolean values fail validation.
  tabsEnabled: z.dict(z.boolean()).default({}),
  viewersEnabled: z.dict(z.boolean()).default({}),
  // Plugin-owned settings blobs (v0.12.0+) are an OPEN nested map: any
  // descriptor id may carry any JSON-serializable values. This is the
  // "settings seam" opening — without it the seam would drop third-party
  // keys as unknown schema fields.
  pluginSettings: z.dict(z.dict(z.any())).default({}),
})

/**
 * One side card preference as the Loader hands it to `apply`: a live config
 * reference (DSH 0.2.1 volatile field) whose `.get()` reads the committed
 * value, or a plain value from a direct caller.
 */
export type SidebarPrefsConfig = { [K in keyof SidebarPrefs]?: { get(): SidebarPrefs[K] } | SidebarPrefs[K] }

/**
 * Schemastery schema for the plugin row configuration: the ordinary host
 * settings plus every side card preference as a top-level `.volatile()`
 * field. DSH 0.2.1 removed `settings.register(ns, schema)`; the settings
 * service now edits a plugin's volatile Config fields (keyed by its profile
 * entry id) and the Loader commits edits into the running references
 * without a remount. Declaring the preferences here keeps the 0.1.5
 * behavior: the same fields, defaults, live application and revisioned
 * writes through `ctx.settings`.
 */
export const Config: z<SidebarConfig & SidebarPrefsConfig> = z.object({
  ...HostConfig.dict,
  ...Object.fromEntries(Object.entries(PrefsSchema.dict ?? {}).map(([key, field]) => [key, field.volatile()])),
}) as unknown as z<SidebarConfig & SidebarPrefsConfig>

/**
 * Read the current side card preferences from the row config: volatile
 * references resolve through `.get()`, plain values pass through, and absent
 * fields keep the preference defaults (direct callers that bypass the
 * Loader).
 *
 * @param config - The config `apply` received.
 * @returns The current preferences.
 */
export function readSidebarPrefs(config: (SidebarConfig & SidebarPrefsConfig) | undefined): SidebarPrefs {
  const record = (config ?? {}) as Record<string, unknown>
  const prefs: Record<string, unknown> = { ...SIDEBAR_PREFS_DEFAULTS }
  for (const key of Object.keys(PrefsSchema.dict ?? {})) {
    const field = record[key]
    const value = field !== null && typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function'
      ? (field as { get(): unknown }).get()
      : field
    if (value !== undefined) prefs[key] = value
  }
  return prefs as unknown as SidebarPrefs
}
