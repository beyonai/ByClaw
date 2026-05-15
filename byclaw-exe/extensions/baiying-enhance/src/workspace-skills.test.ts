import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

  it("keeps earlier skill groups first while de-duplicating", () => {
    expect(mergeSkillNames(["json", "shared"], ["alpha", "shared"], ["beta"])).toEqual([
      "json",
      "shared",
      "alpha",
      "beta",
    ]);
  });
});
