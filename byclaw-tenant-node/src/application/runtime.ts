import type { ConnectionManager } from "./connection-manager.js";
import type { SchemaTaskService } from "./schema/task-service.js";

export interface RuntimePorts {
  checkSchema(): Promise<void>;
  schemaState(): {
    observedVersion: string | null;
    auditedVersion: string | null;
    verified: boolean;
  };
  worker: { active: boolean; update(connected: boolean): Promise<void>; close(): Promise<void> };
  discovery: {
    active: boolean;
    update(connected: boolean, ready: boolean, version: string | null): Promise<void>;
    close(): Promise<void>;
  };
  streams: {
    active: boolean;
    initialized: boolean;
    start(): Promise<void>;
    sample(): Promise<void>;
    close(): Promise<void>;
    metrics: unknown;
  };
  warn(code: string): void;
}
/** 串行对账连接、Schema、任务与服务组件，并汇总开通验收和业务就绪状态。 */
export class TenantRuntime {
  private tick?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private recovered = false;
  private stopped = false;
  constructor(
    private readonly connection: ConnectionManager,
    private readonly tasks: SchemaTaskService,
    private readonly ports: RuntimePorts,
  ) {}
  get provisioned(): boolean {
    return (
      !this.stopped &&
      this.connection.provisioned &&
      this.ports.worker.active &&
      this.ports.discovery.active &&
      this.ports.streams.initialized
    );
  }
  get ready(): boolean {
    return (
      !this.stopped &&
      this.connection.ready &&
      this.ports.worker.active &&
      this.ports.discovery.active &&
      this.ports.streams.active
    );
  }
  health() {
    return {
      mode: this.ready ? "READY" : "ADMIN_ONLY",
      dbWritable: this.connection.connected,
      worker: this.ports.worker.active,
      https: !this.stopped,
      businessReady: this.ready,
      schema: this.ports.schemaState(),
      streams: this.ports.streams.metrics,
    };
  }
  async start(): Promise<void> {
    await this.reconcile();
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 5000);
  }
  /** 定时和手动触发共用一次在途对账，避免恢复任务被重复入队。 */
  reconcile(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.tick ??= this.update().finally(() => {
      this.tick = undefined;
    });
    return this.tick;
  }
  private async update(): Promise<void> {
    try {
      await this.connection.refresh();
      if (!this.recovered) {
        await this.tasks.recover();
        this.recovered = true;
      }
      await this.tasks.retryReports();
      await this.tasks.reconcile();
      if (!this.connection.upgrading) {
        try {
          await this.ports.checkSchema();
        } catch {
          this.connection.setSchemaReady(false);
          this.ports.warn("SCHEMA_VERIFICATION_DEFERRED");
        }
      }
      await this.ports.worker.update(true);
      await this.ports.streams.start();
      await this.ports.streams.sample();
      await this.ports.discovery.update(
        true,
        this.connection.ready,
        this.ports.schemaState().observedVersion,
      );
    } catch (error) {
      this.ports.warn(
        error instanceof Error && "code" in error ? String(error.code) : "RUNTIME_RECONCILE_FAILED",
      );
      if (!this.connection.connected) {
        await Promise.allSettled([this.ports.worker.close(), this.ports.discovery.close()]);
      }
    }
  }
  /** 先关闭业务门禁，再停止消费者并等待 Schema 任务；保持连接直到任务收尾。 */
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.connection.setSchemaReady(false);
    await this.tick;
    this.connection.setSchemaReady(false);
    await Promise.allSettled([
      this.ports.worker.close(),
      this.ports.discovery.close(),
      this.ports.streams.close(),
    ]);
    await this.tasks.drain();
  }
}
