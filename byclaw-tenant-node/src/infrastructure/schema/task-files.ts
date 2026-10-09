import { readFile } from "node:fs/promises";
import type { SchemaResult, SchemaTask } from "../../application/schema/types.js";
import { JsonStore } from "../files/json-store.js";

/**
 * 按 auditId 保存 JSON 状态与 ZIP 制品。
 * 文档要求写入 Node 持久卷；JSON 格式是实现选择，正式审计由 BE 管理。
 * 目录按 generation 隔离且仅支持单进程写入，容器重建必须复用状态卷。
 */
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
  /** 只删除上传制品；保留 JSON 结果供查询、幂等返回与回报重试。 */
  cleanup(task: SchemaTask) {
    return this.files.remove(`${task.auditId}.zip`);
  }
}
