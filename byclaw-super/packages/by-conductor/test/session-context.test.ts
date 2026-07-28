import { describe, expect, it } from "vitest";
import {
  createSessionContext,
  parseSessionContext,
} from "../src/index.js";

describe("SessionContextV1", () => {
  it("canonicalizes locale and timezone", () => {
    expect(
      createSessionContext({
        locale: "ZH-hans-cn",
        timezone: "asia/shanghai",
      }),
    ).toEqual({
      schemaVersion: 1,
      locale: "zh-Hans-CN",
      timezone: "Asia/Shanghai",
    });
  });

  it("omits blank optional fields", () => {
    expect(createSessionContext({ locale: " ", timezone: "" })).toEqual({
      schemaVersion: 1,
    });
  });

  it("rejects invalid or unsupported persisted context", () => {
    expect(() => createSessionContext({ locale: "not_a_locale" })).toThrow(
      /locale/,
    );
    expect(() => createSessionContext({ timezone: "Mars/Olympus" })).toThrow(
      /timezone/,
    );
    expect(() =>
      parseSessionContext({ schemaVersion: 2, locale: "zh-CN" }),
    ).toThrow(/schema/);
    expect(() =>
      parseSessionContext({ schemaVersion: 1, locale: 123 }),
    ).toThrow(/locale/);
  });
});
