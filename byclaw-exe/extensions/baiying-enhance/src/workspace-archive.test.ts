import path from "node:path";
import { tmpdir } from "node:os";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveUnauthorizedManagedAgentWorkspaces,
  deleteManagedAgentWorkspaces,
  resolveWorkspaceArchiveRoot,
  restoreManagedAgentWorkspaces,
} from "./workspace-archive.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import type { WorkspaceArchiveApi } from "./workspace-archive-api.js";

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

describe("workspace archive paths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to .baiying-workspaces next to OPENCLAW_STATE_DIR", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    expect(resolveWorkspaceArchiveRoot()).toBe(path.join(path.sep, "by", ".baiying-workspaces"));
  });

  it("resolves relative workspaceArchiveDir under the state dir parent", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    expect(resolveWorkspaceArchiveRoot({ workspaceArchiveDir: ".custom-baiying" })).toBe(
      path.join(path.sep, "by", ".custom-baiying"),
    );
  });
});

describe("remote workspace archive", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uploads cancel_auth archives and removes active workspace after success", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const root = await mkdtemp(path.join(tmpdir(), "baiying-remote-archive-"));
    const activeWs = path.join(root, `workspace-${MANAGED_AGENT_PREFIX}10000417`);
    await mkdir(activeWs, { recursive: true });
    await writeFile(path.join(activeWs, "SOUL.md"), "secret", "utf8");
    const uploadWorkspace = vi.fn(async () => ({
      exists: true,
      objectKey: "/openclaw-workspace-archives/workspace-baiying-agent-10000417/cancel_auth_latest.tar.gz",
    }));
    const api = {
      uploadWorkspace,
      status: vi.fn(),
      downloadWorkspace: vi.fn(),
    } as unknown as WorkspaceArchiveApi;
    const log = { info: vi.fn(), warn: vi.fn() };

    const results = await archiveUnauthorizedManagedAgentWorkspaces({
      pluginConfig: {},
      agents: [{ agentId: `${MANAGED_AGENT_PREFIX}10000417`, workspaceDir: activeWs }],
      workspaceArchiveApi: api,
      log,
    });

    expect(uploadWorkspace).toHaveBeenCalledWith({
      userCode: "0027024710",
      resourceId: "10000417",
      archiveKind: "cancel_auth",
      workspaceDir: activeWs,
    });
    expect(results[0]?.archived).toBe(true);
    expect(await pathExists(activeWs)).toBe(false);
  });

  it("keeps active workspace when remote cancel_auth upload fails", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const root = await mkdtemp(path.join(tmpdir(), "baiying-remote-archive-fail-"));
    const activeWs = path.join(root, `workspace-${MANAGED_AGENT_PREFIX}10000417`);
    await mkdir(activeWs, { recursive: true });
    await writeFile(path.join(activeWs, "SOUL.md"), "keep", "utf8");
    const api = {
      uploadWorkspace: vi.fn(async () => {
        throw new Error("api unavailable");
      }),
      status: vi.fn(),
      downloadWorkspace: vi.fn(),
    } as unknown as WorkspaceArchiveApi;
    const log = { info: vi.fn(), warn: vi.fn() };

    const results = await archiveUnauthorizedManagedAgentWorkspaces({
      pluginConfig: {},
      agents: [{ agentId: `${MANAGED_AGENT_PREFIX}10000417`, workspaceDir: activeWs }],
      workspaceArchiveApi: api,
      log,
    });

    expect(results[0]?.archived).toBe(false);
    expect(await readFile(path.join(activeWs, "SOUL.md"), "utf8")).toBe("keep");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("keeping local workspace"));
  });

  it("uses delete archive kind for DIG_EMPLOYEE_DELETED cleanup", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const root = await mkdtemp(path.join(tmpdir(), "baiying-remote-delete-"));
    const activeWs = path.join(root, `workspace-${MANAGED_AGENT_PREFIX}10000418`);
    await mkdir(activeWs, { recursive: true });
    await writeFile(path.join(activeWs, "SOUL.md"), "delete archive", "utf8");
    const uploadWorkspace = vi.fn(async () => ({
      exists: true,
      objectKey: "/openclaw-workspace-archives/workspace-baiying-agent-10000418/del_latest.tar.gz",
    }));
    const api = {
      uploadWorkspace,
      status: vi.fn(),
      downloadWorkspace: vi.fn(),
    } as unknown as WorkspaceArchiveApi;

    const results = await deleteManagedAgentWorkspaces({
      agents: [{ agentId: `${MANAGED_AGENT_PREFIX}10000418`, workspaceDir: activeWs }],
      workspaceArchiveApi: api,
      reason: "DIG_EMPLOYEE_DELETED",
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(uploadWorkspace).toHaveBeenCalledWith({
      userCode: "0027024710",
      resourceId: "10000418",
      archiveKind: "delete",
      workspaceDir: activeWs,
    });
    expect(results[0]?.deleted).toBe(true);
    expect(await pathExists(activeWs)).toBe(false);
  });

  it("restores only cancel_auth archives before seeding can update managed files", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const root = await mkdtemp(path.join(tmpdir(), "baiying-remote-restore-"));
    const agentId = `${MANAGED_AGENT_PREFIX}10000417`;
    const activeWs = path.join(root, `workspace-${agentId}`);
    const downloadWorkspace = vi.fn(async ({ destinationWorkspaceDir }) => {
      await mkdir(destinationWorkspaceDir, { recursive: true });
      await writeFile(path.join(destinationWorkspaceDir, "SOUL.md"), "restored", "utf8");
      return true;
    });
    const archiveApi = {
      uploadWorkspace: vi.fn(),
      status: vi.fn(),
      downloadWorkspace,
    } as unknown as WorkspaceArchiveApi;
    const openclawApi = {
      runtime: {
        config: {
          loadConfig: () => ({
            agents: { list: [{ id: agentId, workspace: activeWs }] },
          }),
        },
      },
    } as any;

    await restoreManagedAgentWorkspaces({
      api: openclawApi,
      pluginConfig: {},
      agentIds: [agentId],
      workspaceArchiveApi: archiveApi,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(downloadWorkspace).toHaveBeenCalledWith({
      userCode: "0027024710",
      resourceId: "10000417",
      archiveKind: "cancel_auth",
      destinationWorkspaceDir: activeWs,
    });
    expect(await readFile(path.join(activeWs, "SOUL.md"), "utf8")).toBe("restored");
  });
});
