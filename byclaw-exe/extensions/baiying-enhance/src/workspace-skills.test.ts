import { promises as fs } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mergeSkillNames,
  mergeWorkspaceSkillsIntoManagedAgents,
  scanWorkspaceSkillNames,
} from "./workspace-skills.js";

describe("workspace-skills", () => {
  const originalOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;

  afterEach(() => {
    if (originalOpenClawStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalOpenClawStateDir;
    }
  });

  it("scans only one-level skills with SKILL.md", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-skills-"));
    await mkdir(path.join(workspace, "skills", "zeta"), { recursive: true });
    await writeFile(path.join(workspace, "skills", "zeta", "SKILL.md"), "# Zeta\n", "utf8");
    await writeFile(path.join(workspace, "skills", "zeta", "README.md"), "# ignored\n", "utf8");
    await mkdir(path.join(workspace, "skills", "alpha"), { recursive: true });
    await writeFile(path.join(workspace, "skills", "alpha", "SKILL.md"), "# Alpha\n", "utf8");
    await mkdir(path.join(workspace, "skills", "nested", "path"), { recursive: true });
    await writeFile(path.join(workspace, "skills", "nested", "path", "SKILL.md"), "# Nested\n", "utf8");
    await mkdir(path.join(workspace, "skills", "missing-doc"), { recursive: true });
    await mkdir(path.join(workspace, "skills", ".hidden"), { recursive: true });
    await writeFile(path.join(workspace, "skills", ".hidden", "SKILL.md"), "# Hidden\n", "utf8");

    await expect(scanWorkspaceSkillNames(workspace)).resolves.toEqual(["alpha", "zeta"]);
  });

  it("falls back to stat when a FUSE mount returns unknown dirent types", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-skills-fuse-"));
    const skillsDir = path.join(workspace, "skills");
    await mkdir(path.join(skillsDir, "alpha"), { recursive: true });
    await writeFile(path.join(skillsDir, "alpha", "SKILL.md"), "# Alpha\n", "utf8");
    await mkdir(path.join(skillsDir, "zeta"), { recursive: true });
    await writeFile(path.join(skillsDir, "zeta", "SKILL.md"), "# Zeta\n", "utf8");
    await writeFile(path.join(skillsDir, "loose-file"), "ignored\n", "utf8");

    const realReaddir = fs.readdir.bind(fs);
    const spy = vi.spyOn(fs, "readdir").mockImplementation(async (target, options) => {
      if (String(target) === skillsDir && (options as { withFileTypes?: boolean } | undefined)?.withFileTypes) {
        return [
          { name: "zeta", isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false },
          { name: "alpha", isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false },
          { name: "loose-file", isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false },
        ] as any;
      }
      return realReaddir(target as any, options as any) as any;
    });

    try {
      await expect(scanWorkspaceSkillNames(workspace)).resolves.toEqual(["alpha", "zeta"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("uses SKILL.md frontmatter name as the OpenClaw skill filter name", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-skills-name-"));
    await mkdir(path.join(workspace, "skills", "uploaded-folder"), { recursive: true });
    await writeFile(
      path.join(workspace, "skills", "uploaded-folder", "SKILL.md"),
      "---\nname: weread-skills\ndescription: Read and organize WeRead notes\n---\n# WeRead\n",
      "utf8",
    );

    await expect(scanWorkspaceSkillNames(workspace)).resolves.toEqual(["weread-skills"]);
  });

  it("keeps earlier skill groups first while de-duplicating", () => {
    expect(mergeSkillNames(["json", "shared"], ["alpha", "shared"], ["beta"])).toEqual([
      "json",
      "shared",
      "alpha",
      "beta",
    ]);
  });

  it("merges path-based extra skills using SKILL.md frontmatter names", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-extra-skills-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-plugin-skills-state-"));
    const sharedWorkspace = await mkdtemp(path.join(tmpdir(), "baiying-extra-shared-skills-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    await mkdir(path.join(workspace, "skills", "uploaded-folder"), { recursive: true });
    await writeFile(
      path.join(workspace, "skills", "uploaded-folder", "SKILL.md"),
      "---\nname: extra-filter-name\n---\n# Extra\n",
      "utf8",
    );
    await mkdir(path.join(sharedWorkspace, "skills", "shared-extra"), { recursive: true });
    await writeFile(
      path.join(sharedWorkspace, "skills", "shared-extra", "SKILL.md"),
      "---\nname: shared-extra-filter\n---\n# Shared\n",
      "utf8",
    );
    await mkdir(path.join(workspace, "skills", "workspace-only"), { recursive: true });
    await writeFile(path.join(workspace, "skills", "workspace-only", "SKILL.md"), "# Workspace\n", "utf8");
    await mkdir(path.join(stateDir, "plugin-skills", "plugin-extra"), { recursive: true });
    await writeFile(
      path.join(stateDir, "plugin-skills", "plugin-extra", "SKILL.md"),
      "---\nname: plugin-extra-filter\n---\n# Plugin Extra\n",
      "utf8",
    );

    const api = {
      runtime: {
        config: {
          loadConfig: () => ({
            agents: {
              list: [{ id: "baiying-agent-1", workspace }],
            },
          }),
        },
      },
    } as any;

    await expect(
      mergeWorkspaceSkillsIntoManagedAgents({
        api,
        managed: [
          {
            agentId: "baiying-agent-1",
            listEntry: { id: "baiying-agent-1", skills: ["json-skill"] },
            extraSkillPaths: [
              `${workspace}/skills/uploaded-folder/SKILL.md`,
              `${workspace}/skills/missing-extra`,
              `${sharedWorkspace}/skills/shared-extra`,
              `${stateDir}/plugin-skills/plugin-extra`,
            ],
          },
        ],
        includeMainShared: false,
        mainParentAgentId: "main",
      }),
    ).resolves.toMatchObject([
      {
        listEntry: {
          skills: [
            "project-context",
            "notice",
            "project-cloud-knowledge",
            "json-skill",
            "extra-filter-name",
            "missing-extra",
            "shared-extra-filter",
            "plugin-extra-filter",
            "workspace-only",
          ],
        },
      },
    ]);
  });

  it("refreshes an explicitly managed bundled connector skill before enabling a stale workspace copy", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-managed-connector-workspace-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-managed-connector-state-"));
    const bundledSkillsDir = await mkdtemp(path.join(tmpdir(), "baiying-bundled-skills-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const workspaceSkillDir = path.join(workspace, "skills", "dws");
    const bundledSkillDir = path.join(bundledSkillsDir, "dws");
    await mkdir(path.join(workspaceSkillDir, "scripts"), { recursive: true });
    await mkdir(path.join(bundledSkillDir, "scripts"), { recursive: true });
    await writeFile(path.join(workspaceSkillDir, "SKILL.md"), "---\nname: dws\n---\n# stale\n", "utf8");
    await writeFile(path.join(workspaceSkillDir, "scripts", "connector-auth-sync.mjs"), "// stale\n", "utf8");
    await writeFile(path.join(workspaceSkillDir, "scripts", "removed-legacy-helper.mjs"), "// obsolete\n", "utf8");
    await writeFile(
      path.join(bundledSkillDir, "SKILL.md"),
      "---\nname: dws\nbyclaw_managed: true\n---\n# current\n",
      "utf8",
    );
    await writeFile(path.join(bundledSkillDir, "scripts", "connector-auth-sync.mjs"), "// current\n", "utf8");

    const api = {
      runtime: {
        config: {
          loadConfig: () => ({ agents: { list: [{ id: "baiying-agent-1", workspace }] } }),
        },
      },
    } as any;

    const input = {
      api,
      managed: [
        {
          agentId: "baiying-agent-1",
          listEntry: { id: "baiying-agent-1", skills: ["dws"] },
        },
      ],
      includeMainShared: false,
      mainParentAgentId: "main",
      bundledSkillsDir,
    };
    const copySpy = vi.spyOn(fs, "cp");

    await mergeWorkspaceSkillsIntoManagedAgents(input);
    await mergeWorkspaceSkillsIntoManagedAgents(input);

    await expect(fs.readFile(path.join(workspaceSkillDir, "SKILL.md"), "utf8")).resolves.toContain("# current");
    await expect(
      fs.readFile(path.join(workspaceSkillDir, "scripts", "connector-auth-sync.mjs"), "utf8"),
    ).resolves.toContain("// current");
    await expect(fs.access(path.join(workspaceSkillDir, "scripts", "removed-legacy-helper.mjs"))).rejects.toThrow();
    expect(copySpy).toHaveBeenCalledTimes(1);
    copySpy.mockRestore();
  });

  it("enables platform core skills for every managed agent", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-project-context-workspace-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-project-context-state-"));
    const bundledSkillsDir = await mkdtemp(path.join(tmpdir(), "baiying-project-context-bundled-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    for (const [skillName, title] of [
      ["project-context", "Project Context"],
      ["notice", "Notice"],
      ["project-cloud-knowledge", "Project Cloud Knowledge"],
    ]) {
      const bundledSkillDir = path.join(bundledSkillsDir, skillName);
      await mkdir(bundledSkillDir, { recursive: true });
      await writeFile(
        path.join(bundledSkillDir, "SKILL.md"),
        `---\nname: ${skillName}\nbyclaw_managed: true\n---\n# ${title}\n`,
        "utf8",
      );
    }
    const api = {
      runtime: {
        config: {
          loadConfig: () => ({ agents: { list: [{ id: "baiying-agent-1", workspace }] } }),
        },
      },
    } as any;

    const result = await mergeWorkspaceSkillsIntoManagedAgents({
      api,
      managed: [{ agentId: "baiying-agent-1", listEntry: { id: "baiying-agent-1", skills: [] } }],
      includeMainShared: false,
      mainParentAgentId: "main",
      bundledSkillsDir,
    });

    expect(result[0]?.listEntry.skills).toEqual([
      "project-context",
      "notice",
      "project-cloud-knowledge",
    ]);
    await expect(
      fs.readFile(path.join(workspace, "skills", "project-context", "SKILL.md"), "utf8"),
    ).resolves.toContain("# Project Context");
    await expect(
      fs.readFile(path.join(workspace, "skills", "notice", "SKILL.md"), "utf8"),
    ).resolves.toContain("# Notice");
    await expect(
      fs.readFile(path.join(workspace, "skills", "project-cloud-knowledge", "SKILL.md"), "utf8"),
    ).resolves.toContain("# Project Cloud Knowledge");
  });

  it("leaves ordinary and future connector skills untouched unless the bundled skill explicitly opts in", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-unmanaged-connector-workspace-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-unmanaged-connector-state-"));
    const bundledSkillsDir = await mkdtemp(path.join(tmpdir(), "baiying-unmanaged-bundled-skills-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    const workspaceSkillDir = path.join(workspace, "skills", "future-connector");
    const bundledSkillDir = path.join(bundledSkillsDir, "future-connector");
    await mkdir(workspaceSkillDir, { recursive: true });
    await mkdir(bundledSkillDir, { recursive: true });
    await writeFile(path.join(workspaceSkillDir, "SKILL.md"), "---\nname: future-connector\n---\n# user copy\n", "utf8");
    await writeFile(path.join(bundledSkillDir, "SKILL.md"), "---\nname: future-connector\n---\n# bundled copy\n", "utf8");

    const api = {
      runtime: {
        config: {
          loadConfig: () => ({ agents: { list: [{ id: "baiying-agent-2", workspace }] } }),
        },
      },
    } as any;

    await mergeWorkspaceSkillsIntoManagedAgents({
      api,
      managed: [{
        agentId: "baiying-agent-2",
        listEntry: { id: "baiying-agent-2", skills: [] },
        extraSkillPaths: [workspaceSkillDir],
      }],
      includeMainShared: false,
      mainParentAgentId: "main",
      bundledSkillsDir,
    });

    await expect(fs.readFile(path.join(workspaceSkillDir, "SKILL.md"), "utf8")).resolves.toContain("# user copy");
  });

  it("resolves declared skill codes against OPENCLAW_STATE_DIR/plugin-skills", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "baiying-plugin-skills-workspace-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-plugin-skills-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    await mkdir(path.join(stateDir, "plugin-skills", "inner-dir-code"), { recursive: true });
    await writeFile(
      path.join(stateDir, "plugin-skills", "inner-dir-code", "SKILL.md"),
      "---\nname: inner-filter-name\n---\n# Inner\n",
      "utf8",
    );
    await mkdir(path.join(stateDir, "plugin-skills", "unused-plugin-skill"), { recursive: true });
    await writeFile(
      path.join(stateDir, "plugin-skills", "unused-plugin-skill", "SKILL.md"),
      "---\nname: unused-filter-name\n---\n# Unused\n",
      "utf8",
    );

    const api = {
      runtime: {
        config: {
          loadConfig: () => ({
            agents: {
              list: [{ id: "baiying-agent-1", workspace }],
            },
          }),
        },
      },
    } as any;

    await expect(
      mergeWorkspaceSkillsIntoManagedAgents({
        api,
        managed: [
          {
            agentId: "baiying-agent-1",
            listEntry: { id: "baiying-agent-1", skills: ["inner-dir-code"] },
          },
        ],
        includeMainShared: false,
        mainParentAgentId: "main",
      }),
    ).resolves.toMatchObject([
      {
        listEntry: {
          skills: ["project-context", "notice", "project-cloud-knowledge", "inner-filter-name"],
        },
      },
    ]);
  });
});
