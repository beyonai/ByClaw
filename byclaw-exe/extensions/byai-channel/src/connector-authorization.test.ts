import { describe, expect, it } from "vitest";
import {
  buildDisabledConnectorPrompt,
  buildConnectorPolicyToolCallWarning,
  connectorAuthorizationRequiresFailClosed,
  connectorAuthorizationFromMetadata,
  disabledConnectorSkillNames,
  logConnectorPolicyToolActivity,
  normalizeConnectorAuthorization,
  safeConnectorAuthorizationLog,
  summarizeConnectorAuthorization,
} from "./connector-authorization.js";

describe("connector authorization", () => {
  it("normalizes boolean entries with valid connector names", () => {
    expect(
      normalizeConnectorAuthorization({
        " dws ": true,
        fws: false,
      }),
    ).toEqual({ dws: true, fws: false });
  });

  it.each([
    { dws: false, "bad`name": false },
    { dws: false, "bad\nname": false },
    { dws: false, bad_name: false },
    { dws: false, "-leading": false },
    { dws: false, "trailing-": false },
    { dws: false, "double--hyphen": false },
    { dws: false, ["a".repeat(65)]: false },
    { dws: false, wecomcli: "false" },
  ])("fails closed when any connector authorization entry is malformed: %j", (value) => {
    expect(connectorAuthorizationRequiresFailClosed(normalizeConnectorAuthorization(value))).toBe(
      true,
    );
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

  it("preserves legacy behavior only when connector authorization is absent", () => {
    expect(normalizeConnectorAuthorization(undefined)).toBeUndefined();
  });

  it.each([null, [], "{}", {}, { dws: "false" }])(
    "fails closed for a present but invalid connector authorization: %j",
    (value) => {
      expect(connectorAuthorizationRequiresFailClosed(normalizeConnectorAuthorization(value))).toBe(
        true,
      );
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
    expect(
      connectorAuthorizationRequiresFailClosed(
        connectorAuthorizationFromMetadata({ authConnectorList: { dws: "false" } }),
      ),
    ).toBe(true);
    expect(
      connectorAuthorizationRequiresFailClosed(
        connectorAuthorizationFromMetadata({ authConnectorList: undefined }),
      ),
    ).toBe(true);
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

  it("summarizes connector authorization with deterministic identifier order", () => {
    expect(
      summarizeConnectorAuthorization({ dws: false, fws: true, wecomcli: true }),
    ).toEqual({
      enabled: ["fws", "wecomcli"],
      disabled: ["dws"],
      failClosed: false,
    });
  });

  it("builds a safe tool activity warning only when connectors are disabled", () => {
    expect(
      buildConnectorPolicyToolCallWarning({
        sessionKey: "agent:dws:direct:100",
        toolName: "baiying_call",
        authorization: { dws: false, fws: true },
      }),
    ).toBe(
      "[byai-channel] connector soft-control tool activity: sessionKey=agent:dws:direct:100, tool=baiying_call, disabled=dws, skillFilter=off",
    );

    expect(
      buildConnectorPolicyToolCallWarning({
        sessionKey: "agent:dws:direct:100",
        toolName: "baiying_call",
        authorization: undefined,
      }),
    ).toBeUndefined();
    expect(
      buildConnectorPolicyToolCallWarning({
        sessionKey: "agent:dws:direct:100",
        toolName: "baiying_call",
        authorization: { dws: true },
      }),
    ).toBeUndefined();
  });

  it("warns safely when an oversized disabled policy fails closed", () => {
    const authorization = normalizeConnectorAuthorization(
      Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`disabled-${index}`, false]),
      ),
    );

    expect(summarizeConnectorAuthorization(authorization)).toEqual({
      enabled: [],
      disabled: [],
      failClosed: true,
    });
    expect(
      buildConnectorPolicyToolCallWarning({
        sessionKey: "agent:dws:direct:100",
        toolName: "baiying_call",
        authorization,
      }),
    ).toBe(
      "[byai-channel] connector soft-control tool activity: sessionKey=agent:dws:direct:100, tool=baiying_call, disabled=byclaw-connector-auth-overflow, skillFilter=off",
    );
  });

  it("keeps connector diagnostics non-blocking when logger methods throw", () => {
    const logger = {
      info(): never {
        throw new Error("info unavailable");
      },
      warn(): never {
        throw new Error("warn unavailable");
      },
    };

    expect(() => safeConnectorAuthorizationLog(logger, "info", "policy")).not.toThrow();
    expect(
      logConnectorPolicyToolActivity({
        logger,
        sessionKey: "agent:dws:direct:100",
        toolName: "baiying_call",
        authorization: { dws: false },
      }),
    ).toBeUndefined();
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
