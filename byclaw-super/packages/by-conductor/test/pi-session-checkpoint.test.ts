import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  InvalidPiSessionCheckpointError,
  exportPiSessionCheckpoint,
  materializePiSessionCheckpoint,
} from "../src/pi-session-checkpoint.js";

describe("Pi session checkpoint", () => {
  it("round-trips native messages, delegateAgent results and compaction", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "byclaw-pi-source-"));
    const restoredDir = await mkdtemp(join(tmpdir(), "byclaw-pi-restored-"));
    const sessionId = randomUUID();
    const source = SessionManager.create("/srv/byclaw-super", sourceDir, {
      id: sessionId,
    });
    const firstUserEntryId = source.appendMessage({
      role: "user",
      content: "请调用数据分析员工",
      timestamp: 1,
    });
    source.appendMessage({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "delegateAgent",
          arguments: { agentId: "1001", task: "分析数据" },
        },
      ],
      api: "openai-completions",
      provider: "test-provider",
      model: "test-model",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 2,
    });
    source.appendMessage({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "delegateAgent",
      content: [{ type: "text", text: "{\"status\":\"completed\",\"output\":\"42\"}" }],
      isError: false,
      timestamp: 3,
    });
    source.appendCompaction("用户要求分析数据，数字员工返回 42。", firstUserEntryId, 25);

    const checkpoint = exportPiSessionCheckpoint(source);
    const { manager: restored, filePath } = await materializePiSessionCheckpoint(
      checkpoint,
      {
        directory: restoredDir,
        cwdOverride: "/srv/byclaw-super",
      },
    );

    expect(restored.getSessionId()).toBe(sessionId);
    expect(restored.getEntries()).toEqual(source.getEntries());
    expect(restored.getLeafId()).toBe(source.getLeafId());
    expect(restored.buildSessionContext()).toEqual(source.buildSessionContext());
    expect(await readFile(filePath, "utf8")).toContain('"type":"compaction"');
    expect((await stat(restoredDir)).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("keeps two users' business sessions in different native Pi files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "byclaw-pi-users-"));
    const first = SessionManager.create("/srv/byclaw-super", directory, {
      id: randomUUID(),
    });
    const second = SessionManager.create("/srv/byclaw-super", directory, {
      id: randomUUID(),
    });
    first.appendMessage({ role: "user", content: "user-a-secret", timestamp: 1 });
    second.appendMessage({ role: "user", content: "user-b-secret", timestamp: 1 });

    const firstRestored = await materializePiSessionCheckpoint(
      exportPiSessionCheckpoint(first),
      {
        directory: join(directory, "instance-a"),
        cwdOverride: "/srv/byclaw-super",
      },
    );
    const secondRestored = await materializePiSessionCheckpoint(
      exportPiSessionCheckpoint(second),
      {
        directory: join(directory, "instance-b"),
        cwdOverride: "/srv/byclaw-super",
      },
    );

    expect(firstRestored.filePath).not.toBe(secondRestored.filePath);
    expect(JSON.stringify(firstRestored.manager.getEntries())).not.toContain(
      "user-b-secret",
    );
    expect(JSON.stringify(secondRestored.manager.getEntries())).not.toContain(
      "user-a-secret",
    );
  });

  it("rejects a modified database checkpoint before materializing JSONL", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "byclaw-pi-tamper-"));
    const source = SessionManager.create("/srv/byclaw-super", sourceDir, {
      id: randomUUID(),
    });
    source.appendMessage({ role: "user", content: "original", timestamp: 1 });
    const checkpoint = exportPiSessionCheckpoint(source);
    const modified = structuredClone(checkpoint);
    const message = modified.entries[0];
    if (message?.type === "message" && message.message.role === "user") {
      message.message.content = "tampered";
    }

    await expect(
      materializePiSessionCheckpoint(modified, {
        directory: join(sourceDir, "restored"),
        cwdOverride: "/srv/byclaw-super",
      }),
    ).rejects.toBeInstanceOf(InvalidPiSessionCheckpointError);
  });
});
