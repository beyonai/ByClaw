export type WikiRepositoryConfig = {
  id: string;
  remoteUrl: string;
  branch: string;
  localPath?: string;
};

export type ResolvedWikiRepositoryConfig = WikiRepositoryConfig & {
  localPath: string;
};

export type ByclawWikiPluginConfig = {
  repositories?: unknown;
  dataDir?: unknown;
  timezone?: unknown;
  syncDayOfWeek?: unknown;
  syncHour?: unknown;
  syncMinute?: unknown;
  runOnStartup?: unknown;
  toolName?: unknown;
  httpPath?: unknown;
  gitCommand?: unknown;
  codegraphCommand?: unknown;
  commandTimeoutMs?: unknown;
  maxOutputBytes?: unknown;
  retryInitialDelayMs?: unknown;
  retryMaxDelayMs?: unknown;
  retryMaxAttempts?: unknown;
  includeRawOutputInToolResult?: unknown;
  gitDepth?: unknown;
  notificationWebhookUrl?: unknown;
  notificationDingtalkAccessToken?: unknown;
  notificationDingtalkSecret?: unknown;
  notificationDingtalkActionCardBtnTitle?: unknown;
  notificationDingtalkActionCardBtnUrl?: unknown;
  notificationDocumentUploadUrl?: unknown;
  notificationDocumentUploadPrefix?: unknown;
  notificationRobotType?: unknown;
  notificationMaxOutputChars?: unknown;
  notificationMinOutputChars?: unknown;
};

export type NotificationRobotType = "generic" | "wecom" | "dingtalk" | "feishu";

export type ResolvedNotificationConfig = {
  webhookUrl?: string;
  dingtalkAccessToken?: string;
  dingtalkSecret?: string;
  dingtalkActionCardBtnTitle: string;
  dingtalkActionCardBtnUrl: string;
  documentUploadUrl: string;
  documentUploadPrefix: string;
  robotType: NotificationRobotType;
  maxOutputChars: number;
  minOutputChars: number;
};

export type ResolvedByclawWikiConfig = {
  repositories: ResolvedWikiRepositoryConfig[];
  defaultRepositoryId: string;
  dataDir: string;
  timezone: string;
  syncDayOfWeek: number;
  syncHour: number;
  syncMinute: number;
  runOnStartup: boolean;
  toolName: string;
  httpPath: string;
  gitCommand: string;
  codegraphCommand: string;
  commandTimeoutMs: number;
  maxOutputBytes: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  retryMaxAttempts: number;
  includeRawOutputInToolResult: boolean;
  gitDepth: number;
  notification: ResolvedNotificationConfig;
};

export type CommandResult = {
  ok: boolean;
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

export type RepositorySyncStatus = {
  repositoryId: string;
  remoteUrl: string;
  branch: string;
  localPath: string;
  state: "idle" | "syncing" | "ready" | "error";
  lastSyncStartedAt?: string;
  lastSyncFinishedAt?: string;
  lastIndexedAt?: string;
  lastCommit?: string;
  lastError?: string;
  retryCount?: number;
  nextRetryAt?: string;
};

export type CodegraphMode =
  | "explore"
  | "query"
  | "node"
  | "files"
  | "callers"
  | "callees"
  | "impact"
  | "status"
  | "notify_document";

export type CodeToWikiRequest = {
  repositoryId?: string;
  mode?: CodegraphMode;
  question?: string;
  query?: string;
  target?: string;
  symbol?: string;
  limit?: number;
  maxDepth?: number;
  filter?: string;
  documentTitle?: string;
  documentMarkdown?: string;
};

export type CodegraphToolResult = {
  ok: boolean;
  repository: {
    id: string;
    remoteUrl: string;
    branch: string;
    localPath: string;
  };
  mode: CodegraphMode;
  output?: string;
  outputBytes?: number;
  outputOmitted?: boolean;
  status?: RepositorySyncStatus;
  error?: {
    code: string;
    message: string;
  };
  command?: Omit<CommandResult, "stdout" | "stderr"> & {
    stdoutBytes: number;
    stderrBytes: number;
  };
  notification?: {
    attempted: boolean;
    ok?: boolean;
    skippedReason?: string;
    statusCode?: number;
    error?: string;
    uploadedDocument?: {
      key: string;
      name: string;
      size: number;
      contentType: string;
    };
  };
};
