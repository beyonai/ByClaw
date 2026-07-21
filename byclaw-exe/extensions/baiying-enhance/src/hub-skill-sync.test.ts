import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import {
  buildHubSkillAuthHeaders,
  loadInstalledHubSkillRefs,
  resolveHubSkillApiUrl,
  syncHubSkillsForManagedAgents,
  validateHubSkillZipEntryName,
} from "./hub-skill-sync.js";

const execFileAsync = promisify(execFile);

async function createSkillZip(params: {
  skillCode: string;
  rootSkillDoc?: boolean;
}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "baiying-hub-skill-zip-"));
  const zipPath = path.join(root, `${params.skillCode}.zip`);
  if (params.rootSkillDoc) {
    await writeFile(path.join(root, "SKILL.md"), `# ${params.skillCode}\n`, "utf8");
    await execFileAsync("zip", ["-qr", zipPath, "SKILL.md"], { cwd: root });
  } else {
    const skillDir = path.join(root, params.skillCode);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), `# ${params.skillCode}\n`, "utf8");
    await writeFile(path.join(skillDir, "README.md"), "readme\n", "utf8");
    await execFileAsync("zip", ["-qr", zipPath, params.skillCode], { cwd: root });
  }
  return zipPath;
}

function zipResponse(zipPath: string): Response {
  return new Response(createReadStream(zipPath) as any, {
    status: 200,
    headers: { "content-type": "application/zip" },
  });
}

function versionResponse(version: string, skillUrl = "/byaiService/tool/downloadSkillZip?skillId=1"): Response {
  return new Response(
    JSON.stringify({
      code: 0,
      success: true,
      data: { version, skillUrl },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("hub-skill-sync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rebuilds run-check references from installed Hub Skill metadata", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-hub-installed-state-"));
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

    await expect(
      loadInstalledHubSkillRefs({ stateDir, skillCodes: ["installed-hub", "ordinary-skill"] }),
    ).resolves.toEqual([
      {
        skillCode: "installed-hub",
        skillUrl: "/download?id=1",
        versionUrl: "/version?id=1",
      },
    ]);
  });

  it("resolves relative hub API URLs against the discovered backend service", () => {
    expect(
      resolveHubSkillApiUrl(
        "http://10.10.168.203:8086/byaiService",
        "/byaiService/tool/getSkillVersion?skillId=1",
      ),
    ).toBe("http://10.10.168.203:8086/byaiService/tool/getSkillVersion?skillId=1");
    expect(
      resolveHubSkillApiUrl(
        "http://10.10.168.203:8086/byaiService",
        "tool/getSkillVersion?skillId=1",
      ),
    ).toBe("http://10.10.168.203:8086/byaiService/tool/getSkillVersion?skillId=1");
  });

  it("builds hub skill auth headers from Redis login auth with an allowlist", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const store = {
      getStringByKey: vi.fn(async () => "user-1"),
      getHashByKey: vi.fn(async () => ({
        "Beyond-Token": "beyond",
        "Sso-Token": "sso",
        WHALE_AGENT_AUTHORIZATION: "Bearer token",
        userName: "中文名",
      })),
    } as unknown as BaiyingRedisJsonStore;

    const headers = await buildHubSkillAuthHeaders({
      redisJsonStore: store,
      authFilePath: path.join(tmpdir(), "missing-baiying-session.json"),
    });

    expect(headers).toEqual({
      Authorization: "Bearer token",
      "Beyond-Token": "beyond",
      "Sso-Token": "sso",
      "X-User-Id": "0027024710",
    });
    expect(Object.keys(headers)).not.toContain("userName");
  });

  it("logs strong-consistency request details with redacted headers and local/remote versions", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-hub-log-state-"));
    const zipPath = await createSkillZip({ skillCode: "logged-skill" });
    const store = {
      getStringByKey: vi.fn(async () => "user-1"),
      getHashByKey: vi.fn(async () => ({
        "Beyond-Token": "beyond-secret",
        "Sso-Token": "sso-secret",
        WHALE_AGENT_AUTHORIZATION: "Bearer auth-secret",
      })),
    } as unknown as BaiyingRedisJsonStore;
    const info = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(versionResponse("v7"))
      .mockResolvedValueOnce(zipResponse(zipPath));

    await syncHubSkillsForManagedAgents({
      managed: [
        {
          hubSkills: [
            {
              skillCode: "logged-skill",
              skillUrl: "/byaiService/tool/downloadSkillZip?skillId=7",
              versionUrl: "/byaiService/tool/getSkillVersion?skillId=7",
            },
          ],
        },
      ],
      redisJsonStore: store,
      logger: { info },
      stateDir,
      baseUrl: "http://example.test/byaiService",
      timeoutMs: 5000,
      trigger: "agent-run",
    });

    const logs = info.mock.calls.map(([message]) => String(message)).join("\n");
    expect(logs).toContain("trigger=agent-run");
    expect(logs).toContain("requestType=version");
    expect(logs).toContain("url=http://example.test/byaiService/tool/getSkillVersion?skillId=7");
    expect(logs).toContain("skillCode=logged-skill");
    expect(logs).toContain("localVersion=(none)");
    expect(logs).toContain("remoteVersion=v7");
    expect(logs).toContain('"Authorization":"[REDACTED]"');
    expect(logs).toContain('"Beyond-Token":"[REDACTED]"');
    expect(logs).toContain('"Sso-Token":"[REDACTED]"');
    expect(logs).toContain('"X-User-Id":"0027024710"');
    expect(logs).not.toContain("auth-secret");
    expect(logs).not.toContain("beyond-secret");
    expect(logs).not.toContain("sso-secret");
  });

  it("downloads a hub skill when local metadata is missing and skips the same version later", async () => {
    vi.stubEnv("USER_CODE", "0027024710");
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-hub-state-"));
    const zipPath = await createSkillZip({ skillCode: "hub-skill" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(versionResponse("v1"))
      .mockResolvedValueOnce(zipResponse(zipPath))
      .mockResolvedValueOnce(versionResponse("v1"));

    const managed = [
      {
        hubSkills: [
          {
            skillCode: "hub-skill",
            skillUrl: "/byaiService/tool/downloadSkillZip?skillId=1",
            versionUrl: "/byaiService/tool/getSkillVersion?skillId=1",
          },
        ],
      },
    ];

    await expect(
      syncHubSkillsForManagedAgents({
        managed,
        stateDir,
        baseUrl: "http://example.test/byaiService",
        timeoutMs: 5000,
      }),
    ).resolves.toMatchObject({ changed: true, checked: 1, downloaded: ["hub-skill"] });

    await expect(readFile(path.join(stateDir, "skills", "hub-skill", "SKILL.md"), "utf8")).resolves.toContain("# hub-skill");
    await expect(
      readFile(path.join(stateDir, "skills", "hub-skill", ".baiying-hub-skill.json"), "utf8"),
    ).resolves.toContain('"version": "v1"');

    await expect(
      syncHubSkillsForManagedAgents({
        managed,
        stateDir,
        baseUrl: "http://example.test/byaiService",
        timeoutMs: 5000,
      }),
    ).resolves.toMatchObject({ changed: false, checked: 1, skipped: ["hub-skill"] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("accepts zip files with SKILL.md at archive root", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-hub-root-state-"));
    const zipPath = await createSkillZip({ skillCode: "root-skill", rootSkillDoc: true });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(versionResponse("v2"))
      .mockResolvedValueOnce(zipResponse(zipPath));

    await expect(
      syncHubSkillsForManagedAgents({
        managed: [
          {
            hubSkills: [
              {
                skillCode: "root-skill",
                skillUrl: "/byaiService/tool/downloadSkillZip?skillId=2",
                versionUrl: "/byaiService/tool/getSkillVersion?skillId=2",
              },
            ],
          },
        ],
        stateDir,
        baseUrl: "http://example.test/byaiService",
        timeoutMs: 5000,
      }),
    ).resolves.toMatchObject({ changed: true, downloaded: ["root-skill"] });

    await expect(readFile(path.join(stateDir, "skills", "root-skill", "SKILL.md"), "utf8")).resolves.toContain("# root-skill");
  });

  it("rejects unsafe zip entry paths", () => {
    expect(() => validateHubSkillZipEntryName("../SKILL.md")).toThrow(/unsafe zip entry/);
    expect(() => validateHubSkillZipEntryName("/tmp/SKILL.md")).toThrow(/unsafe zip entry/);
    expect(() => validateHubSkillZipEntryName("C:\\tmp\\SKILL.md")).toThrow(/unsafe zip entry/);
    expect(() => validateHubSkillZipEntryName("safe/SKILL.md")).not.toThrow();
  });
});
