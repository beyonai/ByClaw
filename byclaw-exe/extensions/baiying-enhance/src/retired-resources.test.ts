import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isRetiredResourceType, RETIRED_RESOURCE_TYPES } from "./retired-resources.js";
import { resolveCapability } from "./executor/capability-resolver.js";
import { buildDirectCapabilityStub } from "./executor/capability-builder.js";
import { executeMcp } from "./executor/resource-types/mcp.js";
import { setSharedRedisJsonStore } from "./redis-json-store.js";
import { adaptAgentJson, type AdaptedManagedAgent } from "./agent-adapter.js";
import { AgentRegistryState } from "./agent-state.js";
import { buildBaiyingCallDescription, createBaiyingCallToolFactory } from "./baiying-call-tool.js";
import { buildToolsMd, buildAgentsMd, seedManagedAgentWorkspace, MANAGED_SEED_MARKER } from "./workspace-seed.js";
import { buildSubagentRoutingMarkdown } from "./subagent-routing-seed.js";

const authContext = { session: "", userId: "", headers: {} };
const legacy = RETIRED_RESOURCE_TYPES.map((type, index) => ({
  resourceId: String(11 + index), resourceBizType: type, resourceType: type, resourceName: `retired-${index}`,
}));
const normal = { resourceId: "21", resourceBizType: "MCP", resourceType: "MCP", resourceName: "normal-tool" };

afterEach(() => { setSharedRedisJsonStore(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("retired conversation capabilities", () => {
  it("matches the backend type set without disabling unrelated names or scriptView", async () => {
    const java = await readFile(new URL("../../../../byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/resource/RetiredConversationResources.java", import.meta.url), "utf8");
    const types = java.match(/TYPES = Set\.of\(([^)]+)\)/)?.[1].match(/"[^"]+"/g)?.map((s) => s.slice(1, -1));
    expect(types).toEqual([...RETIRED_RESOURCE_TYPES]);
    for (const type of RETIRED_RESOURCE_TYPES) expect(isRetiredResourceType(` ${type.toLowerCase()} `)).toBe(true);
    for (const type of ["scriptView", "KG_DOC", "TOOL", "MCP", "AGENT", "Sales OBJECT", ""]) expect(isRetiredResourceType(type)).toBe(false);
  });

  it.each(RETIRED_RESOURCE_TYPES)("rejects explicit %s before discovery or remote execution", async (type) => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const result = await resolveCapability({ resourcesDir: "/unused", capabilityId: "11", resourceType: type.toLowerCase(), resourceContext: {}, authContext });
    expect(result).toMatchObject({ capability: null, retired: true });
    const executed = await executeMcp({ capability: { resource_type: type, metadata: {}, mcp: { server_url: "http://unused.invalid" } } as never, action: "run", parameters: {}, authContext });
    expect(executed).toMatchObject({ success: false, error_code: "RESOURCE_TYPE_RETIRED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(RETIRED_RESOURCE_TYPES)("checks actual %s snapshots despite a forged supported hint", async (type) => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const raw = { resourceId: "11", resourceBizType: type, resourceName: "retired snapshot" };
    setSharedRedisJsonStore({ getJsonByKey: async (key: string) => key === `${type}_11`
      ? { key, raw, content: JSON.stringify(raw), hash: "test" } : null } as never);
    const result = await resolveCapability({ resourcesDir: "/unused", capabilityId: "baiying_11", resourceType: "MCP", resourceContext: {}, authContext });
    expect(result).toMatchObject({ capability: null, retired: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an old context fallback and never substitutes a different root agent", async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const result = await resolveCapability({ resourcesDir: "/unused", capabilityId: "11", resourceType: "TOOL", resourceContext: { selected_resource: legacy[0] }, authContext });
    expect(result).toMatchObject({ retired: true });
    expect(buildDirectCapabilityStub({ capabilityId: "missing", resourceType: "AGENT", resourceContext: { root_agent: { resourceId: "root", agentSseUrl: "http://unused.invalid" } } })).toBeNull();
    expect(buildDirectCapabilityStub({ capabilityId: "missing", resourceType: "KG_DOC", resourceContext: { selected_resource: { resourceId: "other", resourceSourcePkId: "other-dataset" } } })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("filters old snapshots from adapted resources, tool descriptions and routing hints", async () => {
    const adapted = adaptAgentJson({ raw: { resourceId: "1", resourceName: "Example", relResourceList: [...legacy, normal] }, fileName: "DIG_EMPLOYEE_1.json", embedApiKeysFromJson: false });
    expect("error" in adapted).toBe(false);
    if ("error" in adapted) throw new Error(adapted.error);
    expect(adapted.associatedResources?.map((r) => r.resourceId)).toEqual(["21"]);
    const old = { ...adapted, associatedResources: [...legacy, normal] } as AdaptedManagedAgent;
    const texts = [buildBaiyingCallDescription({ agent: old }), buildToolsMd({ relResourceList: [...legacy, normal] }), buildAgentsMd({ relResourceList: [...legacy, normal] }), await buildSubagentRoutingMarkdown([old])];
    for (const text of texts) {
      for (const resource of legacy) expect(text).not.toContain(resource.resourceName);
      expect(text).toContain("normal-tool");
    }
  });

  it("does not execute another resource when an explicit id or name is missing", async () => {
    const adapted = adaptAgentJson({ raw: { resourceId: "1", resourceName: "Example", relResourceList: [normal] }, fileName: "DIG_EMPLOYEE_1.json", embedApiKeysFromJson: false });
    if ("error" in adapted) throw new Error(adapted.error);
    const registry = new AgentRegistryState(); registry.replaceAll([adapted]);
    const tool = createBaiyingCallToolFactory({ registry, executorPath: "/unused" })({ agentId: adapted.agentId, sessionKey: "agent:main:main" });
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    for (const request of [{ resource_id: "missing" }, { resource_name: "missing" }]) {
      await expect(tool.execute("test", { ...request, query: "hello" })).resolves.toMatchObject({ error_code: "CAPABILITY_NOT_FOUND" });
    }
    await expect(tool.execute("test", { resource_type: "VIEW", query: "hello" })).resolves.toMatchObject({ error_code: "RESOURCE_TYPE_RETIRED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes managed legacy instructions while preserving manually maintained files", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "byclaw-retirement-"));
    const adapted = adaptAgentJson({ raw: { resourceId: "1", resourceName: "Example", relResourceList: [...legacy, normal] }, fileName: "DIG_EMPLOYEE_1.json", embedApiKeysFromJson: false });
    if ("error" in adapted) throw new Error(adapted.error);
    adapted.sourceJson = { resourceId: "1", resourceName: "Example", relResourceList: [...legacy, normal] };
    await writeFile(path.join(workspace, "TOOLS.md"), `${MANAGED_SEED_MARKER}\nretired-0 legacy instructions`);
    await writeFile(path.join(workspace, "SOUL.md"), "My manually maintained persona");
    const api = { runtime: { config: { loadConfig: () => ({ agents: { list: [{ id: adapted.agentId, workspace }] } }) } } } as never;
    await seedManagedAgentWorkspace({ api, adapted });
    expect(await readFile(path.join(workspace, "TOOLS.md"), "utf8")).not.toContain("retired-0");
    expect(await readFile(path.join(workspace, "TOOLS.md"), "utf8")).toContain("normal-tool");
    expect(await readFile(path.join(workspace, "SOUL.md"), "utf8")).toBe("My manually maintained persona");
  });
});
