import { DomainError } from "../../domain/errors.js";
import type { SchemaPorts, SchemaResult, SchemaExecution, VerifiedScript } from "./types.js";

export class SchemaTaskRunner {
  constructor(private readonly ports: SchemaPorts) {}
  async run(result: SchemaResult): Promise<void> {
    this.ports.busy(true);
    try {
      await this.ports.authorize(result.task, true);
      const scripts = await this.ports.validate(
        result.task,
        await this.ports.loadBundle(result.task),
      );
      await this.ports.locked(async (execution) => {
        await this.checkStart(result, execution, scripts);
        result.startedAt ??= new Date().toISOString();
        for (const script of scripts) await this.step(result, script, execution);
      });
      delete result.failureStage;
      delete result.failureVersion;
      delete result.failureScript;
      delete result.errorCode;
      delete result.sqlState;
      delete result.failureReason;
      result.reported = false;
      result.status = "VERIFIED";
      result.finishedAt = new Date().toISOString();
    } catch (error) {
      this.failure(result, error);
    }
    await this.ports.save(result);
    await this.deliver(result);
    if (["VERIFIED", "FAILED"].includes(result.status)) this.ports.busy(false);
  }
  private async checkStart(
    result: SchemaResult,
    execution: SchemaExecution,
    scripts: VerifiedScript[],
  ): Promise<void> {
    result.failureStage = "LOCK";
    const marker = await execution.marker();
    result.observedVersion = marker?.version ?? null;
    const audited = await this.ports.currentVersion();
    if (audited !== result.task.fromVersion && audited !== result.observedVersion)
      throw new DomainError("SCHEMA_AUDIT_MISMATCH");
    const committed = scripts.find(
      (entry) =>
        entry.script.version === marker?.version && entry.script.sha256 === marker?.scriptDigest,
    );
    if (committed) {
      if (!result.startedAt && !["RUNNING", "VERIFYING", "RECONCILING"].includes(result.status))
        throw new DomainError(
          result.task.operationType === "INIT"
            ? "INIT_REQUIRES_EMPTY_DATABASE"
            : "SCHEMA_VERSION_MISMATCH",
        );
      result.failureStage = "VERIFY";
      await execution.verify(committed.manifest);
      if (!result.steps.some((step) => step.version === marker!.version))
        result.steps.push({ version: marker!.version, status: "VERIFIED_RECOVERED" });
      return;
    }
    if (result.task.operationType === "INIT") {
      if (marker || !(await execution.empty()))
        throw new DomainError("INIT_REQUIRES_EMPTY_DATABASE");
    } else {
      if (marker?.version !== result.task.fromVersion)
        throw new DomainError("SCHEMA_VERSION_MISMATCH");
      await execution.verify({
        ...scripts[0]!.manifest,
        version: marker.version,
        sqlSha256: marker.scriptDigest,
        catalogDigest: marker.catalogDigest,
        objects: [],
      });
    }
  }
  private async step(
    result: SchemaResult,
    entry: VerifiedScript,
    execution: SchemaExecution,
  ): Promise<void> {
    const { script, manifest, statements } = entry;
    const marker = await execution.marker();
    const currentIndex = result.task.scripts.findIndex((item) => item.version === marker?.version);
    const stepIndex = result.task.scripts.findIndex((item) => item.version === script.version);
    if (currentIndex >= stepIndex) return;
    if ((marker?.version ?? null) !== script.parentVersion)
      throw new DomainError("SCHEMA_VERSION_MISMATCH");
    await this.ports.authorize(result.task);
    result.failureVersion = script.version;
    result.failureScript = script.path;
    result.failureStage = "EXECUTE";
    result.status = "RUNNING";
    await this.ports.save(result);
    await execution.execute(
      statements,
      {
        protocolVersion: 1,
        enterpriseId: result.task.enterpriseId,
        version: script.version,
        catalogDigest: manifest.catalogDigest,
        scriptDigest: script.sha256,
      },
      () => this.ports.authorize(result.task),
    );
    result.observedVersion = script.version;
    result.status = "VERIFYING";
    result.failureStage = "VERIFY";
    await this.ports.save(result);
    await execution.verify(manifest);
    result.steps.push({ version: script.version, status: "VERIFIED" });
    await this.ports.save(result);
  }
  private failure(result: SchemaResult, error: unknown): void {
    const code = error instanceof DomainError ? error.code : "TENANT_DDL_EXECUTION_FAILED";
    const sqlState = (error as { code?: string })?.code;
    result.reported = false;
    result.errorCode = code;
    if (sqlState && /^[A-Z0-9]{5}$/.test(sqlState)) result.sqlState = sqlState;
    result.failureReason = code;
    result.status =
      code === "COMMIT_UNCERTAIN" || result.failureStage === "VERIFY"
        ? "RECONCILING"
        : [
              "INIT_REQUIRES_EMPTY_DATABASE",
              "SCHEMA_VERSION_MISMATCH",
              "SCHEMA_AUDIT_MISMATCH",
              "SCHEMA_FINGERPRINT_MISMATCH",
            ].includes(code)
          ? "NEEDS_ATTENTION"
          : "FAILED";
    result.finishedAt = new Date().toISOString();
  }
  async deliver(result: SchemaResult): Promise<void> {
    if (!result.reported) {
      try {
        await this.ports.report(result);
        result.reported = true;
        await this.ports.save(result);
      } catch {
        /* Keep retrying the durable report. */
      }
    }
    if (result.status === "RECONCILING" || (result.status !== "VERIFIED" && !result.reported))
      return;
    if (result.cleanupStatus === "DELETED") return;
    try {
      await this.ports.cleanup(result.task);
      result.cleanupStatus = "DELETED";
    } catch {
      result.cleanupStatus = "PENDING_RETRY";
    }
    await this.ports.save(result);
  }
}
