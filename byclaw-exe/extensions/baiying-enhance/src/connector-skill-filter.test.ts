import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveConnectorSkillFilter,
  setConnectorSkillFilterResolver,
} from "../../shared/src/connector-skill-filter-runtime.js";
import {
  createConnectorSkillFilterResolver,
  filterRegisteredSkills,
  registerConnectorSkillFilterProvider,
} from "./connector-skill-filter.js";

describe("connector skill filter runtime", () => {
  afterEach(() => {
    setConnectorSkillFilterResolver(undefined);
  });

  it("shares a connector skill filter resolver across extension bundles", async () => {
    setConnectorSkillFilterResolver(undefined);
    await expect(
      resolveConnectorSkillFilter({
        agentId: "baiying-agent-1",
        disabledConnectorSkills: ["fws"],
      }),
    ).resolves.toBeUndefined();

    const resolver = vi.fn(async () => ["dws", "ordinary-skill"]);
    setConnectorSkillFilterResolver(resolver);

    await expect(
      resolveConnectorSkillFilter({
        agentId: "baiying-agent-1",
        disabledConnectorSkills: ["fws"],
      }),
    ).resolves.toEqual(["dws", "ordinary-skill"]);
    expect(resolver).toHaveBeenCalledWith({
      agentId: "baiying-agent-1",
      disabledConnectorSkills: ["fws"],
    });
  });
});

describe("connector skill filter provider", () => {
  afterEach(() => {
    setConnectorSkillFilterResolver(undefined);
  });

  it("removes disabled connectors from the live registered agent skills", async () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "baiying-agent-1",
            skills: ["dws", "fws", "ordinary-skill"],
          },
        ],
      },
    };
    const resolver = createConnectorSkillFilterResolver({
      api: {
        runtime: {
          config: { current: () => cfg, loadConfig: () => cfg },
          agent: { resolveAgentWorkspaceDir: () => "/workspace" },
        },
      } as any,
    });

    await expect(
      resolver({
        agentId: "baiying-agent-1",
        disabledConnectorSkills: ["fws"],
      }),
    ).resolves.toEqual(["dws", "ordinary-skill"]);
    expect(cfg.agents.list[0].skills).toEqual(["dws", "fws", "ordinary-skill"]);
  });

  it("normalizes registered skills and ignores unknown disabled names", () => {
    expect(
      filterRegisteredSkills(
        [" dws ", "dws", "ordinary-skill", ""],
        ["unknown"],
      ),
    ).toEqual(["dws", "ordinary-skill"]);
  });

  it("uses visible workspace skills when the agent has no explicit filter", async () => {
    const loadVisibleSkillNames = vi.fn(async () => ["dws", "fws", "ordinary-skill"]);
    const cfg = { agents: { list: [{ id: "main" }] } };
    const resolver = createConnectorSkillFilterResolver({
      api: {
        runtime: {
          config: { current: () => cfg, loadConfig: () => cfg },
          agent: { resolveAgentWorkspaceDir: () => "/workspace-main" },
        },
      } as any,
      loadVisibleSkillNames,
    });

    await expect(
      resolver({ agentId: "main", disabledConnectorSkills: ["fws"] }),
    ).resolves.toEqual(["dws", "ordinary-skill"]);
    expect(loadVisibleSkillNames).toHaveBeenCalledWith({
      agentId: "main",
      config: cfg,
      workspaceDir: "/workspace-main",
    });
  });

  it("keeps concurrent session filters isolated", async () => {
    const cfg = {
      agents: {
        list: [{ id: "baiying-agent-1", skills: ["dws", "fws", "ordinary-skill"] }],
      },
    };
    const resolver = createConnectorSkillFilterResolver({
      api: {
        runtime: {
          config: { current: () => cfg, loadConfig: () => cfg },
          agent: { resolveAgentWorkspaceDir: () => "/workspace" },
        },
      } as any,
    });

    await expect(
      Promise.all([
        resolver({ agentId: "baiying-agent-1", disabledConnectorSkills: ["dws"] }),
        resolver({ agentId: "baiying-agent-1", disabledConnectorSkills: ["fws"] }),
      ]),
    ).resolves.toEqual([
      ["fws", "ordinary-skill"],
      ["dws", "ordinary-skill"],
    ]);
    expect(cfg.agents.list[0].skills).toEqual(["dws", "fws", "ordinary-skill"]);
  });

  it("registers the provider on the shared runtime contract", async () => {
    const cfg = {
      agents: { list: [{ id: "baiying-agent-1", skills: ["dws", "fws"] }] },
    };
    registerConnectorSkillFilterProvider({
      runtime: {
        config: { current: () => cfg, loadConfig: () => cfg },
        agent: { resolveAgentWorkspaceDir: () => "/workspace" },
      },
    } as any);

    await expect(
      resolveConnectorSkillFilter({
        agentId: "baiying-agent-1",
        disabledConnectorSkills: ["fws"],
      }),
    ).resolves.toEqual(["dws"]);
  });
});
