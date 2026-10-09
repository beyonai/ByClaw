export interface SchemaScript {
  version: string;
  parentVersion: string | null;
  path: string;
  sha256: string;
}
/** BE 指定的一次 INIT/UPDATE 尝试；auditId 标识审计行，scripts 明确指定执行链。 */
export interface SchemaTask {
  protocolVersion: 1;
  auditId: string;
  requestId: string;
  attemptNo: number;
  enterpriseId: string;
  dbSandboxRecordId: string;
  generation: string;
  fencingToken: string;
  operationType: "INIT" | "UPDATE";
  triggerType: "MANUAL" | "AUTO_PROVISION" | "AUTO_RELEASE_UPGRADE";
  byclawReleaseVersion: string;
  fromVersion: string | null;
  targetVersion: string;
  bundleDigest: string;
  deadline: string;
  scripts: SchemaScript[];
}
export interface SchemaObject {
  kind: "table" | "index" | "sequence";
  name: string;
}
/** 发布制品约定：对象清单限制 SQL 操作，catalogDigest 核验本版完成后的整个 byai 结构。 */
export interface SchemaManifest {
  version: string;
  parentVersion: string | null;
  engine: "openGauss";
  nodeProtocol: { min: number; max: number };
  sqlSha256: string;
  catalogDigest: string;
  objects: SchemaObject[];
}
export interface VerifiedScript {
  script: SchemaScript;
  manifest: SchemaManifest;
  statements: string[];
}
/** 与本版 DDL 同事务提交的库内标记，用于确认提交和恢复；平台当前版本仍以 BE 审计为准。 */
export interface SchemaMarker {
  protocolVersion: 1;
  enterpriseId: string;
  version: string;
  catalogDigest: string;
  scriptDigest: string;
}
export type SchemaStatus =
  | "PENDING"
  | "RUNNING"
  | "VERIFYING"
  | "VERIFIED"
  | "FAILED"
  | "RECONCILING"
  | "NEEDS_ATTENTION";
/** 持久卷上的任务记录：保存阶段、逐版进度和回报/清理状态，查询与恢复都读取此记录。 */
export interface SchemaResult {
  task: SchemaTask;
  status: SchemaStatus;
  observedVersion: string | null;
  acceptedAt: string;
  startedAt?: string;
  finishedAt?: string;
  failureStage?: string;
  failureVersion?: string;
  failureScript?: string;
  errorCode?: string;
  sqlState?: string;
  failureReason?: string;
  cleanupStatus: "RETAINED_UNTIL_ACK" | "PENDING_RETRY" | "DELETED";
  reported?: boolean;
  steps: { version: string; status: string }[];
}
export interface SchemaExecution {
  marker(): Promise<SchemaMarker | null>;
  empty(): Promise<boolean>;
  verify(manifest: SchemaManifest): Promise<void>;
  execute(
    statements: string[],
    marker: SchemaMarker,
    beforeCommit?: () => Promise<void>,
  ): Promise<void>;
}
/** 任务应用层依赖的能力；文件、数据库锁、授权和 BE 回报由基础设施适配。 */
export interface SchemaPorts {
  validate(task: SchemaTask, bundle: Uint8Array): Promise<VerifiedScript[]>;
  saveBundle(task: SchemaTask, bundle: Uint8Array): Promise<void>;
  loadBundle(task: SchemaTask): Promise<Uint8Array>;
  read(auditId: string): Promise<SchemaResult | undefined>;
  save(result: SchemaResult): Promise<void>;
  list(): Promise<SchemaResult[]>;
  cleanup(task: SchemaTask): Promise<void>;
  locked<T>(work: (execution: SchemaExecution) => Promise<T>): Promise<T>;
  authorize(task: SchemaTask, allowExpired?: boolean): Promise<void>;
  currentVersion(): Promise<string | null>;
  report(result: SchemaResult): Promise<void>;
  busy(value: boolean): void;
}

export interface SchemaState {
  observedVersion: string | null;
  auditedVersion: string | null;
  verified: boolean;
}
