import path from "node:path";
import type { Dict, ExecutorResponse } from "./types.js";
import { isRecord } from "./types.js";
import { makeError } from "./errors.js";
import { loadAuthContext, resolveAuthFilePath } from "./auth.js";
import {
  extractOpenclawMcpForwardHeaders,
  getResourceContext,
} from "./capability-builder.js";
import { logChannelDebug, type BaiyingEnhanceLogger } from "./debug-channel.js";
import { resolveCapability } from "./capability-resolver.js";
import { describeResource } from "./describe.js";
import { normalizeResourceType } from "./resource-type.js";
import { extractBackendParameters } from "./schema.js";
import { executeAgent } from "./resource-types/agent.js";
import { executeDoc } from "./resource-types/doc.js";
import { executeMcp } from "./resource-types/mcp.js";
import { executeTool } from "./resource-types/tool.js";
import { executeToolkit } from "./resource-types/toolkit.js";
import type { DocDeltaCallback } from "./doc-shared.js";

export type BaiyingExecutorOptions = {
  /** Absolute path to the `skills/baiying/resources` directory. */
  resourcesDir: string;
  /**
   * Optional auth file path. Defaults to `~/.openclaw/workspace/baiying-session.json`
   * (mirrors the original Python default).
   */
  authFilePath?: string;
  /** Optional explicit session id; overrides the one from the auth file. */
  session?: string;
};

/**
 * In-process Baiying executor.
 *
 * Resource snapshot files (`<resourcesDir>/<folder>/<PREFIX>_<id>.json`) are
 * read from disk for each `describe` / `execute` call (`resolveCapability` tries
 * the snapshot before in-memory `resource_context` stubs). There is no in-memory
 * index of snapshots.
 *
 * Auth context (`~/.openclaw/workspace/baiying-session.json`) is still cached
 * because it contains session cookies that are stable within a plugin process
 * lifetime; use `resetAuthContext()` if you need to force a reload.
 */
export class BaiyingExecutor {
  private readonly resourcesDir: string;
  private readonly authFilePath: string;
  private session: string;
  private authContextPromise: ReturnType<typeof loadAuthContext> | null = null;

  constructor(options: BaiyingExecutorOptions) {
    this.resourcesDir = path.resolve(options.resourcesDir);
    this.authFilePath = resolveAuthFilePath(options.authFilePath);
    this.session =
      options.session?.trim() ||
      process.env.BAIYING_SESSION?.trim() ||
      "dd5e77e0-5c06-480b-9705-3c4622e68d35";
  }

  private async getAuthContext() {
    if (!this.authContextPromise) {
      this.authContextPromise = loadAuthContext(this.authFilePath).then((ctx) => {
        if (ctx.session) {
          this.session = ctx.session;
        }
        return ctx;
      });
    }
    return this.authContextPromise;
  }

  /** Force a reload of `baiying-session.json` on the next call. */
  resetAuthContext(): void {
    this.authContextPromise = null;
  }

  /** Mirror of `describe_resource`. */
  async describe(params: {
    capabilityId: string;
    resourceType?: string;
    payload?: Dict;
    logger?: BaiyingEnhanceLogger;
  }): Promise<ExecutorResponse> {
    const resourceContext = getResourceContext(params.payload ?? {});
    logChannelDebug(`describe(${params.capabilityId})`, { resourceContext, logger: params.logger });
    const authContext = await this.getAuthContext();
    const { capability, resolvedType } = await resolveCapability({
      resourcesDir: this.resourcesDir,
      capabilityId: params.capabilityId,
      resourceType: params.resourceType,
      resourceContext,
      authContext,
      session: this.session,
    });
    return describeResource({
      capability,
      resolvedType: resolvedType ?? capability?.resource_type ?? params.resourceType ?? null,
      capabilityId: params.capabilityId,
    });
  }

  /** Mirror of `execute`. */
  async execute(params: {
    capabilityId: string;
    resourceType?: string;
    action?: string;
    payload?: Dict;
    /**
     * Progressive streaming callback for DOC sync calls. Propagated from the
     * OpenClaw tool `execute(toolCallId, args, signal, onUpdate)` signature so
     * partial answer chunks can be pushed to the chat UI as they arrive.
     */
    onDelta?: DocDeltaCallback;
    /** Cancellation signal for long-running DOC polls. */
    signal?: AbortSignal;
    /** Host logger; request logs go through OpenClaw's plugin logger when available. */
    logger?: BaiyingEnhanceLogger;
  }): Promise<ExecutorResponse> {
    const payload = isRecord(params.payload) ? params.payload : {};
    const action = params.action || String(payload.action ?? "");
    const resourceContext = getResourceContext(payload);
    logChannelDebug(
      `execute(${params.capabilityId}, ${params.resourceType ?? ""})`,
      { resourceContext, logger: params.logger },
    );
    const backendParameters = extractBackendParameters(payload);
    const mcpForwardHeaders = extractOpenclawMcpForwardHeaders(resourceContext);

    const authContext = await this.getAuthContext();
    const { capability, resolvedType } = await resolveCapability({
      resourcesDir: this.resourcesDir,
      capabilityId: params.capabilityId,
      resourceType: params.resourceType,
      resourceContext,
      authContext,
      session: this.session,
    });
    if (!capability) {
      return makeError("CAPABILITY_NOT_FOUND", `Capability not found: ${params.capabilityId}`);
    }

    const resType = normalizeResourceType(resolvedType ?? capability.resource_type ?? "");
    if (resType === "agent") {
      return await executeAgent({
        capability,
        parameters: payload,
        authContext,
        session: this.session,
        logger: params.logger,
      });
    }
    if (resType === "toolkit") {
      return await executeToolkit({
        capability,
        action,
        parameters: backendParameters,
        authContext,
        session: this.session,
        logger: params.logger,
      });
    }
    if (resType === "tool") {
      return await executeTool({
        capability,
        parameters: backendParameters,
        authContext,
        session: this.session,
        logger: params.logger,
      });
    }
    if (resType === "mcp" || resType === "object" || resType === "view") {
      return await executeMcp({
        capability,
        action,
        parameters: resType === "object" || resType === "view" ? payload : backendParameters,
        forwardHeaders:
          Object.keys(mcpForwardHeaders).length > 0 ? mcpForwardHeaders : undefined,
        authContext,
        session: this.session,
        logger: params.logger,
      });
    }
    if (resType === "doc") {
      return await executeDoc({
        capability,
        parameters: payload,
        authContext,
        session: this.session,
        onDelta: params.onDelta,
        signal: params.signal,
        logger: params.logger,
      });
    }
    return makeError("UNKNOWN_RESOURCE_TYPE", `Unknown resource type: ${resType}`);
  }
}
