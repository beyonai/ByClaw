import { DomainError } from "../../domain/errors.js";
import type { SchemaManifest, SchemaTask, VerifiedScript } from "../../application/schema/types.js";
import { digest, sha256 } from "../../interfaces/contracts/validation.js";
import { unzipBundle } from "./zip-bundle.js";
import { validateScript } from "./script-validator.js";

/** 核验 ZIP 总摘要、逐版 manifest/SQL 摘要与协议范围，输出可执行的白名单语句。 */
export async function validateBundle(
  task: SchemaTask,
  bytes: Uint8Array,
): Promise<VerifiedScript[]> {
  if (sha256(bytes) !== task.bundleDigest) throw new DomainError("BUNDLE_DIGEST_MISMATCH");
  const files = await unzipBundle(bytes);
  if (files.size !== task.scripts.length * 2) throw new DomainError("INVALID_BUNDLE_ENTRY");
  return task.scripts.map((script) => {
    const sql = files.get(script.path),
      manifestBytes = files.get(script.path.replace("__ddl.sql", "manifest.json"));
    if (!sql || !manifestBytes || sha256(sql) !== script.sha256)
      throw new DomainError("SCRIPT_DIGEST_MISMATCH");
    let manifest: SchemaManifest, text: string;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      manifest = JSON.parse(decoder.decode(manifestBytes));
      text = decoder.decode(sql);
    } catch {
      throw new DomainError("INVALID_MANIFEST");
    }
    if (
      manifest.version !== script.version ||
      manifest.parentVersion !== script.parentVersion ||
      manifest.sqlSha256 !== script.sha256 ||
      manifest.engine !== "openGauss" ||
      !Number.isInteger(manifest.nodeProtocol?.min) ||
      !Number.isInteger(manifest.nodeProtocol?.max) ||
      manifest.nodeProtocol.min > 1 ||
      manifest.nodeProtocol.max < 1 ||
      !Array.isArray(manifest.objects) ||
      !manifest.objects.length
    )
      throw new DomainError("INVALID_MANIFEST");
    digest(manifest.catalogDigest);
    const names = new Set<string>();
    for (const object of manifest.objects) {
      const key = `${object.kind}:${object.name}`;
      if (
        !["table", "index", "sequence"].includes(object.kind) ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(object.name) ||
        names.has(key)
      )
        throw new DomainError("INVALID_MANIFEST_OBJECT");
      names.add(key);
    }
    return {
      script,
      manifest,
      statements: validateScript(text, manifest.objects, task.operationType),
    };
  });
}
