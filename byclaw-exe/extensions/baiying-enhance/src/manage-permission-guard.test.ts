import { describe, expect, it, vi } from "vitest";
import {
  extractResourceIdFromPath,
  isProtectedWorkspaceFile,
  registerManagePermissionGuard,
  resourceIdFromAgentId,
} from "./manage-permission-guard.js";
import type { ManagePermissionStore } from "./manage-permission-store.js";

function createFakeApi() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const api = {
    on: vi.fn((hookName: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers.set(hookName, handler);
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
  return { api, handlers };
}

function createFakeStore(overrides: Partial<ManagePermissionStore> = {}): ManagePermissionStore {
  return {
    resolveUserId: vi.fn(async () => "user-1"),
    hasManagePermission: vi.fn(async () => false),
    isGlobalManager: vi.fn(async () => false),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("isProtectedWorkspaceFile / extractResourceIdFromPath", () => {
  it("matches protected filenames inside a managed workspace", () => {
    const p = "/root/.openclaw/workspace-baiying-agent-42/AGENTS.md";
    expect(isProtectedWorkspaceFile(p)).toBe(true);
    expect(extractResourceIdFromPath(p)).toBe("42");
  });

  it("does not match protected filenames outside a managed workspace", () => {
    expect(isProtectedWorkspaceFile("/root/.openclaw/workspace/AGENTS.md")).toBe(false);
  });

  it("does not match unprotected filenames inside a managed workspace", () => {
    expect(isProtectedWorkspaceFile("/root/.openclaw/workspace-baiying-agent-42/README.md")).toBe(
      false,
    );
  });

  it("matches all six protected filenames", () => {
    for (const name of [
      "AGENTS.md",
      "SOUL.md",
      "TOOLS.md",
      "USER.md",
      "IDENTITY.md",
      "BYAI_BUSINESS_EXTENSIONS.md",
    ]) {
      expect(isProtectedWorkspaceFile(`workspace-baiying-agent-7/${name}`)).toBe(true);
    }
  });
});

describe("resourceIdFromAgentId", () => {
  it("extracts the resourceId from a managed agent id", () => {
    expect(resourceIdFromAgentId("baiying-agent-99")).toBe("99");
  });

  it("returns undefined for non-managed agent ids", () => {
    expect(resourceIdFromAgentId("main")).toBeUndefined();
    expect(resourceIdFromAgentId(undefined)).toBeUndefined();
  });
});

describe("registerManagePermissionGuard: edit protected workspace files", () => {
  it("blocks editing a protected file in a managed workspace without permission", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({ hasManagePermission: vi.fn(async () => false) });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      {
        toolName: "edit",
        params: { path: "/root/.openclaw/workspace-baiying-agent-42/AGENTS.md", edits: [] },
      },
      { agentId: "baiying-agent-42" },
    );

    expect(result).toMatchObject({ block: true });
  });

  it("allows editing a protected file with management permission", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({ hasManagePermission: vi.fn(async () => true) });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      {
        toolName: "edit",
        params: { path: "/root/.openclaw/workspace-baiying-agent-42/SOUL.md", edits: [] },
      },
      { agentId: "baiying-agent-42" },
    );

    expect(result).toBeUndefined();
  });

  it("does not intercept edits outside a managed workspace", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({ hasManagePermission: vi.fn(async () => false) });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      { toolName: "edit", params: { path: "/root/.openclaw/workspace/AGENTS.md", edits: [] } },
      { agentId: "main" },
    );

    expect(result).toBeUndefined();
    expect(store.hasManagePermission).not.toHaveBeenCalled();
  });

  it("does not intercept unprotected files inside a managed workspace", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({ hasManagePermission: vi.fn(async () => false) });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      {
        toolName: "edit",
        params: { path: "/root/.openclaw/workspace-baiying-agent-42/README.md", edits: [] },
      },
      { agentId: "baiying-agent-42" },
    );

    expect(result).toBeUndefined();
  });

  it("does not intercept other tools", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({ hasManagePermission: vi.fn(async () => false) });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      { toolName: "write", params: { path: "/root/.openclaw/workspace-baiying-agent-42/AGENTS.md" } },
      { agentId: "baiying-agent-42" },
    );

    expect(result).toBeUndefined();
  });
});

describe("registerManagePermissionGuard: fail-open behavior", () => {
  it("fails open when userId cannot be resolved", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({ resolveUserId: vi.fn(async () => "") });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      { toolName: "skill_workshop", params: { action: "apply" } },
      { agentId: "baiying-agent-42" },
    );

    expect(result).toBeUndefined();
  });

  it("fails open when the permission store throws", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({
      hasManagePermission: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      {
        toolName: "edit",
        params: { path: "/root/.openclaw/workspace-baiying-agent-42/AGENTS.md", edits: [] },
      },
      { agentId: "baiying-agent-42" },
    );

    expect(result).toBeUndefined();
    expect(api.logger.warn).toHaveBeenCalled();
  });

  it("fails open when resourceId cannot be determined (unmanaged agentId)", async () => {
    const { api, handlers } = createFakeApi();
    const store = createFakeStore({ hasManagePermission: vi.fn(async () => false) });
    registerManagePermissionGuard({ api: api as any, store });

    const result = await handlers.get("before_tool_call")!(
      { toolName: "skill_workshop", params: { action: "apply" } },
      { agentId: "main" },
    );

    expect(result).toBeUndefined();
    expect(store.hasManagePermission).not.toHaveBeenCalled();
  });
});
