import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("openclaw plugin manifest", () => {
  it("declares the native image provider bridge without owning a custom image tool", () => {
    const manifestPath = new URL("../openclaw.plugin.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      contracts?: { tools?: string[]; imageGenerationProviders?: string[] };
      imageGenerationProviderMetadata?: Record<
        string,
        { configSignals?: Array<{ rootPath?: string; required?: string[] }> }
      >;
    };

    expect(manifest.contracts?.tools).toEqual(["baiying_call"]);
    expect(manifest.contracts?.imageGenerationProviders).toEqual([
      "baiying-redis-image",
      "volcengine",
    ]);
    expect(
      manifest.imageGenerationProviderMetadata?.["baiying-redis-image"]
        ?.configSignals,
    ).toEqual([
      {
        rootPath: "plugins.entries.baiying-enhance",
        required: ["enabled"],
      },
    ]);
  });
});
