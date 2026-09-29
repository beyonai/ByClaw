import { describe, expect, it } from "vitest";
import { normalizeResourceType } from "./resource-type.js";
import {
  DISABLED_RESOURCE_BIZ_TYPES,
  DISABLED_RESOURCE_TYPE_ALIASES,
  isDisabledRelResource,
  isDisabledResourceBizType,
} from "./disabled-resource-type.js";

/**
 * T-01 / T-02 — pure unit tests for the single retired-type rule.
 *
 * This file is deliberately mock-free: `disabled-resource-type.ts` imports only
 * `./resource-type.js` (-> `./types.js`, a type-only re-export), so the rule can
 * be verified without the host `openclaw` package, Redis or the SDK.
 */
describe("disabled resource type rule", () => {
  it("disabledCodesAreExactlyTheFourTypes", () => {
    expect([...DISABLED_RESOURCE_BIZ_TYPES]).toEqual(["OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE"]);
    expect(Object.isFrozen(DISABLED_RESOURCE_BIZ_TYPES)).toBe(false);
  });

  it("disabledAliasSetIsEmpty", () => {
    // Verified on the D0.5.0 baseline: the plugin has no type-level
    // ONTOLOGY / SCENE / ONTOLOGY_BASE literal outside this list.
    expect([...DISABLED_RESOURCE_TYPE_ALIASES]).toEqual([]);
  });

  it("normalizationCoversCaseWhitespaceAndLowercaseLabels", () => {
    const disabled = [
      "OBJECT",
      "object",
      "Object",
      "oBjEcT",
      " OBJECT ",
      "\tOBJECT\n",
      "VIEW",
      "view",
      "View",
      "ONTOLOGY_BASE",
      "ontology_base",
      "Ontology_Base",
      "SCENE",
      "scene",
      "Scene",
    ];
    for (const value of disabled) {
      expect({ value, disabled: isDisabledResourceBizType(value) }).toEqual({ value, disabled: true });
    }

    const notDisabled = [null, undefined, "", "   ", 0, false];
    for (const value of notDisabled) {
      expect({ value, disabled: isDisabledResourceBizType(value) }).toEqual({ value, disabled: false });
    }
  });

  it("forgedTypesAreNotDisabled", () => {
    for (const value of ["OBJECTX", "FOO", "OBJECT_1", "VIEWS", "ONTOLOGY", "SCENES", "ACTION"]) {
      expect({ value, disabled: isDisabledResourceBizType(value) }).toEqual({ value, disabled: false });
    }
  });

  it("normalTypesAreNotDisabled", () => {
    const normal = [
      "DOC",
      "ATOM",
      "KG_DOC",
      "KG_DB",
      "KG_QA",
      "KG_TERM",
      "SKILL",
      "TOOLKIT",
      "TOOL",
      "MCP",
      "MCP_TOOL",
      "AGENT",
      "DIG_EMPLOYEE",
      "BYCLAW_DATA",
      "DB_DATASET",
      "TAG",
    ];
    for (const value of normal) {
      expect({ value, disabled: isDisabledResourceBizType(value) }).toEqual({ value, disabled: false });
    }
  });

  it("normalNormalMappingsUnchanged", () => {
    // normalizeResourceType itself must not change for normal types.
    expect(normalizeResourceType("DOC")).toBe("doc");
    expect(normalizeResourceType("ATOM")).toBe("doc");
    expect(normalizeResourceType("KG_DOC")).toBe("doc");
    expect(normalizeResourceType("KG_DB")).toBe("doc");
    expect(normalizeResourceType("KG_QA")).toBe("doc");
    expect(normalizeResourceType("AGENT")).toBe("agent");
    expect(normalizeResourceType("TOOLKIT")).toBe("toolkit");
    expect(normalizeResourceType("TOOL")).toBe("tool");
    expect(normalizeResourceType("MCP")).toBe("mcp");
    expect(normalizeResourceType("OBJECT")).toBe("object");
    expect(normalizeResourceType("VIEW")).toBe("view");
  });

  it("nonStringInputsAreNotDisabled", () => {
    // A JSON Schema fragment or any non-string value must never be treated as a
    // resource type (see design A2.3).
    for (const value of [{ type: "object" }, ["object"], 42, true, () => "object"]) {
      expect(isDisabledResourceBizType(value)).toBe(false);
    }
  });

  it("relResourcePredicateReadsBizTypeOrType", () => {
    expect(isDisabledRelResource({ resourceBizType: "OBJECT" })).toBe(true);
    expect(isDisabledRelResource({ resourceType: "view" })).toBe(true);
    expect(isDisabledRelResource({ resourceBizType: "VIEW", resourceType: "KG_DOC" })).toBe(true);
    expect(isDisabledRelResource({ resourceBizType: "KG_DOC", resourceType: "DOC" })).toBe(false);
    expect(isDisabledRelResource({})).toBe(false);
    expect(isDisabledRelResource(null)).toBe(false);
    expect(isDisabledRelResource(undefined)).toBe(false);
  });
});
