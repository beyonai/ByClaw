import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInboundLanguage } from "./i18n.js";

describe("resolveInboundLanguage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers explicit channel metadata over LANG", () => {
    vi.stubEnv("LANG", "zh_CN");

    expect(resolveInboundLanguage("en_US")).toEqual({
      language: "en_US",
      languageProvided: true,
    });
  });

  it("uses LANG when channel metadata is empty", () => {
    vi.stubEnv("LANG", "en_US");

    expect(resolveInboundLanguage("  ")).toEqual({
      language: "en_US",
      languageProvided: true,
    });
  });

  it("defaults to zh_CN without metadata or LANG", () => {
    vi.stubEnv("LANG", "");

    expect(resolveInboundLanguage()).toEqual({
      language: "zh_CN",
      languageProvided: false,
    });
  });
});
