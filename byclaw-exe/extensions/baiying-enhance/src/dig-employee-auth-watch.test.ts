import { describe, expect, it } from "vitest";
import { isRedisKeyspaceNotificationsEnabled, parseAuthorizedIds } from "./dig-employee-auth-watch.js";

describe("parseAuthorizedIds", () => {
  it("parses hash fields shaped as resourceId -> DIG_EMPLOYEE", () => {
    expect([...parseAuthorizedIds({ "10000417": "DIG_EMPLOYEE", "42": "TOOLKIT" })]).toEqual(["10000417"]);
  });

  it("parses JSON object values with resourceBizType and resource id variants", () => {
    const ids = parseAuthorizedIds({
      a: JSON.stringify({ resourceBizType: "DIG_EMPLOYEE", resourceId: "10000417" }),
      b: JSON.stringify({ resourceType: "DIG_EMPLOYEE", id: 10000418 }),
      c: JSON.stringify({ resourceBizType: "TOOLKIT", sourcePkId: "999" }),
    });

    expect([...ids].sort()).toEqual(["10000417", "10000418"]);
  });

  it("parses JSON array authorization values", () => {
    const ids = parseAuthorizedIds({
      resources: JSON.stringify([
        { resourceBizType: "DIG_EMPLOYEE", resourceId: "10000417" },
        { resourceType: "DIG_EMPLOYEE", sourcePkId: "10000418" },
        { resourceBizType: "KG_DOC", resourceId: "10000419" },
      ]),
    });

    expect([...ids].sort()).toEqual(["10000417", "10000418"]);
  });
});

describe("isRedisKeyspaceNotificationsEnabled", () => {
  it("returns false when notify-keyspace-events is empty", () => {
    expect(isRedisKeyspaceNotificationsEnabled("")).toBe(false);
  });

  it("returns true when hash or generic key events are enabled", () => {
    expect(isRedisKeyspaceNotificationsEnabled("Kh")).toBe(true);
    expect(isRedisKeyspaceNotificationsEnabled("AKE$")).toBe(true);
  });
});
