import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
type Run = (file: string, args: string[]) => Promise<{ stdout: string }>;

export function validateHubSkillZipEntryName(name: string): void {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)
      || normalized.split("/").some(part => part === "..")) throw new Error(`unsafe zip entry path: ${name}`);
}

// Older runtime images may have Python but no unzip. Validate every member before writing any files.
const PYTHON_EXTRACT = `import pathlib,zipfile,stat,sys,re
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as archive:
 entries=archive.infolist()
 if len(entries)>10000 or sum(e.file_size for e in entries)>512*1024*1024: raise ValueError("skill zip exceeds extraction limit")
 for e in entries:
  name=e.filename.replace(chr(92),"/")
  if not name or name.startswith("/") or re.match(r"^[a-zA-Z]:",name) or ".." in name.split("/"): raise ValueError("unsafe zip entry path")
  if stat.S_ISLNK(e.external_attr>>16): raise ValueError("skill zip symlink is not supported")
  target=(root/name).resolve()
  if root not in target.parents and target!=root: raise ValueError("unsafe zip entry path")
 for e in entries:
  name=e.filename.replace(chr(92),"/")
  target=root/name
  if e.is_dir(): target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   with archive.open(e) as src, target.open("wb") as dst:
    while True:
     block=src.read(1024*1024)
     if not block: break
     dst.write(block)
   mode=(e.external_attr>>16)&0o777
   if mode: target.chmod(mode)
`;

export async function extractHubSkillZip(zipPath: string, extractDir: string,
  run: Run = async (file, args) => exec(file, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 60_000 })) {
  try {
    const { stdout } = await run("unzip", ["-Z", "-1", zipPath]);
    for (const line of stdout.split(/\r?\n/)) if (line.trim()) validateHubSkillZipEntryName(line.trim());
    await run("unzip", ["-q", zipPath, "-d", extractDir]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    await run("python3", ["-c", PYTHON_EXTRACT, zipPath, extractDir]);
  }
}
