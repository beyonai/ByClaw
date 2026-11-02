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
    // Fresh tenant databases need the same acknowledgement storage as upgraded tenants.
    expect(validated[0]?.manifest.objects).toContainEqual({
      kind: "table",
      name: "byai_group_chat_message_ack",
    });
    expect(validated[0]?.manifest.objects).toContainEqual({
      kind: "index",
      name: "idx_group_chat_message_ack_message",
    });
  });
});

describe("candidate V0.6.0 tenant bundles", () => {
  it.each(["baseline", "update"] as const)(
    "ships exact %s SQL, complete catalog and honest capture provenance",
    async (kind) => {
      const directory = kind === "baseline" ? "baseline" : "updates";
      const stem = `V0.6.0__${kind}`;
      const bytes = await readFile(new URL(`../${directory}/${stem}.zip`, import.meta.url));
      const source = await readFile(
        new URL(
          `../../deploy/migrations/versions/V0.6.0/tenant/V0.6.0${kind === "baseline" ? "__baseline" : ""}__ddl.sql`,
          import.meta.url,
        ),
      );
      const manifest = JSON.parse(
        await readFile(new URL(`../${directory}/${stem}__manifest.json`, import.meta.url), "utf8"),
      );
      const provenance = JSON.parse(
        await readFile(
          new URL(`../${directory}/${stem}__provenance.json`, import.meta.url),
          "utf8",
        ),
      );
      const prefix = kind === "baseline" ? "baseline" : "versions";
      const parent = kind === "baseline" ? null : provenance.parentMarker.version;
      const validated = await validateBundle(
        task({
          operationType: kind === "baseline" ? "INIT" : "UPDATE",
          fromVersion: parent,
          targetVersion: "V0.6.0",
          bundleDigest: sha256(bytes),
          scripts: [
            {
              version: "V0.6.0",
              parentVersion: parent,
              path: `${prefix}/V0.6.0/__ddl.sql`,
              sha256: sha256(source),
            },
          ],
        }),
        bytes,
      );
      expect(validated[0].manifest).toEqual(manifest);
      expect((await unzipBundle(bytes)).get(`${prefix}/V0.6.0/__ddl.sql`)).toEqual(source);
      expect(manifest.objects).toEqual(
        expect.arrayContaining(
          [
            "byai_session",
            "byai_message",
            "byai_group_chat_forward_request",
            "byai_group_chat_forward_target",
            "byai_group_chat_forward_item",
          ].map((name) => ({ name, kind: "table" })),
        ),
      );
      expect(provenance.captureEngine.name).toBe("PostgreSQL");
      expect(provenance.captureEngine.version).toMatch(/^17\./);
      expect(provenance.targetEngineVerified).toBe(false);
      expect(provenance.bundleSha256).toBe(sha256(bytes));
      expect(provenance.sqlSha256).toBe(sha256(source));
    },
  );
});
