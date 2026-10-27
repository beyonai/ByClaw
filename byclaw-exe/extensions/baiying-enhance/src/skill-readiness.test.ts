import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRegistryState } from "./agent-state.js";
import { createSkillReadiness, registerSkillReadiness } from "./skill-readiness.js";
import { getHubSkillDownloadState } from "./hub-skill-sync.js";
vi.mock("./hub-skill-sync.js", () => ({ getHubSkillDownloadState: vi.fn() }));

const agentId = "baiying-agent-20";
let dir: string;
let cfg: any;
let api: any;
let store: any;
let registry: AgentRegistryState;
let flush: ReturnType<typeof vi.fn>;
let runtime: ReturnType<typeof createSkillReadiness>;
let raw: any;
let agent: any;
let allowed: Set<string>;
let clock: number;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(path.join(tmpdir(), "skill-readiness-"));
  clock = Date.now();
  cfg = { agents: { list: [{ id: agentId, skills: ["westock-data"] }] },
    skills: { entries: { __baiying_enhance_reload: { config: { managedSnapshotSignature: "applied" } } } } };
  api = { runtime: { config: { current: () => cfg, loadConfig: () => cfg } }, logger: { warn: vi.fn() }, on: vi.fn(), registerTool: vi.fn() };
  raw = { relSkills: [{ skillCode: "8640", skillType: "hub", versionUrl: "/version", skillUrl: "/zip" }],
    controlledResources: [{ resourceId: "77", resourceCode: "8640", resourceBizType: "SKILL", requiresExplicitUse: true }],
    relResourceList: [{ resourceId: "77", resourceCode: "8640", resourceBizType: "SKILL", resourceName: "westock-data" }] };
  store = { getDigEmployeeJson: vi.fn(async () => ({ raw, hash: "hash-1" })),
    getHashByKey: vi.fn(async () => ({ "77": "SKILL" })), getStringByKey: vi.fn(async () => null),
    setExpiringHashJson: vi.fn(async () => undefined) };
  registry = new AgentRegistryState();
  agent = { agentId, sourceSnapshotHash: "hash-1" };
  registry.replaceAll([agent]);
  allowed = new Set(["20"]);
  flush = vi.fn(async () => { runtime.recordApplied([agent], "applied"); });
  runtime = createSkillReadiness({ api, registry, store, getAuthorizedIds: () => allowed,
    flush, stateDir: dir, resolveUserId: async () => "1125", now: () => clock });
  await mkdir(path.join(dir, "skills", "8640"), { recursive: true });
  await writeFile(path.join(dir, "skills", "8640", "SKILL.md"), "---\nname: westock-data\n---\n# Test");
  await writeFile(path.join(dir, "skills", "8640", ".baiying-hub-skill.json"), JSON.stringify({ skillCode: "8640", version: "v1", versionUrl: "https://backend/version" }));
  vi.mocked(getHubSkillDownloadState).mockReturnValue({ state: "DOWNLOADED", version: "v1", checkedAt: clock });
});
afterEach(async () => { runtime.stop(); await rm(dir, { recursive: true, force: true }); });

describe("skill readiness", () => {
  it("first use prepares associated skills and publishes a scoped receipt without local paths", async () => {
    expect((await runtime.inspect(agentId)).state).toBe("PREPARING");
    const result = await runtime.prepare(agentId, 0);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(result.skills[0]).toMatchObject({ state: "READY", name: "westock-data", skillFile: path.join(dir, "skills", "8640", "SKILL.md") });
    const [key, field, receipt, ttl] = store.setExpiringHashJson.mock.calls.at(-1);
    expect(key).toBe("byai:skill_runtime:1125:20");
    expect(field).toBe(result.runtimeId);
    expect(ttl).toBe(120);
    expect(receipt.skills[0]).not.toHaveProperty("skillFile");
  });
  it("does not treat Redis or disk configuration alone as ready", async () => {
    runtime.recordApplied([agent], "applied");
    cfg.skills.entries.__baiying_enhance_reload.config.managedSnapshotSignature = "old";
    expect((await runtime.inspect(agentId)).skills[0].errorCode).toBe("CONFIG_PENDING");
    cfg.skills.entries.__baiying_enhance_reload.config.managedSnapshotSignature = "applied";
    agent.sourceSnapshotHash = "old";
    expect((await runtime.inspect(agentId)).state).toBe("PREPARING");
  });
  it("requires the frontmatter name in the live allowlist and the file on disk", async () => {
    runtime.recordApplied([agent], "applied");
    cfg.agents.list[0].skills = ["8640"];
    expect((await runtime.inspect(agentId)).skills[0].errorCode).toBe("CONFIG_PENDING");
    cfg.agents.list[0].skills = ["westock-data"];
    await rm(path.join(dir, "skills", "8640", "SKILL.md"));
    expect((await runtime.inspect(agentId)).skills[0].errorCode).toBe("PACKAGE_MISSING");
  });
  it("does not acknowledge an old package after an upgrade failed", async () => {
    runtime.recordApplied([agent], "applied");
    vi.mocked(getHubSkillDownloadState).mockReturnValue({ state: "FAILED", errorCode: "DOWNLOAD_UNAUTHORIZED", checkedAt: clock });
    expect((await runtime.inspect(agentId)).skills[0]).toMatchObject({ state: "FAILED", errorCode: "DOWNLOAD_UNAUTHORIZED" });
  });
  it("filters revoked resources and refuses unauthorized employees without preparing", async () => {
    store.getHashByKey.mockResolvedValue({});
    expect((await runtime.inspect(agentId)).skills).toEqual([]);
    allowed.clear();
    expect((await runtime.prepare(agentId, 0)).state).toBe("UNAVAILABLE");
    expect(flush).not.toHaveBeenCalled();
  });
  it("coalesces concurrent first-use repairs and does not cancel timed-out work", async () => {
    let finish!: () => void;
    flush.mockImplementation(() => new Promise<void>(resolve => { finish = () => { runtime.recordApplied([agent], "applied"); resolve(); }; }));
    const results = await Promise.all([runtime.prepare(agentId, 0), runtime.prepare(agentId, 0)]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(results.every(r => r.state === "PREPARING")).toBe(true);
    finish();
    await Promise.resolve();
    expect((await runtime.inspect(agentId)).state).toBe("READY");
  });
  it("repairs missed events, refreshes heartbeats, periodically checks package versions and consumes retries", async () => {
    await runtime.tick();
    expect(flush).toHaveBeenCalledTimes(1);
    await runtime.tick();
    expect(flush).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await runtime.tick();
    expect(flush).toHaveBeenCalledTimes(2);
    store.getStringByKey.mockResolvedValue("new-request");
    await runtime.tick();
    expect(flush).toHaveBeenCalledTimes(3);
  });
  it("does not bypass explicit automatic-download opt-out", async () => {
    const disabled = createSkillReadiness({ api, registry, store, getAuthorizedIds: () => allowed,
      flush, autoSync: false, stateDir: dir, resolveUserId: async () => "1125" });
    await disabled.prepare(agentId, 0);
    expect(flush).not.toHaveBeenCalled();
    disabled.stop();
  });
  it("prompt hooks only inspect, and the tool returns associated matches rather than searching the market", async () => {
    registerSkillReadiness(api, runtime);
    const prompt = api.on.mock.calls.find(([name]: any) => name === "before_prompt_build")[1];
    expect((await prompt({}, { agentId })).appendSystemContext).toContain("westock-data");
    expect(flush).not.toHaveBeenCalled();
    const factory = api.registerTool.mock.calls[0][0];
    expect(factory({ agentId: "main" })).toBeNull();
    const result = await factory({ agentId }).execute("call", { action: "status", query: "not-associated" });
    expect(result.details.skills).toEqual([]);
    expect(store.getDigEmployeeJson).toHaveBeenCalledWith("20");
  });
});
