import { describe, expect, it } from "vitest";
import {
  buildDisabledConnectorPrompt,
  connectorAuthorizationRequiresFailClosed,
  connectorAuthorizationFromMetadata,
  disabledConnectorSkillNames,
  normalizeConnectorAuthorization,
} from "./connector-authorization.js";

describe("connector authorization", () => {
  it("normalizes only boolean entries with non-empty connector names", () => {
    expect(
      normalizeConnectorAuthorization({
        " dws ": true,
        fws: false,
        wecomcli: "false",
        "": false,
      }),
    ).toEqual({ dws: true, fws: false });
  });

  it("rejects connector names that are not valid OpenClaw skill names", () => {
    expect(
      normalizeConnectorAuthorization({
        dws: false,
        "bad`name": false,
        "bad\nname": false,
        "bad_name": false,
        "-leading": false,
        "trailing-": false,
        "double--hyphen": false,
        ["a".repeat(65)]: false,
      }),
    ).toEqual({ dws: false });
  });

  it.each([
    { fws: false, " fws ": true },
    { fws: true, " fws ": false },
  ])("keeps canonical connector collisions disabled: %j", (value) => {
    expect(normalizeConnectorAuthorization(value)).toEqual({ fws: false });
  });

  it("caps connector authorization entries and prioritizes disabled entries", () => {
    const value = Object.fromEntries([
      ...Array.from({ length: 64 }, (_, index) => [`enabled-${index}`, true]),
      ["disabled-last", false],
    ]);

    const normalized = normalizeConnectorAuthorization(value);
    expect(Object.keys(normalized ?? {})).toHaveLength(64);
    expect(normalized).toMatchObject({ "disabled-last": false });
  });

  it("marks oversized disabled connector policies for fail-closed enforcement", () => {
    const normalized = normalizeConnectorAuthorization(
      Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`disabled-${index}`, false]),
      ),
    );

    expect(connectorAuthorizationRequiresFailClosed(normalized)).toBe(true);
    const prompt = buildDisabledConnectorPrompt("zh_CN", normalized);
    expect(prompt).toContain("安全限制");
    expect(prompt).toContain("ByClaw");
    expect(prompt).toContain("调用任何工具之前");
    expect(prompt).toContain("不要调用任何工具");
    expect(prompt).toContain("不要搜索记忆或聊天室历史");
    expect(prompt).toContain("不要重试");
    expect(prompt).toContain("立即回复用户");
    expect(prompt).toContain("如果用户当前意图不需要上述未启用连接器");
  });

  it.each([undefined, null, [], "{}", {}, { dws: "false" }])(
    "ignores invalid or empty connector authorization: %j",
    (value) => {
      expect(normalizeConnectorAuthorization(value)).toBeUndefined();
    },
  );

  it("reads connector authorization only from the named metadata field", () => {
    expect(
      connectorAuthorizationFromMetadata({
        authConnectorList: { dws: false },
        unrelated: { fws: false },
      }),
    ).toEqual({ dws: false });
    expect(connectorAuthorizationFromMetadata({ unrelated: { fws: false } })).toBeUndefined();
  });

  it("lists only disabled connector skill names", () => {
    expect(
      disabledConnectorSkillNames({
        dws: true,
        fws: false,
        wecomcli: false,
      }),
    ).toEqual(["fws", "wecomcli"]);
  });

  it("builds localized unavailable-connector guidance", () => {
    const chinese = buildDisabledConnectorPrompt("zh_CN", { dws: false, fws: true });
    expect(chinese).toContain("`dws`");
    expect(chinese).not.toContain("`fws`");
    expect(chinese).toContain("连接器当前处于未连接或未授权状态");
    expect(chinese).toContain("ByClaw");
    expect(chinese).toContain("连接器管理页面");
    expect(chinese).toContain("连接/授权");
    expect(chinese).toContain("调用任何工具之前");
    expect(chinese).toContain("不要调用任何工具");
    expect(chinese).toContain("不要搜索记忆或聊天室历史");
    expect(chinese).toContain("不要重试");
    expect(chinese).toContain("立即回复用户");
    expect(chinese).toContain("如果用户当前意图不需要上述未启用连接器");

    const english = buildDisabledConnectorPrompt("en_US", { dws: false });
    expect(english).toContain("`dws`");
    expect(english).toContain("currently not connected or authorized");
    expect(english).toContain("ByClaw");
    expect(english).toContain("connector management page");
    expect(english).toContain("Before calling any tool");
    expect(english).toContain("do not call any tool");
    expect(english).toContain("do not search memory or chat history");
    expect(english).toContain("do not retry");
    expect(english).toContain("reply to the user immediately");
  });

  it("omits guidance when every connector is enabled", () => {
    expect(buildDisabledConnectorPrompt("zh_CN", { dws: true })).toBe("");
  });
});
