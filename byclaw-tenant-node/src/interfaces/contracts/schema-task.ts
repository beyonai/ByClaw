import type { SchemaTask } from "../../application/schema/types.js";
import { DomainError } from "../../domain/errors.js";
import { assertTenant, type TenantIdentity } from "../../domain/tenant.js";
import { requireId } from "../../domain/values.js";
import { digest, opaqueId, record } from "./validation.js";

/** 核验任务身份、INIT/UPDATE 版本链与精确脚本路径；期限在受理和执行阶段检查。 */
export function validateSchemaTask(input: unknown, identity: TenantIdentity): SchemaTask {
  const task = record(input) as SchemaTask;
  assertTenant(task, identity);
  opaqueId(task.auditId);
  opaqueId(task.requestId);
  digest(task.bundleDigest);
  if (
    task.protocolVersion !== 1 ||
    !Number.isSafeInteger(task.attemptNo) ||
    task.attemptNo < 1 ||
    !["INIT", "UPDATE"].includes(task.operationType) ||
    !["MANUAL", "AUTO_PROVISION", "AUTO_RELEASE_UPGRADE"].includes(task.triggerType) ||
    typeof task.byclawReleaseVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(task.byclawReleaseVersion) ||
    typeof task.fencingToken !== "string" ||
    !/^(0|[1-9]\d*)$/.test(task.fencingToken) ||
    typeof task.deadline !== "string" ||
    !Number.isFinite(Date.parse(task.deadline)) ||
    !Array.isArray(task.scripts) ||
    !task.scripts.length ||
    task.scripts.length > 32
  )
    throw new DomainError("INVALID_SCHEMA_TASK");
  requireId(task.enterpriseId);
  requireId(task.generation);
  requireId(task.dbSandboxRecordId);
  let parent = task.fromVersion;
  if (
    (task.operationType === "INIT" && (parent !== null || task.scripts.length !== 1)) ||
    (task.operationType === "UPDATE" && !parent)
  )
    throw new DomainError("INVALID_VERSION_CHAIN");
  const versions = new Set<string>();
  for (const script of task.scripts) {
    if (
      typeof script.version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(script.version)
    )
      throw new DomainError("INVALID_VERSION_CHAIN");
    digest(script.sha256);
    if (
      script.parentVersion !== parent ||
      versions.has(script.version) ||
      script.version === task.fromVersion ||
      typeof script.path !== "string" ||
      !/^(?:baseline|versions)\/[A-Za-z0-9_.-]+\/__ddl\.sql$/.test(script.path)
    )
      throw new DomainError("INVALID_VERSION_CHAIN");
    if (
      script.path !==
      `${task.operationType === "INIT" ? "baseline" : "versions"}/${script.version}/__ddl.sql`
    )
      throw new DomainError("INVALID_VERSION_CHAIN");
    versions.add(script.version);
    parent = script.version;
  }
  if (parent !== task.targetVersion) throw new DomainError("INVALID_VERSION_CHAIN");
  return task;
}
