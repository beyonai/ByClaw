import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** 私有持久卷的文件存储；通过同步临时文件和原子替换防止任务记录被写成半份 JSON。 */
export class JsonStore {
  constructor(readonly directory: string) {}
  path(name: string): string {
    if (!/^[A-Za-z0-9_.:-]+$/.test(name) || name.includes(".."))
      throw new Error("Invalid state file");
    return join(this.directory, name);
  }
  async read<T>(name: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.path(name), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  async write(name: string, value: unknown): Promise<void> {
    await this.bytes(name, Buffer.from(JSON.stringify(value)));
  }
  /** 先同步文件内容，再重命名并同步目录；完成后上层才能确认任务已持久受理。 */
  async bytes(name: string, content: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(name),
      temporary = `${target}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async names(): Promise<string[]> {
    try {
      return await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async remove(name: string): Promise<void> {
    await rm(this.path(name), { force: true });
  }
}
