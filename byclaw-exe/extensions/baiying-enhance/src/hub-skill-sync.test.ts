import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

vi.mock("./backend-service-discovery.js", () => ({ discoverBackendBaseUrl: vi.fn() }));
vi.mock("./redis-json-store.js", () => ({ getSharedRedisJsonStore: vi.fn() }));

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

  it.each(["version", "download", "extract"])(
    "continues installing later skills when the first skill fails during %s",
    async (failureStage) => {
      const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-hub-partial-state-"));
      const zipPath = await createSkillZip({ skillCode: "second-skill" });
      const logger = { warn: vi.fn() };
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = new URL(String(input));
        const skillId = url.searchParams.get("skillId");
        if (url.pathname.endsWith("/getSkillVersion")) {
          if (skillId === "1" && failureStage === "version") {
            return new Response(JSON.stringify({ code: -1, data: null, msg: "Skill version not found", success: false }), { status: 200 });
          }
          return versionResponse("v1", `/byaiService/tool/downloadSkillZip?skillId=${skillId}`);
        }
        if (url.pathname.endsWith("/downloadSkillZip")) {
          if (skillId === "1") {
            return failureStage === "download"
              ? new Response("download unavailable", { status: 503 })
              : new Response("invalid zip contents", { status: 200 });
          }
          return zipResponse(zipPath);
        }
        throw new Error(`Unexpected URL: ${url.pathname}`);
      });

      try {
        const result = await syncHubSkillsForManagedAgents({
          managed: [
            {
              hubSkills: ["first-skill", "second-skill"].map((skillCode, index) => ({
                skillCode,
                skillUrl: `/byaiService/tool/downloadSkillZip?skillId=${index + 1}`,
                versionUrl: `/byaiService/tool/getSkillVersion?skillId=${index + 1}`,
              })),
            },
          ],
          stateDir,
          baseUrl: "http://example.test/byaiService",
          timeoutMs: 5000,
          logger,
        });

        expect(result).toEqual({
          changed: true,
          checked: 2,
          downloaded: ["second-skill"],
          skipped: [],
          failed: ["first-skill"],
        });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("hub skill sync failed skillCode=first-skill"),
        );
        if (failureStage === "version") {
          expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("version request rejected code=-1: Skill version not found"));
        }
        expect(fetchMock).toHaveBeenCalledWith(
          "http://example.test/byaiService/tool/downloadSkillZip?skillId=2",
          expect.any(Object),
        );
        await expect(
          readFile(path.join(stateDir, "skills", "second-skill", "SKILL.md"), "utf8"),
        ).resolves.toContain("# second-skill");
        await expect(
          readFile(path.join(stateDir, "skills", "first-skill", "SKILL.md"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(stateDir, { recursive: true, force: true });
        await rm(path.dirname(zipPath), { recursive: true, force: true });
      }
    },
  );

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

