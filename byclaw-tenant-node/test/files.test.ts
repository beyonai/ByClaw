import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/infrastructure/files/json-store.js";
import { SchemaTaskFiles } from "../src/infrastructure/schema/task-files.js";
import { task } from "./fixtures.js";
describe("durable task files", () => {
  it("writes private atomic state and cleans only bundle artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tenant-node-test-"));
    try {
      const store = new JsonStore(dir),
        files = new SchemaTaskFiles(store),
        t = task();
      await files.saveBundle(t, Buffer.from("zip"));
      await store.write("receipt.json", { auditId: t.auditId });
      expect((await stat(store.path(`${t.auditId}.zip`))).mode & 0o777).toBe(0o600);
      expect(Buffer.from(await files.loadBundle(t)).toString()).toBe("zip");
      await files.cleanup(t);
      expect(await store.read("receipt.json")).toEqual({ auditId: t.auditId });
      expect(await store.names()).toEqual(["receipt.json"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
  it("rejects path traversal", () => {
    const store = new JsonStore("/tmp");
    expect(() => store.path("../secret")).toThrow();
  });
});
