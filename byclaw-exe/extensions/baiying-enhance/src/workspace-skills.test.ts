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
          skills: ["inner-filter-name"],
        },
      },
    ]);
  });
});
