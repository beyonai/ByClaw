import { publicResult } from "../../application/schema/result-view.js";
import type { Config } from "../../config.js";
import type { SchemaResult } from "../../application/schema/types.js";
import { DomainError } from "../../domain/errors.js";
import type { MtlsClient } from "../http/mtls-client.js";

/** mTLS 读取平台审计当前版本并回报任务结果；平台 tenant_schema_audit 由 BE 落库。 */
export class BeSchemaClient {
  constructor(
    private readonly config: Config,
    private readonly client: MtlsClient,
  ) {}
  async currentVersion(): Promise<string | null> {
    const body = await this.client.json<Record<string, unknown>>(
      `${this.config.beUrl}/internal/v1/tenants/${this.config.enterpriseId}/schema/current`,
    );
    if (body?.currentVersion === null && body.observedVersion === undefined) return null;
    if (
      body?.isCurrent !== true ||
      typeof body.observedVersion !== "string" ||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(body.observedVersion)
    )
      throw new DomainError("INVALID_SCHEMA_AUDIT");
    return body.observedVersion;
  }
  async report(result: SchemaResult): Promise<void> {
    await this.client.json(
      `${this.config.beUrl}/internal/v1/tenantSchemaTaskReports`,
      "POST",
      publicResult(result),
    );
  }
}
