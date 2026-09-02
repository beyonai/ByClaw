import {
  ConnectorRegistry,
  RunService,
  type ConnectorHealth,
} from "@byclaw/by-conductor";
import type { PostgresDatabase } from "@byclaw/storage-postgres";
import type { ByFrameworkWorkerRuntime } from "../worker/by-framework-runtime.js";

/** /byclawSuper/ready 对外暴露的聚合就绪报告。 */
export interface ReadinessReport {
  ready: boolean;
  pi: { healthy: boolean; message?: string; model?: string };
  database: {
    healthy: boolean;
    message?: string;
    listener?: { healthy: boolean; message?: string };
  };
  connectors: Record<string, ConnectorHealth>;
  worker: {
    enabled: boolean;
    healthy: boolean;
    workerId?: string;
    agentType?: string;
    message?: string;
  };
}

export interface CollectReadinessInput {
  runService: RunService;
  connectors: ConnectorRegistry;
  database: PostgresDatabase;
  worker: { enabled: boolean; runtime?: ByFrameworkWorkerRuntime };
}

/** 聚合 /byclawSuper/ready 需要的健康信号：数据库、Pi、连接器与 Worker。 */
export async function collectReadiness(input: CollectReadinessInput): Promise<ReadinessReport> {
  const { runService, connectors, database, worker } = input;
  const [pi, connectorHealth, workerHealth] = await Promise.all([
    runService.health(),
    connectors.health(),
    worker.runtime?.health() ??
      Promise.resolve<{ healthy: boolean; message?: string }>({ healthy: true }),
  ]);
  const schemaHealth = await database.health();
  const listenerHealth = database.events.listenerHealth();
  const databaseHealth = {
    ...schemaHealth,
    healthy: schemaHealth.healthy && listenerHealth.healthy,
    listener: listenerHealth,
  };
  const workerReport = {
    enabled: worker.enabled,
    healthy: workerHealth.healthy,
    ...(worker.runtime
      ? { workerId: worker.runtime.workerId, agentType: worker.runtime.agentType }
      : {}),
    ...(workerHealth.message ? { message: workerHealth.message } : {}),
  };
  return {
    ready:
      databaseHealth.healthy &&
      pi.healthy &&
      Object.values(connectorHealth).every((health) => health.healthy) &&
      workerReport.healthy,
    pi,
    database: databaseHealth,
    connectors: connectorHealth,
    worker: workerReport,
  };
}
