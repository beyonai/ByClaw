import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveConnectorSkillFilter,
  setConnectorSkillFilterResolver,
} from "../../shared/src/connector-skill-filter-runtime.js";
import {
  createConnectorSkillFilterResolver,
  filterRegisteredSkills,
  loadVisibleSkillNamesFromOpenClawRoots,
  registerConnectorSkillFilterProvider,
} from "./connector-skill-filter.js";

const originalOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;
const originalBundledSkillsDir = process.env.OPENCLAW_BUNDLED_SKILLS_DIR;
const originalBundledPluginsDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;

async function writeSkill(root: string, directory: string, name = directory): Promise<void> {
  await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(
    path.join(root, directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: test\n---\n`,
    "utf8",
  );
}

describe("connector skill filter runtime", () => {
  afterEach(() => {
    setConnectorSkillFilterResolver(undefined);
    if (originalOpenClawStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalOpenClawStateDir;
    }
    if (originalBundledSkillsDir === undefined) {
      delete process.env.OPENCLAW_BUNDLED_SKILLS_DIR;
    } else {
      process.env.OPENCLAW_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
    }
    if (originalBundledPluginsDir === undefined) {
      delete process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = originalBundledPluginsDir;
    }
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
    if (originalOpenClawStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalOpenClawStateDir;
    }
    if (originalBundledSkillsDir === undefined) {
      delete process.env.OPENCLAW_BUNDLED_SKILLS_DIR;
    } else {
      process.env.OPENCLAW_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
    }
    if (originalBundledPluginsDir === undefined) {
      delete process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = originalBundledPluginsDir;
    }
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

  it("uses the shared default skill filter when the agent has no explicit filter", async () => {
    const cfg = {
      agents: {
        defaults: { skills: ["dws", "fws", "ordinary-skill"] },
        list: [{ id: "main" }],
      },
    };
    const loadVisibleSkillNames = vi.fn(async () => ["should-not-load"]);
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
    expect(loadVisibleSkillNames).not.toHaveBeenCalled();
  });

  it("loads skill names from OpenClaw standard, configured, and bundled roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baiying-visible-skills-"));
    const stateDir = path.join(root, "state");
    const workspaceDir = path.join(root, "workspace");
    const extraDir = path.join(root, "extra");
    const directExtraDir = path.join(root, "direct-extra-skill");
    const bundledDir = path.join(root, "bundled");
    const pluginRoot = path.join(root, "plugin");
    const bundledPluginsDir = path.join(root, "bundled-plugins");
    const bundledPluginRoot = path.join(bundledPluginsDir, "bundled-plugin");
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_BUNDLED_SKILLS_DIR = bundledDir;
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledPluginsDir;

    await writeSkill(path.join(workspaceDir, "skills"), "workspace-skill");
    await writeSkill(path.join(workspaceDir, ".agents", "skills"), "project-skill");
    await writeSkill(path.join(stateDir, "skills"), "managed-skill");
    await writeSkill(path.join(stateDir, "plugin-skills"), "plugin-skill");
    await writeSkill(extraDir, "extra-skill");
    await writeSkill(root, "direct-extra-skill", "direct-extra-skill");
    await writeSkill(bundledDir, "bundled-skill");
    await writeSkill(path.join(pluginRoot, "skills"), "manifest-plugin-skill");
    await writeFile(
      path.join(pluginRoot, "openclaw.plugin.json"),
      JSON.stringify({ id: "test-plugin", skills: ["./skills"] }),
      "utf8",
    );
    await writeSkill(path.join(bundledPluginRoot, "skills"), "bundled-plugin-skill");
    await writeFile(
      path.join(bundledPluginRoot, "openclaw.plugin.json"),
      JSON.stringify({ id: "bundled-plugin", skills: ["./skills"] }),
      "utf8",
    );

    await expect(
      loadVisibleSkillNamesFromOpenClawRoots({
        agentId: "main",
        config: {
          plugins: { load: { paths: [pluginRoot] } },
          skills: { load: { extraDirs: [extraDir, directExtraDir] } },
        },
        workspaceDir,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        "workspace-skill",
        "project-skill",
        "managed-skill",
        "plugin-skill",
        "extra-skill",
        "direct-extra-skill",
        "bundled-skill",
        "manifest-plugin-skill",
        "bundled-plugin-skill",
      ]),
    );
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
