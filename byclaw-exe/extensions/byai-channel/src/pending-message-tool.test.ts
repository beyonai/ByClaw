import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingMessageToolSends,
  consumePendingMessageToolSend,
  registerPendingMessageToolSend,
} from "./pending-message-tool.js";

const SK = "agent:main:direct:test";

afterEach(() => {
  clearPendingMessageToolSends(SK);
});

describe("consumePendingMessageToolSend", () => {
  it("suppresses (false) when no message tool was registered (agent reply echo)", () => {
    expect(consumePendingMessageToolSend(SK, "天气助手已经回来了…")).toBe(false);
  });

  it("emits (true) for a registered message-tool send, then suppresses the next echo", () => {
    registerPendingMessageToolSend(SK, { toolCallId: "call_1", text: "你好，这是一条通知" });
    expect(consumePendingMessageToolSend(SK, "你好，这是一条通知")).toBe(true);
    // queue drained → subsequent sendText (agent reply) suppressed
    expect(consumePendingMessageToolSend(SK, "你好，这是一条通知")).toBe(false);
  });

  it("matches despite CRLF/whitespace normalization differences", () => {
    registerPendingMessageToolSend(SK, { toolCallId: "c", text: "line1\nline2" });
    expect(consumePendingMessageToolSend(SK, "  line1\r\nline2  ")).toBe(true);
  });

  it("matches by prefix when core re-sanitizes the text", () => {
    registerPendingMessageToolSend(SK, { toolCallId: "c", text: "完整通知内容" });
    // sendText carries a longer wrapped form sharing the prefix
    expect(consumePendingMessageToolSend(SK, "完整通知内容（附加）")).toBe(true);
  });

  it("FIFO: consumes registered sends in order across multiple message-tool calls", () => {
    registerPendingMessageToolSend(SK, { toolCallId: "c1", text: "第一条" });
    registerPendingMessageToolSend(SK, { toolCallId: "c2", text: "第二条" });
    expect(consumePendingMessageToolSend(SK, "第一条")).toBe(true);
    expect(consumePendingMessageToolSend(SK, "第二条")).toBe(true);
    expect(consumePendingMessageToolSend(SK, "第三条（无登记）")).toBe(false);
  });

  it("falls back to head-of-queue when text does not match any entry (sanitization drift)", () => {
    registerPendingMessageToolSend(SK, { toolCallId: "c", text: "原始文本" });
    // completely different sendText but a pending send exists → emit (FIFO fallback)
    expect(consumePendingMessageToolSend(SK, "被清洗得面目全非的文本")).toBe(true);
    expect(consumePendingMessageToolSend(SK, "再来一条")).toBe(false);
  });

  it("ignores empty/blank registrations and missing sessionKey", () => {
    registerPendingMessageToolSend(SK, { toolCallId: "", text: "no id" });
    expect(consumePendingMessageToolSend(SK, "no id")).toBe(false);
    registerPendingMessageToolSend(undefined, { toolCallId: "c", text: "x" });
    expect(consumePendingMessageToolSend(undefined, "x")).toBe(false);
  });

  it("isolates queues per sessionKey", () => {
    registerPendingMessageToolSend("sk-a", { toolCallId: "c", text: "A" });
    expect(consumePendingMessageToolSend("sk-b", "A")).toBe(false);
    expect(consumePendingMessageToolSend("sk-a", "A")).toBe(true);
    clearPendingMessageToolSends("sk-a");
  });
});
