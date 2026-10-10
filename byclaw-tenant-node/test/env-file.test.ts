import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnv } from "../src/env-file.js";

const key = "TENANT_NODE_ENV_FILE_TEST";
let directory: string;
let original: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "tenant-node-env-"));
  original = process.env[key];
  delete process.env[key];
});
afterEach(async () => {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
  await rm(directory, { recursive: true, force: true });
});

describe("local environment loading", () => {
  it("loads the specified file without depending on the working directory", async () => {
    const path = join(directory, ".env");
    await writeFile(path, `${key}=from-file\n`);
    loadLocalEnv(path);
    expect(process.env[key]).toBe("from-file");
  });
  it("preserves environment variables injected by the container or debugger", async () => {
    const path = join(directory, ".env");
    await writeFile(path, `${key}=from-file\n`);
    process.env[key] = "injected";
    loadLocalEnv(path);
    expect(process.env[key]).toBe("injected");
  });
  it("allows startup without a local file", () => {
    expect(() => loadLocalEnv(join(directory, "missing.env"))).not.toThrow();
    expect(process.env[key]).toBeUndefined();
  });
  it("does not hide other file loading errors", () => {
    expect(() => loadLocalEnv(directory)).toThrow();
  });
});
