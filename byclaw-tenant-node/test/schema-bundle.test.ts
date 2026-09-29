import { describe, expect, it } from "vitest";
import { validateScript } from "../src/infrastructure/schema/script-validator.js";
import { validateBundle } from "../src/infrastructure/schema/bundle-validator.js";
import { unzipBundle } from "../src/infrastructure/schema/zip-bundle.js";
import { sha256 } from "../src/interfaces/contracts/validation.js";
import { manifest, task } from "./fixtures.js";
import { zip } from "./zip-fixture.js";
const objects = [
  { kind: "table" as const, name: "t" },
  { kind: "index" as const, name: "i" },
  { kind: "sequence" as const, name: "seq_any_table" },
];
describe("DDL boundary", () => {
  it("accepts tenant tables, indexes, sequence defaults and comments", () => {
    const sql =
      "CREATE SCHEMA IF NOT EXISTS byai; CREATE SEQUENCE byai.seq_any_table; CREATE TABLE byai.t(id bigint DEFAULT nextval('byai.seq_any_table')); CREATE UNIQUE INDEX i ON byai.t(id); COMMENT ON COLUMN byai.t.id IS '标识';";
    expect(validateScript(sql, objects, "INIT")).toHaveLength(5);
  });
  it("frames semicolons inside strings and nested comments", () => {
    expect(
      validateScript("/* outer /* inner */ */ COMMENT ON TABLE byai.t IS 'a;b';", objects, "INIT"),
    ).toHaveLength(1);
  });
  it.each([
    "INSERT INTO byai.t VALUES(1)",
    "DELETE FROM byai.t",
    "SELECT * FROM byai.t",
    "BEGIN",
    "SET search_path=public",
    "CREATE TABLE public.t(id bigint)",
    "CREATE TABLE byai.unlisted(id bigint)",
    "COMMENT ON SCHEMA byai IS 'spoof'",
    "ALTER TABLE byai.t OWNER TO postgres",
    "CREATE TABLE byai.t(id int DEFAULT pg_sleep(10))",
    "ALTER TABLE byai.t ADD CONSTRAINT fk FOREIGN KEY(id) REFERENCES public.x(id)",
  ])("rejects %s", (sql) => {
    expect(() => validateScript(sql, objects, "UPDATE")).toThrow();
  });
  it("rejects destructive UPDATE and unlisted renames", () => {
    expect(() => validateScript("DROP TABLE byai.t", objects, "UPDATE")).toThrow();
    expect(() =>
      validateScript("ALTER TABLE byai.t RENAME TO unknown", objects, "UPDATE"),
    ).toThrow();
  });
});
describe("ZIP integrity", () => {
  it("checks the bundle, SQL, manifest and allowed object list", async () => {
    const sql = Buffer.from("CREATE TABLE byai.t(id bigint);"),
      m = { ...manifest(), sqlSha256: sha256(sql) },
      bytes = zip([
        ["baseline/S1/__ddl.sql", sql],
        ["baseline/S1/manifest.json", Buffer.from(JSON.stringify(m))],
      ]);
    const t = task({
      bundleDigest: sha256(bytes),
      scripts: [{ ...task().scripts[0]!, sha256: sha256(sql) }],
    });
    expect((await validateBundle(t, bytes))[0]?.statements).toHaveLength(1);
    await expect(validateBundle({ ...t, bundleDigest: "0".repeat(64) }, bytes)).rejects.toThrow(
      "BUNDLE_DIGEST_MISMATCH",
    );
    await expect(
      validateBundle({ ...t, scripts: [{ ...t.scripts[0]!, sha256: "0".repeat(64) }] }, bytes),
    ).rejects.toThrow("SCRIPT_DIGEST_MISMATCH");
  });
  it.each(["../evil.sql", "/absolute.sql", "versions/S1/evil.sql"])(
    "rejects ZIP path %s",
    async (path) => {
      await expect(unzipBundle(zip([[path, Buffer.from("bad")]]))).rejects.toThrow();
    },
  );
  it("rejects duplicate names and corruption", async () => {
    const name = "baseline/S1/__ddl.sql";
    await expect(
      unzipBundle(
        zip([
          [name, Buffer.from("a")],
          [name, Buffer.from("b")],
        ]),
      ),
    ).rejects.toThrow("INVALID_BUNDLE_ENTRY");
    const bytes = zip([[name, Buffer.from("a")]]);
    bytes[30 + name.length] = 98;
    await expect(unzipBundle(bytes)).rejects.toThrow("INVALID_BUNDLE");
  });
});
