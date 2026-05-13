import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_AGENT_ID = "main";
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

function normalizeAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_AGENT_ID;
  }
  if (VALID_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return (
    trimmed
      .toLowerCase()
      .replace(INVALID_CHARS_RE, "-")
      .replace(LEADING_DASH_RE, "")
      .replace(TRAILING_DASH_RE, "")
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

/** Minimal resolveStateDir that covers common cases without importing internal modules. */
function resolveStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) {
    return override.startsWith("~")
      ? path.join(homedir(), override.slice(1))
      : override;
  }
  const newDir = path.join(homedir(), ".openclaw");
  if (existsSync(newDir)) {
    return newDir;
  }
  // Legacy fallback
  const legacyDir = path.join(homedir(), ".clawdbot");
  if (existsSync(legacyDir)) {
    return legacyDir;
  }
  return newDir;
}

/**
 * Default per-agent workspace under the OpenClaw state dir (typically ~/.openclaw):
 * - Parent agent id `main`: `<stateDir>/workspace/` (OpenClaw default layout, not `workspace-main`).
 * - Any other id: `<stateDir>/workspace-<agentId>/`
 *
 * Matches `resolveAgentWorkspaceDir` when no per-agent override exists in config.
 */
export function resolveDefaultManagedWorkspacePath(agentId: string): string {
  const stateDir = resolveStateDir();
  const id = normalizeAgentId(agentId);
  if (id === DEFAULT_AGENT_ID) {
    return path.join(stateDir, "workspace");
  }
  return path.join(stateDir, `workspace-${id}`);
}
