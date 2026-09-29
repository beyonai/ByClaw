import { readFile } from "node:fs/promises";
import type { SchemaResult, SchemaTask } from "../../application/schema/types.js";
import { JsonStore } from "../files/json-store.js";

export class SchemaTaskFiles {
  constructor(private readonly files: JsonStore) {}
  read(auditId: string) {
    return this.files.read<SchemaResult>(`${auditId}.json`);
  }
  save(result: SchemaResult) {
    return this.files.write(`${result.task.auditId}.json`, result);
  }
  saveBundle(task: SchemaTask, bytes: Uint8Array) {
    return this.files.bytes(`${task.auditId}.zip`, Buffer.from(bytes));
  }
  async loadBundle(task: SchemaTask) {
    return readFile(this.files.path(`${task.auditId}.zip`));
  }
  async list(): Promise<SchemaResult[]> {
    const names = (await this.files.names()).filter((name) => name.endsWith(".json"));
    const results = await Promise.all(names.map((name) => this.files.read<SchemaResult>(name)));
    return results.filter((result): result is SchemaResult => result !== undefined);
  }
  cleanup(task: SchemaTask) {
    return this.files.remove(`${task.auditId}.zip`);
  }
}
