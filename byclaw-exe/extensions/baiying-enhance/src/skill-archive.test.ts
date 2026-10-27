import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { extractHubSkillZip } from "./skill-archive.js";
const exec = promisify(execFile);
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "skill-archive-")); await mkdir(path.join(root, "out")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const runWithoutUnzip = async (file: string, args: string[]) => {
  if (file === "unzip") throw Object.assign(new Error("spawn unzip ENOENT"), { code: "ENOENT" });
  return exec(file, args, { encoding: "utf8" });
};
async function zip(name: string) {
  const filename = path.join(root, "skill.zip");
  await exec("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr(sys.argv[2],'skill contents'); z.close()", filename, name]);
  return filename;
}
it("prepares a real package through Python when unzip is absent", async () => {
  await extractHubSkillZip(await zip("example/SKILL.md"), path.join(root, "out"), runWithoutUnzip);
  expect(await readFile(path.join(root, "out/example/SKILL.md"), "utf8")).toBe("skill contents");
});
it.each(["../escape", "/absolute", "C:/drive", "folder/../../escape", "folder\\..\\..\\escape"])("rejects unsafe fallback entry %s before extraction", async (name) => {
  await expect(extractHubSkillZip(await zip(name), path.join(root, "out"), runWithoutUnzip)).rejects.toThrow("unsafe zip entry path");
});
it("does not retry a corrupt archive or permission failure through another extractor", async () => {
  const run = vi.fn(async () => { throw Object.assign(new Error("invalid zip"), { code: 9 }); });
  await expect(extractHubSkillZip("bad.zip", "out", run)).rejects.toThrow("invalid zip");
  expect(run).toHaveBeenCalledTimes(1);
});

it("preserves executable bits without restoring special Unix mode bits", async () => {
  const filename = path.join(root, "executable.zip");
  await exec("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); i=zipfile.ZipInfo('run.sh'); i.external_attr=0o104755<<16; z.writestr(i,'#!/bin/sh'); z.close()", filename]);
  await extractHubSkillZip(filename, path.join(root, "out"), runWithoutUnzip);
  expect((await stat(path.join(root, "out/run.sh"))).mode & 0o7777).toBe(0o755);
});
