import { describe, expect, it } from "vitest";
import { applyPrivateEnvPlaceholders, redactPrivateParamValues } from "./personal-params.js";

describe("applyPrivateEnvPlaceholders", () => {
  it("replaces privateEnv placeholders recursively", () => {
    const params = {
      API_TOKEN: "token-123",
      TENANT_ID: "tenant-a",
    };

    expect(
      applyPrivateEnvPlaceholders(
        {
          url: "https://example.com/${privateEnv.TENANT_ID}",
          headers: {
            Authorization: "Bearer ${privateEnv.API_TOKEN}",
          },
          args: ["${privateEnv.TENANT_ID}", 1],
        },
        params,
      ),
    ).toEqual({
      url: "https://example.com/tenant-a",
      headers: {
        Authorization: "Bearer token-123",
      },
      args: ["tenant-a", 1],
    });
  });

  it("keeps missing placeholders unchanged", () => {
    expect(applyPrivateEnvPlaceholders("${privateEnv.MISSING}", {})).toBe("${privateEnv.MISSING}");
  });
});

describe("redactPrivateParamValues", () => {
  it("redacts private values recursively", () => {
    expect(
      redactPrivateParamValues(
        {
          url: "https://example.com/token-123",
          headers: {
            Authorization: "Bearer token-123",
          },
          args: ["tenant-a"],
        },
        {
          API_TOKEN: "token-123",
          TENANT_ID: "tenant-a",
        },
      ),
    ).toEqual({
      url: "https://example.com/***",
      headers: {
        Authorization: "Bearer ***",
      },
      args: ["***"],
    });
  });
});
