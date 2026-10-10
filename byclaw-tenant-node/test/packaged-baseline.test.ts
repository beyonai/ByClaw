import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { unzipBundle } from "../src/infrastructure/schema/zip-bundle.js";
import { validateBundle } from "../src/infrastructure/schema/bundle-validator.js";
import { sha256 } from "../src/interfaces/contracts/validation.js";
import { task } from "./fixtures.js";

// BE ships this ZIP, so checking only editable SQL would miss stale release artifacts.
describe("packaged V0.5.0 tenant baseline", () => {
  it("ships the exact migration source and a valid manifest", async () => {
    const bytes = await readFile(new URL("../baseline/V0.5.0__baseline.zip", import.meta.url));
    const source = await readFile(
      new URL(
        "../../deploy/migrations/versions/V0.5.0/tenant/V0.5.0__baseline__ddl.sql",
        import.meta.url,
      ),
    );
    const entries = await unzipBundle(bytes);
    expect(entries.get("baseline/V0.5.0/__ddl.sql")).toEqual(source);
    const validated = await validateBundle(
      task({
        bundleDigest: sha256(bytes),
        targetVersion: "V0.5.0",
        scripts: [
          {
            version: "V0.5.0",
            parentVersion: null,
            path: "baseline/V0.5.0/__ddl.sql",
            sha256: sha256(source),
          },
        ],
      }),
      bytes,
    );
    expect(validated).toHaveLength(1);
    expect(validated[0]?.manifest.objects).toContainEqual({
      kind: "index",
      name: "idx_group_chat_task_running_turn",
    });
  });
});
