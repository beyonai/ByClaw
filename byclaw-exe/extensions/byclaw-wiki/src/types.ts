export const CODE_TO_WIKI_TOOL_NAME = "code_to_wiki";
export const BYCLAW_WIKI_HTTP_PATH = "/plugins/byclaw-wiki";

export type ByclawWikiPluginConfig = {
  dataDir?: unknown;
  gitCommand?: unknown;
  codegraphCommand?: unknown;
  zreadCommand?: unknown;
  zreadHome?: unknown;
  commandTimeoutMs?: unknown;
  maxOutputBytes?: unknown;
  zreadTimeoutMs?: unknown;
  zreadMaxOutputBytes?: unknown;
  redisHost?: unknown;
  redisPort?: unknown;
  redisUsername?: unknown;
  redisPassword?: unknown;
  redisDatabase?: unknown;
  redisConnectTimeoutMs?: unknown;
  zreadAimodelEnabled?: unknown;
  zreadAimodelConfigRedisKey?: unknown;
  zreadAimodelTypeListRedisKey?: unknown;
  zreadAimodelTypeListField?: unknown;
  zreadAimodelModelId?: unknown;
  zreadAimodelProvider?: unknown;
  zreadLlmProvider?: unknown;
  zreadLlmModel?: unknown;
  zreadLlmBaseUrl?: unknown;
  zreadLlmApiKey?: unknown;
  zreadLlmApiKeyEnv?: unknown;
  zreadMaxConcurrent?: unknown;
  zreadMaxRetries?: unknown;
  includeRawOutputInToolResult?: unknown;
  gitDepth?: unknown;
};

export type ResolvedByclawWikiConfig = {
  dataDir: string;
  gitCommand: string;
  codegraphCommand: string;
  zreadCommand: string;
  zreadHome: string;
  commandTimeoutMs: number;
  maxOutputBytes: number;
  zreadTimeoutMs: number;
  zreadMaxOutputBytes: number;
  redisHost?: string;
  redisPort?: number;
  redisUsername?: string;
  redisPassword?: string;
  redisDatabase?: number;
  redisConnectTimeoutMs: number;
  zreadAimodelEnabled: boolean;
  zreadAimodelConfigRedisKey: string;
  zreadAimodelTypeListRedisKey: string;
  zreadAimodelTypeListField: string;
  zreadAimodelModelId?: string;
  zreadAimodelProvider?: string;
  zreadLlmProvider?: string;
  zreadLlmModel?: string;
  zreadLlmBaseUrl?: string;
  zreadLlmApiKey?: string;
  zreadLlmApiKeyEnv?: string;
  zreadMaxConcurrent: number;
  zreadMaxRetries: number;
  includeRawOutputInToolResult: boolean;
  gitDepth: number;
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

export type RepositoryRef = {
  repositoryUrl: string;
  branch?: string;
  gitDepth?: number;
  credentialRef?: string;
};

export type RepositoryRuntimeStatus = {
  repositoryUrl: string;
  sanitizedRepositoryUrl: string;
  branch?: string;
  localPath: string;
  state: "missing" | "ready" | "error";
  cloned: boolean;
  codegraphIndexed: boolean;
  zreadWikiExists: boolean;
  zreadCurrentVersion?: string;
  lastIndexedAt?: string;
  lastCommit?: string;
  lastError?: string;
};

export type CodegraphQueryMode = "explore" | "query" | "node" | "files" | "callers" | "callees" | "impact";

export type CodeToWikiMode =
  | "status"
  | "pull"
  | CodegraphQueryMode
  | "wiki_status"
  | "wiki_generate"
  | "wiki_list"
  | "wiki_read"
  | "wiki_clear_draft";

export type CodeToWikiRequest = RepositoryRef & {
  mode?: CodeToWikiMode;
  refresh?: boolean;
  question?: string;
  query?: string;
  target?: string;
  symbol?: string;
  limit?: number;
  maxDepth?: number;
  filter?: string;
  wikiVersion?: string;
  wikiPage?: string;
  draftAction?: "resume" | "clear" | "cancel";
  skipFailed?: boolean;
  yes?: boolean;
};

export type ZreadStatus = {
  installed: boolean;
  version?: string;
  hasLogin: boolean;
  hasConfig: boolean;
  configPath: string;
  homePath: string;
  modelConfigured: boolean;
  modelSource: "redis" | "config" | "existing" | "none";
  modelProvider?: string;
  modelName?: string;
  modelBaseUrl?: string;
  modelConfigError?: string;
  hasCurrentWiki: boolean;
  hasDraft: boolean;
  currentVersion?: string;
  pageCount: number;
};

export type WikiPage = {
  slug: string;
  title: string;
  file: string;
  path: string;
  markdown?: string;
};

export type CodeToWikiToolResult = {
  ok: boolean;
  repository?: {
    repositoryUrl: string;
    branch?: string;
    localPath: string;
  };
  mode: CodeToWikiMode;
  output?: string;
  outputBytes?: number;
  outputOmitted?: boolean;
  status?: RepositoryRuntimeStatus;
  zread?: ZreadStatus;
  wiki?: {
    version: string;
    rootPath: string;
    pages?: WikiPage[];
    page?: WikiPage;
  };
  error?: {
    code: string;
    message: string;
  };
  command?: Omit<CommandResult, "stdout" | "stderr"> & {
    stdoutBytes: number;
    stderrBytes: number;
  };
};
