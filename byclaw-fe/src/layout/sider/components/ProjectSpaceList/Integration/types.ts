export type IntegrationStage = {
  id: string;
  name: string;
  interpreter: 'bash' | 'sh' | 'python' | 'node';
  // inline: script 为脚本正文;path: script 为仓库/远程内的脚本文件路径。
  source: 'inline' | 'path';
  script: string;
  workdir: string;
  timeoutSec: number;
  continueOnError: boolean;
};

// 被测应用的业务测试账号:E2E 用例登录用。密码不入库,只存凭据引用(实际值在 ~/.openclaw/credentials/)。
// 编排层按 envPrefix 注入环境变量:<PREFIX>_USER / <PREFIX>_PASS,脚本直接读 $E2E_ADMIN_USER 等。
export type TestAccount = {
  id: string;
  role: string; // 角色说明,如 管理员 / 普通用户 / 审批人
  envPrefix: string; // 环境变量前缀,如 E2E_ADMIN
  username: string;
  credentialRef: string; // 密码凭据 key,指向 ~/.openclaw/credentials/,不存明文
};

// 手动测试用例:无法自动化的场景由人工按步骤执行、逐条记录结果。
export type ManualCase = {
  id: string;
  title: string;
  steps: string; // 操作步骤(多行)
  expected: string; // 预期结果
};

// 端到端测试用例集:自动化套件是独立工程(pytest/playwright/jest…),按运行命令执行、按报告路径收结果;
// manual 套件是人工检查清单,由测试人执行并逐条记录,平台把记录汇总成与自动化一致的套件结果。
export type TestSuite = {
  id: string;
  name: string;
  runner: 'pytest' | 'playwright' | 'jest' | 'vitest' | 'custom' | 'manual';
  // git: 独立测试工程仓库;shared: 共享空间已有的用例目录。manual 套件不需要来源仓库。
  sourceType: 'git' | 'shared';
  source: string;
  branch: string;
  runCommand: string;
  workdir: string;
  // 结果解析:自动化套件产出 JUnit XML,后端统一读该文件汇总通过率;manual 套件由平台按人工记录生成同构结果。
  reportPath: string;
  caseCount: number;
  enabled: boolean;
  // 仅 manual 套件:V2 下清单不入库,登记仓库内清单文件路径;manualCases 是平台读取该文件后解析出的预览(只读)。
  manualFile?: string;
  manualCases?: ManualCase[];
};

// 一次 E2E 运行的结果详情:对应 status.json + 各套件 JUnit + artifacts,供"查看结果"页展示。
export type IntegrationRunSuiteResult = {
  suiteId: string;
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  total: number;
  passed: number;
  failed: number;
  durationSec: number;
  reportPath: string;
  logPath: string;
  // 失败用例:名字 + 失败信息 + 截图/artifacts 相对路径(平台按用例ID挂上)。
  failedCases: Array<{ caseId: string; message: string; artifacts: string[] }>;
};

export type IntegrationRunResult = {
  runId: string;
  version: string;
  status: 'passed' | 'failed' | 'error' | 'timeout';
  round: number;
  branch: string;
  commit: string;
  envName: string;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  totals: { total: number; passed: number; failed: number; skipped: number };
  // 打回目标环节 + 原因(失败时;成功为空)。
  kickbackTo: string;
  reason: string;
  resultDir: string;
  suites: IntegrationRunSuiteResult[];
};

// V2:一个需求下的一个子任务。集成挂在需求级,一个需求常拆成多任务、分布在不同仓库,
// E2E 要测的是这些分支拼在一起能不能跑,所以要按图判断"何时该跑"(全部 coded)和"失败打回给谁"。
export type RequirementTask = {
  id: string;
  repo: string; // 所在仓库,如 byclaw-fe / byclaw-be / byclaw-middleware
  branch: string; // 该任务的工作分支
  // 子任务在自己 dev-loop 里的当前环节;集成就绪门禁看是否所有子任务都已到 coded 及以后。
  phase: 'coder' | 'reviewer' | 'tester' | 'pr' | 'done';
  coded: boolean; // 是否已完成编码(就绪判定的最小条件)
};

// V2:需求级集成状态机。任务过 pr ≠ 需求集成通过,需求级是叠在任务级 7 环节之上的新一层。
export type RequirementIntegrationStatus =
  | 'waiting_ready' // 还有子任务没 coded,未就绪
  | 'ready' // 已就绪,等下次定时批量集成
  | 'running' // 集成中
  | 'failed' // 集成失败:X 条用例挂,已按图打回若干任务
  | 'passed'; // 集成通过

// V2:需求级集成条目。承载"需求→多任务→多仓库"的图与上次集成结果,供需求级集成视图渲染。
export type RequirementIntegration = {
  reqId: string;
  reqNo: string; // 需求号
  reqName: string;
  tasks: RequirementTask[];
  status: RequirementIntegrationStatus;
  round: number; // 集成轮次(打回一次 +1)
  lastRunId: string; // 关联到 integrationResultMap 的结果,可点开查看
  lastRunAt: string;
  passRate: string; // 上次通过率,如 15/18
  // 失败时:按图归因,失败分发到了哪些任务(仓库/分支)。
  kickbackTasks: Array<{ repo: string; branch: string; reason: string }>;
};
