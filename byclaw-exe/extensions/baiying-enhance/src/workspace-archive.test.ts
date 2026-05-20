import path from "node:path";
import { tmpdir } from "node:os";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveUnauthorizedManagedAgentWorkspaces,
  cleanupManagedBootstrapFilesOnColdStart,
  deleteManagedAgentWorkspaces,
  listActiveManagedWorkspaces,
  reconcileUnauthorizedMountedWorkspacesOnColdStart,
  resolveWorkspaceArchiveRoot,
  restoreManagedAgentWorkspaces,
} from "./workspace-archive.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import type { WorkspaceArchiveApi } from "./workspace-archive-api.js";
import { MANAGED_SEED_MARKER } from "./workspace-seed.js";

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

describe("cold-start workspace reconcile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists workspace-baiying-agent-* directories under OPENCLAW_STATE_DIR", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baiying-cold-start-list-"));
    const stateDir = path.join(root, ".openclaw");
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const authorizedId = `${MANAGED_AGENT_PREFIX}10000417`;
    const orphanId = `${MANAGED_AGENT_PREFIX}999`;
    await mkdir(path.join(stateDir, `workspace-${authorizedId}`), { recursive: true });
    await mkdir(path.join(stateDir, `workspace-${orphanId}`), { recursive: true });

    const listed = await listActiveManagedWorkspaces(stateDir);
    expect(listed.map((item) => item.agentId).sort()).toEqual([authorizedId, orphanId].sort());
    expect(listed.find((item) => item.agentId === orphanId)?.sourceKey).toBe("999");
  });

  it("removes legacy plugin-managed BOOTSTRAP.md files on cold start only when marked", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baiying-cold-start-bootstrap-"));
    const stateDir = path.join(root, ".openclaw");
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const mainWs = path.join(stateDir, "workspace");
    const managedWs = path.join(stateDir, `workspace-${MANAGED_AGENT_PREFIX}10000417`);
    const customWs = path.join(root, "custom-agent-workspace");
    const userWs = path.join(stateDir, "workspace-user-owned");
    await mkdir(mainWs, { recursive: true });
    await mkdir(managedWs, { recursive: true });
    await mkdir(customWs, { recursive: true });
    await mkdir(userWs, { recursive: true });
    await writeFile(path.join(mainWs, "BOOTSTRAP.md"), `${MANAGED_SEED_MARKER}\n\nlegacy main`, "utf8");
    await writeFile(path.join(managedWs, "BOOTSTRAP.md"), `${MANAGED_SEED_MARKER}\n\nlegacy managed`, "utf8");
    await writeFile(path.join(customWs, "BOOTSTRAP.md"), `${MANAGED_SEED_MARKER}\n\nlegacy custom`, "utf8");
    await writeFile(path.join(userWs, "BOOTSTRAP.md"), "# User bootstrap\n", "utf8");
    const api = {
      runtime: {
        config: {
          loadConfig: vi.fn(() => ({
            agents: {
              list: [{ id: "custom-agent", workspace: customWs }],
            },
          })),
        },
      },
    };
    const log = { info: vi.fn(), warn: vi.fn() };

    const results = await cleanupManagedBootstrapFilesOnColdStart({ api: api as any, log });

    expect(results.filter((result) => result.removed)).toHaveLength(3);
    expect(await pathExists(path.join(mainWs, "BOOTSTRAP.md"))).toBe(false);
    expect(await pathExists(path.join(managedWs, "BOOTSTRAP.md"))).toBe(false);
    expect(await pathExists(path.join(customWs, "BOOTSTRAP.md"))).toBe(false);
    expect(await readFile(path.join(userWs, "BOOTSTRAP.md"), "utf8")).toBe("# User bootstrap\n");
  });

  it("archives mounted workspaces missing from the auth set on cold start (remote)", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const root = await mkdtemp(path.join(tmpdir(), "baiying-cold-start-remote-"));
    const stateDir = path.join(root, ".openclaw");
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const orphanId = `${MANAGED_AGENT_PREFIX}10000999`;
    const activeWs = path.join(stateDir, `workspace-${orphanId}`);
    await mkdir(activeWs, { recursive: true });
    await writeFile(path.join(activeWs, "notes.txt"), "orphan", "utf8");
    const uploadWorkspace = vi.fn(async () => ({
      exists: true,
      objectKey: "/openclaw-workspace-archives/workspace-baiying-agent-10000999/cancel_auth_latest.tar.gz",
    }));
    const archiveApi = {
      uploadWorkspace,
      status: vi.fn(),
      downloadWorkspace: vi.fn(),
    } as unknown as WorkspaceArchiveApi;
    const log = { info: vi.fn(), warn: vi.fn() };

    const results = await reconcileUnauthorizedMountedWorkspacesOnColdStart({
      pluginConfig: {},
      authorizedSourceKeys: new Set(["10000417"]),
      workspaceArchiveApi: archiveApi,
      log,
    });

    expect(uploadWorkspace).toHaveBeenCalledWith({
      userCode: "0027024710",
      resourceId: "10000999",
      archiveKind: "cancel_auth",
      workspaceDir: activeWs,
    });
    expect(results[0]?.archived).toBe(true);
    expect(await pathExists(activeWs)).toBe(false);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("cold-start"));
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
