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

