import { canonical } from "../../domain/json.js";
import { DomainError } from "../../domain/errors.js";
import type { SchemaPorts, SchemaResult, SchemaTask } from "./types.js";
import { SchemaTaskRunner } from "./task-runner.js";

export class SchemaTaskService {
  private readonly runner: SchemaTaskRunner;
  private readonly running = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private accepting: Promise<void> = Promise.resolve();
  constructor(private readonly ports: SchemaPorts) {
    this.runner = new SchemaTaskRunner(ports);
  }
  accept(task: SchemaTask, bytes: Uint8Array): Promise<SchemaResult> {
    const result = this.accepting.then(() => this.persist(task, bytes));
    this.accepting = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private async persist(task: SchemaTask, bytes: Uint8Array): Promise<SchemaResult> {
    const existing = await this.ports.read(task.auditId);
    if (existing) {
      if (canonical(existing.task) !== canonical(task))
        throw new DomainError("IDEMPOTENCY_CONFLICT");
      return existing;
    }
    if (
      (await this.ports.list()).some((result) =>
        ["PENDING", "RUNNING", "VERIFYING", "RECONCILING"].includes(result.status),
      )
    )
      throw new DomainError("SCHEMA_TASK_IN_PROGRESS");
    await this.ports.authorize(task);
    await this.ports.validate(task, bytes);
    const result: SchemaResult = {
      task,
      status: "PENDING",
      observedVersion: task.fromVersion,
      acceptedAt: new Date().toISOString(),
      cleanupStatus: "RETAINED_UNTIL_ACK",
      steps: [],
    };
    await this.ports.saveBundle(task, bytes);
    await this.ports.save(result);
    this.ports.busy(true);
    this.enqueue(result);
    return structuredClone(result);
  }
  private enqueue(result: SchemaResult): void {
    if (this.running.has(result.task.auditId)) return;
    this.running.add(result.task.auditId);
    this.queue = this.queue
      .then(() => this.runner.run(result))
      .catch(() => {
        this.ports.busy(true);
      })
      .finally(() => {
        this.running.delete(result.task.auditId);
      });
  }
  async get(auditId: string): Promise<SchemaResult> {
    const result = await this.ports.read(auditId);
    if (!result) throw new DomainError("NOT_FOUND");
    return result;
  }
  async recover(): Promise<void> {
    for (const result of await this.ports.list()) {
      if (["PENDING", "RUNNING", "VERIFYING", "RECONCILING"].includes(result.status)) {
        this.ports.busy(true);
        this.enqueue(result);
      } else if (["VERIFIED", "FAILED", "NEEDS_ATTENTION"].includes(result.status))
        await this.runner.deliver(result);
    }
  }
  async acknowledge(auditId: string, attemptNo: number, storedStatus: string): Promise<void> {
    const result = await this.get(auditId);
    if (
      result.task.attemptNo !== attemptNo ||
      result.status !== storedStatus ||
      !["VERIFIED", "FAILED", "NEEDS_ATTENTION"].includes(result.status)
    )
      throw new DomainError("INVALID_REPORT_ACK");
    result.reported = true;
    await this.ports.save(result);
    await this.runner.deliver(result);
  }
  async reconcile(): Promise<void> {
    for (const result of await this.ports.list())
      if (result.status === "RECONCILING") this.enqueue(result);
  }
  async retryReports(): Promise<void> {
    for (const result of await this.ports.list())
      if (["VERIFIED", "FAILED", "NEEDS_ATTENTION", "RECONCILING"].includes(result.status))
        await this.runner.deliver(result);
  }
  async drain(): Promise<void> {
    await this.accepting;
    await this.queue;
  }
}
