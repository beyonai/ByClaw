import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: vi.fn(),
}));

vi.mock("./diagnostics.js", () => ({
  emitByaiSdkFirstResponse: vi.fn(),
}));

vi.mock("./utils.js", () => ({
  generateRandomId: vi.fn(() => "generated-id"),
}));

import { resolveSdkLocalFilePath } from "./session-context.js";

describe("resolveSdkLocalFilePath", () => {
  it.each([
    ["documents/report.pdf", "/by/documents/report.pdf"],
    ["/documents/report.pdf", "/by/documents/report.pdf"],
    ["/by/documents/report.pdf", "/by/documents/report.pdf"],
    ["//by//documents//report.pdf", "/by/documents/report.pdf"],
    ["/by/../documents/report.pdf", "/by/documents/report.pdf"],
    ["/byte/report.pdf", "/by/byte/report.pdf"],
    ["", "/by"],
  ])("resolves %j to a normalized /by path", (rawPath, expected) => {
    expect(resolveSdkLocalFilePath(rawPath)).toBe(expected);
  });
});
