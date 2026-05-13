import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { buildSubagentRoutingMarkdown, SUBAGENT_ROUTING_MARKER } from "./subagent-routing-seed.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

describe("buildSubagentRoutingMarkdown", () => {
  it("marks output and lists empty-registry message when no managed agents", async () => {
    const md = await buildSubagentRoutingMarkdown([]);
    expect(md.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
    expect(md).toContain("No `baiying-agent-*`");
    expect(md).toContain("agents_list");
  });

  it("includes agentId and integration notes for a managed agent", async () => {
    const agentId = `${MANAGED_AGENT_PREFIX}42`;
    const adapted: AdaptedManagedAgent = {
      sourceKey: "42",
      agentId,
      providerKey: "",
      modelRef: "",
      allowSpawnFrom: ["main"],
      listEntry: { id: agentId, name: "CRM Bot", identity: { name: "CRM Bot" } },
      systemPrompt: "You help with CRM exports.",
      integrationType: "NONE",
      coreCompetencies: [
        {
          coreCompetency: "Reports",
          description: "Build reports",
          acceptBoundary: ["revenue queries"],
          rejectBoundary: ["password resets"],
          example: ["Top 10 customers"],
        },
      ],
      associatedResources: [
        {
          resourceId: "r1",
          resourceName: "Sales DB",
          resourceType: "OBJECT",
          resourceDesc: "Query sales",
        },
      ],
    };
    const md = await buildSubagentRoutingMarkdown([adapted]);
    expect(md).toContain(`\`${agentId}\``);
    expect(md).toContain("CRM Bot");
    expect(md).toContain("revenue queries");
    expect(md).not.toMatch(/\*\*res\*\*:/);
  });

  it("reads resourceDesc from Baiying detail JSON on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baiying-route-"));
    const jsonPath = path.join(dir, "agent.json");
    await writeFile(
      jsonPath,
      JSON.stringify({
        resourceId: "99",
        resourceName: "Detail Agent",
        resourceDesc: "Handles procurement workflows only.",
        integrationType: "INTERFACE",
      }),
      "utf8",
    );
    const agentId = `${MANAGED_AGENT_PREFIX}99`;
    const adapted: AdaptedManagedAgent = {
      sourceKey: "99",
      agentId,
      providerKey: "",
      modelRef: "",
      allowSpawnFrom: ["main"],
      listEntry: { id: agentId, name: "Detail Agent", identity: { name: "Detail Agent" } },
      systemPrompt: "fallback",
      integrationType: "INTERFACE",
      sourceFilePath: jsonPath,
    };
    const md = await buildSubagentRoutingMarkdown([adapted]);
    expect(md).toContain("procurement");
    expect(md).toContain("INTERFACE");
  });
});
