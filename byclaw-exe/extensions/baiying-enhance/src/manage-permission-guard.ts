import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import type { ManagePermissionStore } from "./manage-permission-store.js";

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

/**
 * Managed-workspace filenames a digital employee's own permission-holder
 * expects to control. Editing any of these without management permission on
 * the owning resource would let any user with mere *use* access silently
 * rewrite the running agent's persona, tools, or identity.
 */
export const PROTECTED_WORKSPACE_FILENAMES: ReadonlySet<string> = new Set([
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
  "IDENTITY.md",
  "BYAI_BUSINESS_EXTENSIONS.md",
]);

/** Matches `.../workspace-baiying-agent-{resourceId}/...` in an edit tool's `path` param. */
const MANAGED_WORKSPACE_SEGMENT_RE = /workspace-baiying-agent-(\d+)(?:[\\/]|$)/;

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** Extract the digital employee resourceId from a `baiying-agent-{id}` agent id. */
export function resourceIdFromAgentId(agentId: string | undefined): string | undefined {
  const trimmed = agentId?.trim() ?? "";
  return trimmed.startsWith(MANAGED_AGENT_PREFIX)
    ? trimmed.slice(MANAGED_AGENT_PREFIX.length) || undefined
    : undefined;
}

/** True when `filePath` points at one of the protected managed-workspace filenames. */
export function isProtectedWorkspaceFile(filePath: string): boolean {
  const trimmed = filePath?.trim() ?? "";
  if (!trimmed || !MANAGED_WORKSPACE_SEGMENT_RE.test(trimmed)) {
    return false;
  }
  return PROTECTED_WORKSPACE_FILENAMES.has(path.basename(trimmed));
}

/** Extract the digital employee resourceId embedded in a managed workspace file path. */
export function extractResourceIdFromPath(filePath: string): string | undefined {
  return filePath?.match(MANAGED_WORKSPACE_SEGMENT_RE)?.[1];
}

async function checkManagePermission(params: {
  toolName: string;
  resourceId: string | undefined;
  store: ManagePermissionStore;
  log: LoggerLike;
}): Promise<{ block: true; blockReason: string } | void> {
  const { toolName } = params;
  const resourceId = normalizeId(params.resourceId);
  if (!resourceId) {
    // Cannot determine which resource is being modified — fail open rather
    // than block an operation we can't attribute.
    params.log.info(
      `baiying-enhance: manage-permission guard[${toolName}] cannot resolve resourceId, failing open (allow)`,
    );
    return;
  }
  try {
    const userId = await params.store.resolveUserId();
    if (!userId) {
      params.log.info(
        `baiying-enhance: manage-permission guard[${toolName}] resourceId=${resourceId} cannot resolve userId (missing USER_CODE or SHARE_BFM_USER_CODE_* key), failing open (allow)`,
      );
      return;
    }
    const [hasPermission, isGlobalManager] = await Promise.all([
      params.store.hasManagePermission(userId, resourceId),
      params.store.isGlobalManager(userId),
    ]);
    if (hasPermission || isGlobalManager) {
      params.log.info(
        `baiying-enhance: manage-permission guard[${toolName}] ALLOW resourceId=${resourceId} userId=${userId} (hasPermission=${hasPermission}, isGlobalManager=${isGlobalManager})`,
      );
      return;
    }
    params.log.info(
      `baiying-enhance: manage-permission guard[${toolName}] BLOCK resourceId=${resourceId} userId=${userId} (no ALLOW_MANAGE grant, not a global manager)`,
    );
    return {
      block: true,
      blockReason: `没有数字员工（ID: ${resourceId}）的管理权限，无法执行此操作`,
    };
  } catch (err) {
    // Redis/userId resolution failure: `before_tool_call` is fail-closed on
    // thrown errors, so an uncaught exception here would block the call.
    // Fail open instead — an unavailable permission store must never be
    // indistinguishable from "denied".
    params.log.warn(
      `baiying-enhance: manage-permission guard[${toolName}] check failed for resourceId=${resourceId}, failing open (allow): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }
}

/**
 * Register a `before_tool_call` hook that blocks two operations on a managed
 * digital employee's live configuration unless the current user has
 * management permission (`USER:RESOURCES:MANAGE:{userId}`):
 *
 * 1. `skill_workshop` with `action=apply` — applies a skill proposal, i.e.
 *    changes the agent's live skill set.
 * 2. `edit` on one of `PROTECTED_WORKSPACE_FILENAMES` inside a managed
 *    agent's workspace — rewrites persona/tools/identity directly.
 *
 * Any other tool call, action, or file is untouched. Redis or userId
 * resolution failures fail open (see `checkManagePermission`).
 */
export function registerManagePermissionGuard(params: {
  api: OpenClawPluginApi;
  store: ManagePermissionStore;
}): void {
  const log: LoggerLike = {
    info: (m) => params.api.logger.info(m),
    warn: (m) => params.api.logger.warn(m),
  };

  params.api.on("before_tool_call", async (event, ctx) => {
    if (event.toolName === "edit") {
      const filePath = normalizeId((event.params as Record<string, unknown> | undefined)?.path);
      if (!filePath || !isProtectedWorkspaceFile(filePath)) {
        return;
      }
      log.info(
        `baiying-enhance: manage-permission guard saw edit call on protected file path=${filePath} agentId=${ctx.agentId ?? "(none)"}`,
      );
      return checkManagePermission({
        toolName: "edit",
        resourceId: extractResourceIdFromPath(filePath) ?? resourceIdFromAgentId(ctx.agentId),
        store: params.store,
        log,
      });
    }
  });

  log.info("baiying-enhance: manage-permission guard registered (edit protected workspace files)");
}
