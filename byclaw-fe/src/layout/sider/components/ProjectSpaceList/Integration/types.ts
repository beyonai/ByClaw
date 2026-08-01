// V2:独立测试数字员工。E2E 从「每个任务各自跑」收敛到「需求级、由一个独立测试员工定时批量执行」。
// 这个配置回答三件事:谁来测(绑定的数字员工)、什么时候测(定时节流 + 就绪准入)、失败怎么办(打回策略)。
export type TesterAgentOption = {
  agentId: string;
  name: string;
  // 头像:数字员工的展示头像 URL(演示态用占位)。
  avatar?: string;
  // 擅长栈,仅用于挑选时展示,不参与逻辑。
  skills: string[];
};

// 定时节流:cron 决定「多久看一次」,不是「到点必跑」。到点时只挑「已就绪」的需求批量测。
export type TesterSchedule = {
  cron: string; // 标准 5 段 cron,如 0 2 * * *(每日 02:00)
  cronLabel: string; // 人话展示,如 每日 02:00
  timezone: string; // 计算下次运行用的时区,如 Asia/Shanghai
};

// 就绪准入:定时到点后,一个需求要满足这些条件才纳入本轮批量集成。
export type TesterAdmission = {
  // 就绪门禁:需求下所有子任务都完成编码(coded)才纳入。关掉则只要有任务 coded 就试跑(不推荐)。
  requireAllCoded: boolean;
  // 单轮最多并行几个需求的 E2E,防止把集成环境打满。
  maxConcurrentReqs: number;
};

// 失败打回策略:集成失败后如何归因、回灌到 dev-loop。
export type TesterKickback = {
  // 按依赖图自动归因到责任任务并打回其编码环节(轮次 +1)。
  autoAttribute: boolean;
  // 归因不清时新建「集成缺陷」任务,而不是硬塞给已完成的任务。
  createDefectWhenUnclear: boolean;
  // 同一需求最多自动打回多少轮,超过则升级为人工介入,避免死循环。
  maxRounds: number;
};

// V2:独立测试员工总配置。挂在需求级集成之上,是「定时集成」那条 banner 背后的真实配置。
export type TesterConfig = {
  enabled: boolean; // 关掉则退回人工触发集成,不自动定时
  agentId: string; // 绑定的独立测试数字员工
  schedule: TesterSchedule;
  admission: TesterAdmission;
  kickback: TesterKickback;
};

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
  // 登录密码明文,提交后端 SM4 加密存密文;编辑时后端不回显,回填为空,留空=保持原值。
  credentialRef: string;
  // 编辑既有账号时后端只回是否已设密码(密文不回显),用于密码框占位提示。
  hasCredential?: boolean;
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
  // running 为执行中(轮询态);其余为终态。
  status: 'running' | 'passed' | 'failed' | 'error' | 'timeout';
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
  // 执行步骤明细(后端契约外补充):stages + 套件命令逐步进度,轮询时展示。
  steps?: IntegrationRunStep[];
};

// 一次执行内的单步(环境 stage 或套件命令),对齐后端 runStepToVo。
export type IntegrationRunStep = {
  seq: number;
  stepType: 'stage' | 'suite';
  stepName: string;
  exitCode?: number;
  status: 'running' | 'passed' | 'failed' | 'error' | 'timeout' | 'skipped';
  durationSec: number;
  logText?: string;
  startedAt?: string;
  finishedAt?: string;
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
