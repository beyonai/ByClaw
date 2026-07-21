import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createStandaloneHubSkillRunSync,
  registerHubSkillRunSyncHook,
} from "./hub-skill-run-hook.js";

describe("registerHubSkillRunSyncHook", () => {
  it("awaits the current managed agent hub skill check before dispatch", async () => {
    let beforeDispatch:
      | ((event: { sessionKey?: string }, ctx: { sessionKey?: string; agentId?: string }) => Promise<void>)
      | undefined;
    const api = {
      on: vi.fn((name: string, handler: typeof beforeDispatch) => {
        if (name === "before_dispatch") {
          beforeDispatch = handler;
        }
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    const syncBeforeRun = vi.fn(async () => {});
    registerHubSkillRunSyncHook(api, {
      getSyncBeforeRun: () => syncBeforeRun,
    });

    await beforeDispatch?.(
      { sessionKey: "agent:baiying-agent-10026038:byai-channel:direct:1" },
      {},
    );

    expect(syncBeforeRun).toHaveBeenCalledTimes(1);
    expect(syncBeforeRun).toHaveBeenCalledWith("baiying-agent-10026038");
    expect(api.logger.info).toHaveBeenCalledWith(
      "baiying-enhance: hub skill run check start agentId=baiying-agent-10026038 syncReady=true",
    );
  });

  it("does nothing when the watchdog has not started", async () => {
    let beforeDispatch: (() => Promise<void>) | undefined;
    const api = {
      on: vi.fn((_name: string, handler: typeof beforeDispatch) => {
        beforeDispatch = handler;
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    registerHubSkillRunSyncHook(api, { getSyncBeforeRun: () => undefined });

    await expect(beforeDispatch?.()).resolves.toBeUndefined();
    expect(api.logger.info).toHaveBeenCalledWith(
      "baiying-enhance: hub skill run check start agentId=(unknown) syncReady=false",
    );
  });

  it("uses the standalone checker when the watchdog is unavailable in the run runtime", async () => {
    let beforeDispatch:
      | ((event: { sessionKey?: string }, ctx: { sessionKey?: string; agentId?: string }) => Promise<void>)
      | undefined;
    const api = {
      on: vi.fn((_name: string, handler: typeof beforeDispatch) => {
        beforeDispatch = handler;
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    const standaloneSyncBeforeRun = vi.fn(async () => {});
    registerHubSkillRunSyncHook(api, {
      getSyncBeforeRun: () => undefined,
      standaloneSyncBeforeRun,
    } as any);

    await beforeDispatch?.(
      { sessionKey: "agent:baiying-agent-10026038:byai-channel:direct:1" },
      {},
    );

    expect(standaloneSyncBeforeRun).toHaveBeenCalledWith("baiying-agent-10026038");
  });

  it("blocks dispatch when the Hub Skill check fails", async () => {
    let beforeDispatch:
      | ((event: { sessionKey?: string }, ctx: { sessionKey?: string; agentId?: string }) => Promise<unknown>)
      | undefined;
    const api = {
      on: vi.fn((_name: string, handler: typeof beforeDispatch) => {
        beforeDispatch = handler;
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    registerHubSkillRunSyncHook(api, {
      getSyncBeforeRun: () => vi.fn(async () => Promise.reject(new Error("version endpoint unavailable"))),
    });

    await expect(
      beforeDispatch?.(
        { sessionKey: "agent:baiying-agent-10026038:byai-channel:direct:1" },
        {},
      ),
    ).resolves.toEqual({
      handled: true,
      text: expect.stringContaining("Hub Skill 运行前检查失败"),
    });
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("blocking dispatch to preserve strong consistency"),
    );
  });
});

describe("createStandaloneHubSkillRunSync", () => {
  it("checks installed Hub Skills for the current agent and invalidates the snapshot after a download", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "hub-skill-run-hook-"));
    const skillDir = path.join(stateDir, "skills", "installed-hub");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# installed\n", "utf8");
    await writeFile(
      path.join(skillDir, ".baiying-hub-skill.json"),
      JSON.stringify({
        skillCode: "installed-hub",
        version: "v1",
        skillUrl: "/download?id=1",
        versionUrl: "/version?id=1",
        downloadedAt: "2026-07-21T00:00:00.000Z",
      }),
      "utf8",
    );
    const syncHubSkills = vi.fn(async () => ({
      changed: true,
      checked: 1,
      downloaded: ["installed-hub"],
      skipped: [],
      failed: [],
    }));
    const invalidateSnapshot = vi.fn(async () => {});
    const api = {
      runtime: {
        config: {
          current: () => ({
            agents: {
              list: [
                {
                  id: "baiying-agent-10026038",
                  skills: ["installed-hub", "ordinary-skill"],
                },
              ],
            },
          }),
        },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    const syncBeforeRun = createStandaloneHubSkillRunSync({
      api,
      stateDir,
      syncHubSkills,
      invalidateSnapshot,
    } as any);

    await syncBeforeRun("baiying-agent-10026038");

    expect(syncHubSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        managed: [
          {
            hubSkills: [
              {
                skillCode: "installed-hub",
                skillUrl: "/download?id=1",
                versionUrl: "/version?id=1",
              },
            ],
          },
        ],
        trigger: "agent-run",
      }),
    );
    expect(invalidateSnapshot).toHaveBeenCalledTimes(1);
  });

  it("reports a failed version check as an error", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "hub-skill-run-hook-failed-"));
    const skillDir = path.join(stateDir, "skills", "installed-hub");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# installed\n", "utf8");
    await writeFile(
      path.join(skillDir, ".baiying-hub-skill.json"),
      JSON.stringify({
        skillCode: "installed-hub",
        version: "v1",
        skillUrl: "/download?id=1",
        versionUrl: "/version?id=1",
        downloadedAt: "2026-07-21T00:00:00.000Z",
      }),
      "utf8",
    );
    const api = {
      runtime: {
        config: {
          current: () => ({
            agents: {
              list: [{ id: "baiying-agent-10026038", skills: ["installed-hub"] }],
            },
          }),
        },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    const syncBeforeRun = createStandaloneHubSkillRunSync({
      api,
      stateDir,
      syncHubSkills: vi.fn(async () => ({
        changed: false,
        checked: 1,
        downloaded: [],
        skipped: [],
        failed: ["installed-hub"],
      })),
    } as any);

    await expect(syncBeforeRun("baiying-agent-10026038")).rejects.toThrow(
      "Hub Skill run check failed: installed-hub",
    );
  });
});
