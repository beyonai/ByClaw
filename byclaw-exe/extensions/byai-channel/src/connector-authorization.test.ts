import { describe, expect, it } from "vitest";
import {
  buildDisabledConnectorPrompt,
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
    expect(chinese).toContain("连接器管理页面");
    expect(chinese).toContain("连接/授权");

    const english = buildDisabledConnectorPrompt("en_US", { dws: false });
    expect(english).toContain("`dws`");
    expect(english).toContain("currently not connected or authorized");
    expect(english).toContain("connector management page");
  });

  it("omits guidance when every connector is enabled", () => {
    expect(buildDisabledConnectorPrompt("zh_CN", { dws: true })).toBe("");
  });
});
