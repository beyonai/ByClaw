import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INDEX_FILENAME,
  INDEX_VERSION,
  loadAgentContentIndex,
  resolveDefaultContentIndexPath,
  saveAgentContentIndex,
} from "./agent-content-index.js";

describe("agent-content-index", () => {
  it("resolveDefaultContentIndexPath is under state dir and stable per agent dir", () => {
    const p1 = resolveDefaultContentIndexPath("/state/.openclaw", "/data/agents/a");
    const p2 = resolveDefaultContentIndexPath("/state/.openclaw", "/data/agents/a");
    const p3 = resolveDefaultContentIndexPath("/state/.openclaw", "/data/agents/b");
    expect(p1).toBe(p2);
    expect(p1).toContain("baiying-enhance");
    expect(p1).toMatch(/agent-content-index-[0-9a-f]{16}\.json$/);
    expect(p1).not.toBe(p3);
  });

  it("returns empty map when file is missing", async () => {
    const m = await loadAgentContentIndex(path.join(tmpdir(), "no-such-index.json"));
    expect(m.size).toBe(0);
  });

  it("returns empty map for corrupt JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baiying-idx-"));
    const p = path.join(dir, DEFAULT_INDEX_FILENAME);
    await writeFile(p, "{ not json", "utf8");
    const cap = captureWarns();
    const m = await loadAgentContentIndex(p, { warn: cap.warn });
    expect(m.size).toBe(0);
    expect(cap.messages.length).toBeGreaterThan(0);
  });

  it("returns empty map for version mismatch", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baiying-idx-"));
    const p = path.join(dir, DEFAULT_INDEX_FILENAME);
    await writeFile(
      p,
      JSON.stringify({ version: 999, entries: { "baiying-agent-1": "abc" } }),
      "utf8",
    );
    const cap = captureWarns();
    const m = await loadAgentContentIndex(p, { warn: cap.warn });
    expect(m.size).toBe(0);
  });

  it("save then load round-trip", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baiying-idx-"));
    const p = path.join(dir, DEFAULT_INDEX_FILENAME);
    const entries = new Map<string, string>([
      ["baiying-agent-1", "aa".repeat(32)],
      ["baiying-agent-2", "bb".repeat(32)],
    ]);
    await saveAgentContentIndex(p, entries);
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw) as { version: number; entries: Record<string, string> };
    expect(parsed.version).toBe(INDEX_VERSION);
    expect(parsed.entries["baiying-agent-1"]).toBe(entries.get("baiying-agent-1"));

    const loaded = await loadAgentContentIndex(p);
    expect(loaded.size).toBe(2);
    expect(loaded.get("baiying-agent-1")).toBe(entries.get("baiying-agent-1"));
  });

  it("atomic save replaces file content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baiying-idx-"));
    const p = path.join(dir, DEFAULT_INDEX_FILENAME);
    const h = createHash("sha256").update("x").digest("hex");
    await saveAgentContentIndex(p, new Map([["a", h]]));
    const h2 = createHash("sha256").update("y").digest("hex");
    await saveAgentContentIndex(p, new Map([["a", h2]]));
    const loaded = await loadAgentContentIndex(p);
    expect(loaded.get("a")).toBe(h2);
  });
});

function captureWarns() {
  const messages: string[] = [];
  return {
    warn: (m: string) => {
      messages.push(m);
    },
    messages,
  };
}
