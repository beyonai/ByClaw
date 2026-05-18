import { promises as fs } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mergeSkillNames, scanWorkspaceSkillNames } from "./workspace-skills.js";

describe("workspace-skills", () => {
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

  it("keeps earlier skill groups first while de-duplicating", () => {
    expect(mergeSkillNames(["json", "shared"], ["alpha", "shared"], ["beta"])).toEqual([
      "json",
      "shared",
      "alpha",
      "beta",
    ]);
  });
});
