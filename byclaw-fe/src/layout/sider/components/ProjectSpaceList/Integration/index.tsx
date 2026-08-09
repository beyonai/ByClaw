import React, { useEffect, useState } from 'react';
import {
  Button,
  Collapse,
  ConfigProvider,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Radio,
  Segmented,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BookOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  ExclamationCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ProfileOutlined,
  RightOutlined,
  RobotOutlined,
  SearchOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
// 复用消息区的文件预览弹窗(内部就是 Preview/Twins),报告 xml 走它的 source 页签 + 下载按钮,不另写预览组件。
import Previewer from '@/components/MessageList/components/FileRender/components/Previewer';
import {
  createIntegrationEnv,
  createIntegrationSuite,
  deleteIntegrationEnv,
  deleteIntegrationSuite,
  getIntegrationRun,
  getIntegrationRunReport,
  listIntegrationEnvs,
  listIntegrationRuns,
  listIntegrationRunsByEnv,
  listIntegrationSuites,
  startIntegrationRun,
  resolveDefaultAgent,
  getTesterConfig,
  saveTesterConfig,
  runTesterBatch,
  listRequirementIntegrations,
  toggleIntegrationSuite,
  updateIntegrationEnv,
  updateIntegrationSuite,
} from '@/service/devloop';
import styles from './index.module.less'; // 集成测试专用类
import parentStyles from '../index.module.less'; // 共享 chrome 类(与渠道/来源卡片共用,DRY 保留在父级)
import { DEFAULT_TESTER_CONFIG } from './mock';
// 契约常量与规范页共用一份,避免弹框文案与规范页各自漂移。
import { E2E_RUN_HARD_RULES, E2E_SPEC_PATH, E2E_SPEC_SECTIONS, E2E_SUITE_HARD_RULES } from '@/pages/spec/contracts';
import { copyTextToClipboard } from '@/utils/copy';
import { getRuntimeActualUrl } from '@/utils';
import type {
  IntegrationRunResult,
  IntegrationStage,
  ManualCase,
  RequirementIntegration,
  RequirementIntegrationStatus,
  TestAccount,
  TesterConfig,
  TestSuite,
} from './types';

// 复用项目已配置的仓库(与渠道/需求「关联仓库」同源),测试集 git 来源从中选,不再手输 URL。
type RepoOption = {
  repoId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
};

type IntegrationProps = {
  active: boolean;
  projectId: number;
  repos: RepoOption[];
  embedded?: boolean;
};

// 后端集成环境VO:与 IntegrationEnvService.integrationEnvToVo 对齐。stages/testAccounts 落库为JSON字符串,取回后解析。
type IntegrationEnvVo = {
  envId: number;
  envName: string;
  address?: string;
  orchestrator?: 'script' | 'jenkins' | 'k8s' | 'webhook';
  connProtocol?: 'ssh' | 'local';
  connHost?: string;
  connPort?: string;
  connUser?: string;
  connAuth?: 'key' | 'password';
  // 安全:后端不回显密文,只回是否已配置;编辑时密码框留空即保持原值。
  hasConnCredential?: boolean;
  connWorkdir?: string;
  stages?: string;
  // testAccounts 内每个账号的 credentialRef 回显为空串,另带 hasCredential 布尔标记是否已设密码。
  testAccounts?: string;
};

// 用例集对外视图:后端 enabled 落库 '0'/'1',caseCount 为数字;manualCases 清单不入库,仅登记 manualFile。
type IntegrationSuiteVo = {
  suiteId: number;
  suiteName: string;
  runner?: TestSuite['runner'];
  sourceType?: TestSuite['sourceType'];
  repoId?: number;
  source?: string;
  branch?: string;
  runCommand?: string;
  workdir?: string;
  reportPath?: string;
  caseCount?: number;
  enabled?: string;
  manualFile?: string;
};

// 执行历史列表项:与后端 runToHistoryVo 对齐(passRate 为 0-100 整数,status 为 run 级状态)。
type IntegrationRunHistoryVo = {
  runId: string;
  suiteId: number;
  status: 'running' | 'passed' | 'failed' | 'error' | 'timeout';
  branch?: string;
  round?: number;
  passRate?: number;
  total?: number;
  passed?: number;
  failed?: number;
  kickbackTo?: string;
  reason?: string;
  durationSec?: number;
  time?: string;
  createByName?: string;
};

// 三种用例来源的展示文案:表驱动,新增来源时只改这里,避免卡片/弹窗各写一份三元。
const SUITE_SOURCE_LABEL_KEYS: Record<NonNullable<TestSuite['sourceType']>, string> = {
  code: 'integration.suite.sourceCode',
  standalone: 'integration.suite.sourceStandalone',
  env: 'integration.suite.sourceEnv',
};

const Integration: React.FC<IntegrationProps> = ({ active, projectId, repos, embedded = false }) => {
  const intl = useIntl();
  // 项目详情的所有固定界面文案统一从 detail 命名空间读取。
  const t = React.useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.detail.${id}` }, values),
    [intl]
  );
  // 规范深链:弹框/面板只放「违反即坏」的最小契约,完整契约与 demo 在规范页。
  // 新窗口打开,不打断当前填写;锚点让用户直接落到自己那一节,不用在长页里翻。
  // 必须过 getRuntimeActualUrl:部署前缀(如 /beyond/)是运行时 publicPath,裸路由拼出来会 404。
  const openSpec = (section: string) => {
    window.open(getRuntimeActualUrl(`${E2E_SPEC_PATH}#${section}`), '_blank', 'noopener');
  };
  const { setDetailPanel, clearDetailPanel } = React.useContext(SiderContentContext);
  // 集成测试配置(环境+用例集)内容多,沿用需求渠道配置模式:入口按钮打开右侧覆盖面板。
  const [integrationConfigOpen, setIntegrationConfigOpen] = useState(false);
  // 右侧覆盖层分「运行记录 / 配置」两页签:窄左栏放不下看板+日志,挪到右侧;默认停在运行记录。
  const [integrationPanelTab, setIntegrationPanelTab] = useState<'board' | 'config'>('board');
  // V2:独立测试数字员工配置(谁测 / 何时测 / 失败怎么打回)。绑定员工与全局「测试数字员工」同源,
  // 未单独指定时回填项目生效的测试默认员工(resolveDefaultAgent:项目覆盖合并到全局之上)。
  const [testerConfig, setTesterConfig] = useState<TesterConfig>(DEFAULT_TESTER_CONFIG);
  const [testerModalOpen, setTesterModalOpen] = useState(false);
  // 弹框内的草稿:确认才写回 testerConfig,取消不改。
  const [testerDraft, setTesterDraft] = useState<TesterConfig>(DEFAULT_TESTER_CONFIG);
  // 执行员工不在此配置:直接取项目生效的全局「测试数字员工」默认名(resolveDefaultAgent),只读展示。
  const [resolvedTesterName, setResolvedTesterName] = useState('');
  // 集成测试「新增测试用例集」弹框(静态演示态)。
  const [integrationSuiteModalOpen, setIntegrationSuiteModalOpen] = useState(false);
  // 查看态:弹框复用新增表单,只读展示,不给保存按钮。
  const [integrationSuiteReadOnly, setIntegrationSuiteReadOnly] = useState(false);
  // 手动测试执行:测试人逐条记录 通过/失败/跳过 + 备注 + 截图。
  const [manualRunOpen, setManualRunOpen] = useState(false);
  const [manualRunSuite, setManualRunSuite] = useState<IntegrationSuiteVo | null>(null);
  const [manualRunRecords, setManualRunRecords] = useState<
    Record<string, { result: 'pass' | 'fail' | 'skip' | ''; remark: string; shots: string[] }>
  >({});
  const [integrationSuiteForm, setIntegrationSuiteForm] = useState<{
    name: string;
    runner: TestSuite['runner'];
    sourceType: TestSuite['sourceType'];
    // git 来源权威关联走 repoId;source 冗余仓库 URL 供展示与数字员工 clone。
    repoId?: number;
    source: string;
    branch: string;
    runCommand: string;
    workdir: string;
    reportPath: string;
    // V2:手测清单也遵循"用例在仓库、我们只登记入口"——不在 DB 编辑,只登记仓库内清单文件路径。
    manualFile: string;
    manualCases: ManualCase[];
  }>({
    name: '',
    runner: 'pytest',
    sourceType: 'code',
    repoId: undefined,
    source: '',
    branch: 'main',
    runCommand: 'pytest -q --junitxml=report/junit.xml',
    workdir: '.',
    reportPath: 'report/junit.xml',
    manualFile: 'e2e/manual-cases.md',
    manualCases: [],
  });
  // 集成测试「关联环境」弹框(静态演示态,后端接口就绪后接真实保存)。
  // 真实可落地的脚本型适配器配置:连接信息 + 有序生命周期阶段(每阶段完整多行脚本)。
  const [integrationEnvModalOpen, setIntegrationEnvModalOpen] = useState(false);
  const [integrationEnvReadOnly, setIntegrationEnvReadOnly] = useState(false);
  const [integrationEnvTab, setIntegrationEnvTab] = useState('basic');
  const [integrationResultOpen, setIntegrationResultOpen] = useState(false);
  const [integrationResult, setIntegrationResult] = useState<IntegrationRunResult | null>(null);
  // 报告预览:原文不落库,点报告路径才去后端 SSH 取,取回后包成 Blob 交给通用预览弹窗。
  const [reportPreview, setReportPreview] = useState<{ open: boolean; blob: Blob | null; loading: boolean }>({
    open: false,
    blob: null,
    loading: false,
  });
  const [reportFileName, setReportFileName] = useState('');
  // 日志弹窗:按环境/套件粒度列出历次运行,点开某条复用 result Modal 看日志。
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logModalTarget, setLogModalTarget] = useState<{
    kind: 'suite' | 'env';
    id: number;
    name: string;
  } | null>(null);
  const [logRuns, setLogRuns] = useState<IntegrationRunHistoryVo[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [integrationEnvForm, setIntegrationEnvForm] = useState<{
    name: string;
    address: string;
    orchestrator: 'script' | 'jenkins' | 'k8s' | 'webhook';
    connProtocol: 'ssh' | 'local';
    connHost: string;
    connPort: string;
    connUser: string;
    connAuth: 'key' | 'password';
    // connCredentialRef 存明文密码/私钥,提交后端 SM4 加密;编辑态回填为空,留空=保持原值。
    connCredentialRef: string;
    // 编辑既有环境时,后端不回显密文,仅告知是否已配置,用于密码框占位提示。
    hasConnCredential: boolean;
    connWorkdir: string;
    stages: IntegrationStage[];
    testAccounts: TestAccount[];
  }>({
    name: '阿里云集成测试环境',
    address: 'https://it-integration.internal:8443',
    orchestrator: 'script',
    connProtocol: 'ssh',
    connHost: '10.0.12.34',
    connPort: '22',
    connUser: 'deploy',
    connAuth: 'key',
    connCredentialRef: '',
    hasConnCredential: false,
    connWorkdir: '/opt/byclaw/ci',
    stages: [
      {
        id: 'checkout',
        name: '拉取分支代码',
        interpreter: 'bash',
        source: 'inline',
        script:
          'set -e\ncd "$WORKDIR/ByClaw"\ngit fetch origin "${branch}"\ngit checkout "${branch}"\ngit reset --hard "${commit}"',
        workdir: '/opt/byclaw/ci',
        timeoutSec: 300,
        continueOnError: false,
      },
      {
        id: 'build',
        name: '构建前后端镜像',
        interpreter: 'bash',
        source: 'inline',
        script:
          'set -e\ncd "$WORKDIR/byclaw-middleware"\nbash build/build-fe.sh --tag "${branch}"\nbash build/build-be.sh --tag "${branch}"',
        workdir: '/opt/byclaw/ci',
        timeoutSec: 1800,
        continueOnError: false,
      },
      {
        id: 'deploy',
        name: '部署并拉起服务',
        interpreter: 'bash',
        source: 'inline',
        script: 'set -e\ncd "$WORKDIR/byclaw-middleware"\nsh deploy.sh update',
        workdir: '/opt/byclaw/ci',
        timeoutSec: 900,
        continueOnError: false,
      },
      {
        id: 'db-migrate',
        name: '清库 + 执行增量脚本',
        interpreter: 'bash',
        source: 'path',
        script: 'deploy/db/incremental/run-all.sh',
        workdir: '/opt/byclaw/ci',
        timeoutSec: 300,
        continueOnError: false,
      },
      {
        id: 'health-check',
        name: '健康检查(退出码0视为就绪)',
        interpreter: 'python',
        source: 'inline',
        script:
          'import sys, urllib.request\nurl = "${envAddress}/actuator/health"\ntry:\n    r = urllib.request.urlopen(url, timeout=5)\n    sys.exit(0 if r.status == 200 else 1)\nexcept Exception as e:\n    print(e); sys.exit(1)',
        workdir: '/opt/byclaw/ci',
        timeoutSec: 120,
        continueOnError: false,
      },
    ],
    testAccounts: [
      {
        id: 'acc-admin',
        role: '管理员',
        envPrefix: 'E2E_ADMIN',
        username: 'qa_admin',
        credentialRef: '',
      },
      {
        id: 'acc-user',
        role: '普通用户',
        envPrefix: 'E2E_USER',
        username: 'qa_user01',
        credentialRef: '',
      },
    ],
  });
  const handleCloseIntegrationConfig = () => {
    // 集成测试配置使用右侧覆盖层，关闭时同步清理覆盖内容，避免残留在其他页签。
    setIntegrationConfigOpen(false);
    clearDetailPanel?.();
  };
  // 集成测试环境:真实接口按项目加载;editingEnvId 为空=新增,有值=修改。
  const [integrationEnvList, setIntegrationEnvList] = useState<IntegrationEnvVo[]>([]);
  const [editingEnvId, setEditingEnvId] = useState<number | null>(null);

  const loadIntegrationEnvs = React.useCallback(async () => {
    if (!projectId) return;
    try {
      // POST 封装已解包到 data(见 checkFactoryRes),直接拿数组,勿再取 .data。
      const list = (await listIntegrationEnvs(projectId)) as IntegrationEnvVo[] | null;
      setIntegrationEnvList(list || []);
    } catch (e) {
      // 加载失败不阻断页面,仅置空;错误交给全局请求拦截提示。
      setIntegrationEnvList([]);
    }
  }, [projectId]);

  // 测试用例集:真实接口按项目加载;editingSuiteId 为空=新增,有值=修改。
  const [integrationSuiteList, setIntegrationSuiteList] = useState<IntegrationSuiteVo[]>([]);
  const [editingSuiteId, setEditingSuiteId] = useState<number | null>(null);

  const loadIntegrationSuites = React.useCallback(async () => {
    if (!projectId) return;
    try {
      const list = (await listIntegrationSuites(projectId)) as IntegrationSuiteVo[] | null;
      setIntegrationSuiteList(list || []);
    } catch (e) {
      setIntegrationSuiteList([]);
    }
  }, [projectId]);

  // 集成测试执行历史:每个套件各查一次,合并后按时间倒序;真实数据替代原静态演示。
  const [integrationHistoryList, setIntegrationHistoryList] = useState<IntegrationRunHistoryVo[]>([]);

  // 需求级集成看板:后端按「需求→多仓库任务」聚合,含就绪状态、最近执行结果与打回记录。
  const [requirementIntegrationList, setRequirementIntegrationList] = useState<RequirementIntegration[]>([]);

  const loadRequirementIntegrations = React.useCallback(async () => {
    if (!projectId) {
      setRequirementIntegrationList([]);
      return;
    }
    try {
      const list = (await listRequirementIntegrations(projectId)) as RequirementIntegration[] | null;
      setRequirementIntegrationList(list || []);
    } catch (e) {
      setRequirementIntegrationList([]);
    }
  }, [projectId]);

  const loadIntegrationRuns = React.useCallback(async (suites: IntegrationSuiteVo[]) => {
    // 无自动化套件则清空历史;后端历史按 suiteId 查,这里对启用套件并发取回再合并。
    const autoSuites = suites.filter((s) => s.runner !== 'manual');
    if (autoSuites.length === 0) {
      setIntegrationHistoryList([]);
      return;
    }
    try {
      const lists = await Promise.all(
        autoSuites.map((s) => listIntegrationRuns(s.suiteId) as Promise<IntegrationRunHistoryVo[] | null>)
      );
      const merged = lists
        .flatMap((l) => l || [])
        .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
      setIntegrationHistoryList(merged);
    } catch (e) {
      setIntegrationHistoryList([]);
    }
  }, []);

  useEffect(() => {
    if (active) {
      loadIntegrationEnvs();
      loadIntegrationSuites();
    }
  }, [active, loadIntegrationEnvs, loadIntegrationSuites]);

  // 解析项目生效的测试默认员工(项目覆盖合并到全局之上),用于卡片兜底名与弹框占位提示。
  useEffect(() => {
    if (!active || !projectId) return;
    let cancelled = false;
    resolveDefaultAgent(projectId)
      .then((config) => {
        if (!cancelled) setResolvedTesterName(config?.testerAgentName || '');
      })
      .catch(() => {
        if (!cancelled) setResolvedTesterName('');
      });
    return () => {
      cancelled = true;
    };
  }, [active, projectId]);

  // 加载项目的独立测试员工配置;后端无记录时回填出厂默认,前端始终拿到完整可编辑配置。
  useEffect(() => {
    if (!active || !projectId) return;
    let cancelled = false;
    getTesterConfig(projectId)
      .then((config) => {
        if (cancelled || !config) return;
        const normalized: TesterConfig = {
          enabled: config.enabled !== false,
          schedule: {
            cron: config.schedule?.cron || DEFAULT_TESTER_CONFIG.schedule.cron,
            cronLabel: config.schedule?.cronLabel || DEFAULT_TESTER_CONFIG.schedule.cronLabel,
            timezone: config.schedule?.timezone || DEFAULT_TESTER_CONFIG.schedule.timezone,
          },
          admission: {
            requireAllCoded: config.admission?.requireAllCoded !== false,
            maxConcurrentReqs: config.admission?.maxConcurrentReqs ?? DEFAULT_TESTER_CONFIG.admission.maxConcurrentReqs,
          },
          kickback: {
            autoAttribute: config.kickback?.autoAttribute !== false,
            createDefectWhenUnclear: config.kickback?.createDefectWhenUnclear !== false,
            maxRounds: config.kickback?.maxRounds ?? DEFAULT_TESTER_CONFIG.kickback.maxRounds,
          },
        };
        setTesterConfig(normalized);
      })
      .catch(() => {
        // 拉取失败不打断页面,保留出厂默认配置。
      });
    return () => {
      cancelled = true;
    };
  }, [active, projectId]);

  // 套件列表变化后刷新历史(套件加载完成/执行完成后触发)。
  useEffect(() => {
    if (active) {
      loadIntegrationRuns(integrationSuiteList);
    }
  }, [active, integrationSuiteList, loadIntegrationRuns]);

  // 进入面板/切换项目时拉取需求级集成看板。
  useEffect(() => {
    if (active) {
      loadRequirementIntegrations();
    }
  }, [active, loadRequirementIntegrations]);

  // 执行测试:选环境弹框 + 轮询。runningRunId 非空表示有一次执行在进行,轮询直到进入终态。
  const [runEnvSelectOpen, setRunEnvSelectOpen] = useState(false);
  const [runTargetSuite, setRunTargetSuite] = useState<IntegrationSuiteVo | null>(null);
  const [runSelectedEnvId, setRunSelectedEnvId] = useState<number | null>(null);
  // 单次执行方式。这个弹框是人工调试入口，默认 backend 直跑：结果当场出、步骤日志和报告都能立刻看。
  // 正式形态（定时批量）在后端配置里是 tester，两者互不影响。
  const [runExecutorMode, setRunExecutorMode] = useState<'backend' | 'tester'>('backend');
  const [runStarting, setRunStarting] = useState(false);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // 本轮轮询的起点。只在 runningRunId 变化时重置,让退避不被 fetchRun 依赖变化引起的重排打回 2.5s。
  const pollStartRef = React.useRef(0);

  // 执行进入终态即停轮询;组件卸载/关闭结果弹框也清理,避免定时器泄漏。
  const TERMINAL_STATUS = React.useMemo(() => ['passed', 'failed', 'error', 'timeout'], []);

  const clearPollTimer = React.useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchRun = React.useCallback(
    async (runId: string) => {
      const r = (await getIntegrationRun(runId)) as IntegrationRunResult | null;
      if (!r) return false;
      setIntegrationResult(r);
      if (!TERMINAL_STATUS.includes(r.status)) return false;
      setRunningRunId(null);
      // 执行结束刷新历史列表,让本次 run 进历史。
      loadIntegrationRuns(integrationSuiteList);
      return true;
    },
    [TERMINAL_STATUS, loadIntegrationRuns, integrationSuiteList]
  );

  // 轮询节奏。backend 直跑几十秒内出终态,所以开头密;tester 模式要等每分钟一次的回收 cron 从
  // 会话回流,后端兜底超时是 1 小时,恒定 2.5s 会空打上千次,所以按已等待时长退避。
  const nextPollDelay = (elapsedMs: number) => {
    if (elapsedMs < 30_000) return 2500;
    if (elapsedMs < 120_000) return 5000;
    return 15_000;
  };
  // 轮询上限。超过这个时长仍未终态就交给后端超时兜底,不再让页面无限期打接口。
  const POLL_MAX_MS = 10 * 60 * 1000;

  // 轮询由 runningRunId 单点驱动:设上就轮,清掉/卸载就停,避免多处 setInterval 各自留定时器。
  React.useEffect(() => {
    if (!runningRunId) {
      clearPollTimer();
      return;
    }
    if (!pollStartRef.current) pollStartRef.current = Date.now();
    let cancelled = false;
    const tick = async () => {
      const reachedTerminal = await fetchRun(runningRunId);
      if (cancelled || reachedTerminal) return;
      const elapsed = Date.now() - pollStartRef.current;
      if (elapsed >= POLL_MAX_MS) {
        message.info(t('integration.result.pollGaveUp'));
        setRunningRunId(null);
        return;
      }
      pollTimerRef.current = setTimeout(tick, nextPollDelay(elapsed));
    };
    tick();
    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [runningRunId, fetchRun, clearPollTimer, t]);

  // 打开环境选择弹框(自动化套件的「执行测试」入口)。
  const openRunEnvSelect = (suite: IntegrationSuiteVo) => {
    if (integrationEnvList.length === 0) {
      message.warning(t('integration.run.noEnv'));
      return;
    }
    setRunTargetSuite(suite);
    setRunSelectedEnvId(integrationEnvList[0]?.envId ?? null);
    setRunEnvSelectOpen(true);
  };

  // 确认环境 → 触发执行 → 打开结果弹框并开始轮询。
  const handleStartRun = async () => {
    if (!runTargetSuite || !runSelectedEnvId) return;
    setRunStarting(true);
    try {
      const res = (await startIntegrationRun(runTargetSuite.suiteId, runSelectedEnvId, runExecutorMode)) as {
        runId: string;
      } | null;
      const runId = res?.runId;
      if (!runId) {
        message.error(t('integration.run.startFailed'));
        return;
      }
      setRunEnvSelectOpen(false);
      setIntegrationResult(null);
      setIntegrationResultOpen(true);
      // 轮询交给 runningRunId 的 effect:置起点后立刻拉一次并按退避续轮。
      pollStartRef.current = Date.now();
      setRunningRunId(runId);
    } catch (e) {
      message.error(t('integration.run.startFailed'));
    } finally {
      setRunStarting(false);
    }
  };

  // 查看历史结果:实时拉取该 run 的完整结果并展示。
  const openIntegrationResult = async (runId: string) => {
    try {
      const r = (await getIntegrationRun(runId)) as IntegrationRunResult | null;
      if (!r) {
        message.info(t('integration.result.notReady'));
        return;
      }
      setIntegrationResult(r);
      setIntegrationResultOpen(true);
      // 若该历史仍在执行(running),继续轮询。已跑了多久无从得知,起点按打开时间算。
      if (!TERMINAL_STATUS.includes(r.status)) {
        pollStartRef.current = Date.now();
        setRunningRunId(runId);
      }
    } catch (e) {
      message.info(t('integration.result.notReady'));
    }
  };

  const closeIntegrationResult = () => {
    setIntegrationResultOpen(false);
    // 清 runningRunId 即停轮询(effect 的 cleanup 负责清定时器)。
    setRunningRunId(null);
  };

  // 打开报告预览:先开弹窗占位再拉取,避免大报告期间界面无反馈。失败只提示,不留空弹窗。
  const openReportPreview = async (runId: string, reportPath?: string) => {
    // 文件名先按已知路径猜,拿到响应后用后端返回的真实路径纠正:脚注/表格入口没有 suites,
    // 前端根本不知道报告路径,只有后端按 suiteId 查得到。
    setReportFileName(reportPath?.split('/').pop() || 'report.xml');
    setReportPreview({ open: true, blob: null, loading: true });
    try {
      const res = await getIntegrationRunReport(runId);
      setReportFileName(res.path?.split('/').pop() || 'report.xml');
      // 带上 charset,Twins 读 Blob 文本与浏览器下载都按 UTF-8 处理,避免中文用例名乱码。
      setReportPreview({
        open: true,
        blob: new Blob([res.content], { type: 'text/xml;charset=utf-8' }),
        loading: false,
      });
    } catch (e: any) {
      setReportPreview({ open: false, blob: null, loading: false });
      message.error(e?.message || t('integration.result.reportLoadFailed'));
    }
  };

  const closeReportPreview = () => setReportPreview({ open: false, blob: null, loading: false });

  // 打开日志弹窗:按粒度拉历次运行列表(env 走新接口,suite 复用现有),点开某条再看该次日志。
  const openLogModal = async (kind: 'suite' | 'env', id: number, name: string) => {
    setLogModalTarget({ kind, id, name });
    setLogRuns([]);
    setLogModalOpen(true);
    setLogLoading(true);
    try {
      const list = (await (kind === 'env' ? listIntegrationRunsByEnv(id) : listIntegrationRuns(id))) as
        | IntegrationRunHistoryVo[]
        | null;
      setLogRuns(Array.isArray(list) ? list : []);
    } catch (e) {
      message.error(t('integration.log.loadFailed'));
    } finally {
      setLogLoading(false);
    }
  };

  // 研发闭环环节:E2E 集成测试插在 tester 之后、pr 之前,失败则打回 coder。用于概览可视化本次任务当前所处环节。
  const integrationFlowPhases = [
    { key: 'issue', label: '需求来源', state: 'done' as const },
    { key: 'req', label: '需求分析', state: 'done' as const },
    { key: 'design', label: '方案设计', state: 'done' as const },
    { key: 'coder', label: '编码', state: 'done' as const },
    { key: 'reviewer', label: '代码审查', state: 'done' as const },
    { key: 'tester', label: '本机自测', state: 'done' as const },
    { key: 'e2e', label: '端到端集成测试', state: 'active' as const, isNew: true },
    { key: 'pr', label: '提交 PR', state: 'pending' as const },
  ];

  // 需求级集成看板数据由后端 listRequirementIntegrations 聚合(见 requirementIntegrationList state)。

  // 需求级集成状态 → 展示配色/文案 key。
  const reqIntegrationStatusMeta: Record<RequirementIntegrationStatus, { color: string; labelId: string }> = {
    waiting_ready: { color: 'default', labelId: 'reqIntegration.status.waitingReady' },
    ready: { color: 'processing', labelId: 'reqIntegration.status.ready' },
    running: { color: 'processing', labelId: 'reqIntegration.status.running' },
    failed: { color: 'error', labelId: 'reqIntegration.status.failed' },
    passed: { color: 'success', labelId: 'reqIntegration.status.passed' },
  };

  // 对标 Vibe Kanban/Nimbalyst 的「需要你处理 vs 还在工作中」二态模型:按状态分泳道,failed 置顶醒目。
  // 需求级视图已从运行记录页签下线(改为运行表格),这块与下方 renderReqIntegrationCard/renderReqStatsStrip
  // 一并保留待用,暂无渲染入口,故显式关闭未使用告警而非删除。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const reqIntegrationGroups = (
    [
      { key: 'attention', labelId: 'reqIntegration.group.attention', statuses: ['failed'] },
      { key: 'working', labelId: 'reqIntegration.group.working', statuses: ['running', 'ready', 'waiting_ready'] },
      { key: 'done', labelId: 'reqIntegration.group.done', statuses: ['passed'] },
    ] as Array<{ key: string; labelId: string; statuses: RequirementIntegrationStatus[] }>
  )
    .map((group) => ({
      ...group,
      items: requirementIntegrationList.filter((req) => group.statuses.includes(req.status)),
    }))
    .filter((group) => group.items.length > 0);

  // 定时批量触发的下次运行时间(演示态)。真实实现由 cron 解析,这里跟着配置的可读标签走;关掉定时则显示手动。
  const integrationNextRunAt = testerConfig.enabled
    ? `明日 ${testerConfig.schedule.cronLabel.replace(/^每日\s*/, '')}`
    : t('tester.manualTrigger');

  // 看板顶部统计概览:一眼看清「多少需求、几个要处理、在跑、已通过、总体通过率」,对标对比分析型仪表盘。
  // 通过率按所有已跑轮次的 passRate("15/18") 聚合,未跑的需求不计入分母,避免把待就绪需求算成 0%。
  const reqIntegrationStats = (() => {
    const list = requirementIntegrationList;
    let passedCases = 0;
    let totalCases = 0;
    list.forEach((req) => {
      if (!req.passRate) return;
      const [p, tot] = req.passRate.split('/').map((n) => Number(n) || 0);
      passedCases += p;
      totalCases += tot;
    });
    return {
      total: list.length,
      attention: list.filter((r) => r.status === 'failed').length,
      running: list.filter((r) => r.status === 'running' || r.status === 'ready' || r.status === 'waiting_ready')
        .length,
      passed: list.filter((r) => r.status === 'passed').length,
      passRate: totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : null,
    };
  })();

  // ---- 运行记录看板:概览条 + 筛选 + 运行表格 ----
  // 一份数据服务三类读者:概览给项目经理看整体健康度,筛选+表格给测试人员查/比,失败行直达日志给研发定位。

  // 运行记录筛选:状态 + 套件 + 关键字(分支/触发人)。默认全部,不预设过滤避免"数据怎么少了"。
  const [runFilterStatus, setRunFilterStatus] = useState<'all' | 'failing' | 'passed' | 'running'>('all');
  const [runFilterSuite, setRunFilterSuite] = useState<number | 'all'>('all');
  const [runKeyword, setRunKeyword] = useState('');

  // 失败态口径统一:failed/error/timeout 都算"需处理",避免研发只盯 failed 漏掉超时与执行异常。
  const isFailingRun = (status: IntegrationRunHistoryVo['status']) =>
    status === 'failed' || status === 'error' || status === 'timeout';

  // 概览统计:总次数/需处理/进行中 + 用例级总体通过率 + 平均耗时。
  // 通过率按用例数聚合(非按次数),避免一次大套件和一次小套件被等权拉平。
  const runStats = (() => {
    const list = integrationHistoryList;
    let passedCases = 0;
    let totalCases = 0;
    let durationSum = 0;
    let durationCount = 0;
    list.forEach((r) => {
      passedCases += r.passed ?? 0;
      totalCases += r.total ?? 0;
      // 只统计已结束的运行耗时,running 的耗时还在变,计进去会把均值压低。
      if (r.status !== 'running' && r.durationSec) {
        durationSum += r.durationSec;
        durationCount += 1;
      }
    });
    return {
      total: list.length,
      failing: list.filter((r) => isFailingRun(r.status)).length,
      running: list.filter((r) => r.status === 'running').length,
      passRate: totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : null,
      avgDurationSec: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    };
  })();

  const filteredRuns = integrationHistoryList.filter((r) => {
    if (runFilterStatus === 'failing' && !isFailingRun(r.status)) return false;
    if (runFilterStatus === 'passed' && r.status !== 'passed') return false;
    if (runFilterStatus === 'running' && r.status !== 'running') return false;
    if (runFilterSuite !== 'all' && r.suiteId !== runFilterSuite) return false;
    const kw = runKeyword.trim().toLowerCase();
    if (!kw) return true;
    const suiteName = integrationSuiteList.find((s) => s.suiteId === r.suiteId)?.suiteName ?? '';
    return [suiteName, r.branch, r.createByName, r.reason].some((v) =>
      String(v ?? '')
        .toLowerCase()
        .includes(kw)
    );
  });

  // 耗时可读化:秒 → 1m 20s,表格里比裸秒数好扫。
  const formatDuration = (sec?: number | null) => {
    if (sec === null || sec === undefined) return '-';
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  };

  // 当前绑定的独立测试员工名:优先从员工选项按 id 命中,退全局解析出的测试默认员工名。
  // 执行员工 = 项目生效的全局测试默认员工;此处只读,改绑定去「默认数字员工」。
  const boundTesterName = resolvedTesterName;

  const openTesterModal = () => {
    setTesterDraft(testerConfig);
    setTesterModalOpen(true);
  };

  // 保存草稿到后端(每项目唯一,upsert),成功后写回本地并关闭弹框。
  const [testerSaving, setTesterSaving] = useState(false);
  const handleSaveTester = async () => {
    if (!projectId) return;
    setTesterSaving(true);
    try {
      await saveTesterConfig({ projectId, ...testerDraft });
      setTesterConfig(testerDraft);
      setTesterModalOpen(false);
      message.success(t('tester.saveSuccess'));
    } catch (e) {
      message.error(t('tester.saveFailed'));
    } finally {
      setTesterSaving(false);
    }
  };

  // 手动执行:对项目下所有启用用例集 × 选定环境各起一次真实 run。需先选环境(复用套件执行的环境选择弹框)。
  const [testerRunning, setTesterRunning] = useState(false);
  const [testerRunEnvOpen, setTesterRunEnvOpen] = useState(false);
  const [testerRunEnvId, setTesterRunEnvId] = useState<number | null>(null);
  const handleManualTesterRun = async () => {
    if (!projectId) return;
    if (integrationEnvList.length === 0) {
      message.warning(t('integration.run.noEnv'));
      return;
    }
    setTesterRunEnvId(integrationEnvList[0]?.envId ?? null);
    setTesterRunEnvOpen(true);
  };

  // 确认环境 → 触发批量执行 → 提示起了几条 run,并刷新历史列表。
  const handleConfirmTesterRun = async () => {
    if (!projectId || !testerRunEnvId) return;
    setTesterRunning(true);
    try {
      const res = (await runTesterBatch(projectId, testerRunEnvId)) as {
        runIds: Array<string | number>;
        suiteCount: number;
      } | null;
      if (!res || !res.runIds?.length) {
        message.error(t('tester.runFailed'));
        return;
      }
      setTesterRunEnvOpen(false);
      message.success(t('tester.runStarted', { count: res.suiteCount }));
      loadIntegrationRuns(integrationSuiteList);
      loadRequirementIntegrations();
    } catch (e) {
      message.error(t('tester.runFailed'));
    } finally {
      setTesterRunning(false);
    }
  };

  // 需求状态 → 卡片左侧强调条的语义类:失败红 / 通过绿 / 集成中蓝 / 就绪待跑蓝浅 / 待就绪灰。
  // 状态色不再只靠右上角 Tag,左边框让泳道里一眼扫出「哪张要处理」。
  const reqCardAccentClass = (status: RequirementIntegrationStatus) => {
    if (status === 'failed') return styles.reqIntegrationCard_failed;
    if (status === 'passed') return styles.reqIntegrationCard_passed;
    if (status === 'running') return styles.reqIntegrationCard_running;
    if (status === 'ready') return styles.reqIntegrationCard_ready;
    return styles.reqIntegrationCard_waiting;
  };

  // 需求级需求卡:随需求级视图一同下线,保留待用。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderReqIntegrationCard = (req: RequirementIntegration) => {
    const statusMeta = reqIntegrationStatusMeta[req.status];
    const codedCount = req.tasks.filter((task) => task.coded).length;
    const isReady = req.status !== 'waiting_ready';
    // 就绪度按已编码任务占比驱动进度条;满编码=绿(可跑),否则蓝(还差)。集成中单独走 active 态。
    const codedPct = req.tasks.length ? Math.round((codedCount / req.tasks.length) * 100) : 0;
    const progressStatus: 'success' | 'active' | 'normal' =
      req.status === 'running' ? 'active' : codedPct >= 100 ? 'success' : 'normal';
    return (
      <div className={`${styles.reqIntegrationCard} ${reqCardAccentClass(req.status)}`} key={req.reqId}>
        <div className={styles.reqIntegrationHead}>
          <div className={styles.reqIntegrationTitle}>
            <span className={styles.reqIntegrationNo}>{req.reqNo}</span>
            <strong>{req.reqName}</strong>
          </div>
          <Tag color={statusMeta.color}>{t(statusMeta.labelId)}</Tag>
        </div>

        {/* 就绪度进度条:替代原本纯文字「就绪 3/5」,配比一眼可读;右侧保留精确计数。 */}
        <div className={styles.reqIntegrationProgress}>
          <Progress
            percent={codedPct}
            status={progressStatus}
            showInfo={false}
            size="small"
            strokeColor={req.status === 'running' ? '#1677ff' : undefined}
          />
          <span className={styles.reqIntegrationReady}>
            {t('reqIntegration.readyOf', { coded: codedCount, total: req.tasks.length })}
          </span>
        </div>

        {/* 需求→多任务→多仓库:每个任务一枚芯片,SVG 图标标出是否已 coded(就绪判定的最小条件)。 */}
        <div className={styles.reqIntegrationTasks}>
          {req.tasks.map((task) => (
            <span
              key={task.id}
              className={`${styles.reqIntegrationTaskChip} ${
                task.coded ? styles.reqIntegrationTaskChipReady : styles.reqIntegrationTaskChipPending
              }`}
            >
              {task.coded ? (
                <CheckCircleFilled className={styles.reqIntegrationTaskIcon} />
              ) : (
                <ClockCircleOutlined className={styles.reqIntegrationTaskIcon} />
              )}
              {task.repo}
              <span className={styles.reqIntegrationTaskBranch}>{task.branch}</span>
            </span>
          ))}
        </div>

        <div className={styles.reqIntegrationMeta}>
          {isReady && req.passRate ? (
            <span className={parentStyles.detailSourceTime}>
              {t('reqIntegration.lastRun', { rate: req.passRate, time: req.lastRunAt })}
              {req.round ? ` · ${t('reqIntegration.round', { round: req.round })}` : ''}
            </span>
          ) : (
            <span className={parentStyles.detailSourceTime}>{t('reqIntegration.waitingHint')}</span>
          )}
        </div>

        {/* 失败按图归因:分发到了哪些仓库/分支,附原因。 */}
        {req.kickbackTasks.length ? (
          <div className={styles.reqIntegrationKickback}>
            {req.kickbackTasks.map((kb, idx) => (
              <div key={idx} className={styles.reqIntegrationKickbackItem}>
                <CloseCircleFilled className={styles.reqIntegrationKickbackIcon} />
                <span>
                  {t('reqIntegration.kickback', { repo: kb.repo, branch: kb.branch })}
                  {kb.reason ? ` · ${kb.reason}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {req.lastRunId ? (
          <div className={styles.reqIntegrationActions}>
            <Button type="link" size="small" onClick={() => openIntegrationResult(req.lastRunId)}>
              {t('integration.history.viewResult')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  // 编排方式 → 卡片短标签 i18n key。
  const orchestratorTagKey = (orch?: IntegrationEnvVo['orchestrator']) => {
    const map = {
      script: 'integration.envModal.orchTagScript',
      jenkins: 'integration.envModal.orchTagJenkins',
      k8s: 'integration.envModal.orchTagK8s',
      webhook: 'integration.envModal.orchTagWebhook',
    } as const;
    return map[orch || 'script'];
  };

  // JSON字符串安全解析:后端 stages/testAccounts 落库为文本,空/损坏时回退默认,避免弹框炸开。
  const parseJsonArray = <T,>(raw: string | undefined, fallback: T[]): T[] => {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch (e) {
      return fallback;
    }
  };

  // 环境卡片:查看/修改复用「关联环境」弹框(查看态只读)。回填后端VO到编辑表单。
  const openEnvModal = (env: IntegrationEnvVo, readOnly: boolean) => {
    setEditingEnvId(env.envId);
    setIntegrationEnvForm((prev) => ({
      ...prev,
      name: env.envName,
      address: env.address || '',
      orchestrator: env.orchestrator || 'script',
      connProtocol: env.connProtocol || 'ssh',
      connHost: env.connHost || '',
      connPort: env.connPort || '',
      connUser: env.connUser || '',
      connAuth: env.connAuth || 'key',
      // 密文不回显:回填恒空,hasConnCredential 决定占位提示;留空提交=保持原密文。
      connCredentialRef: '',
      hasConnCredential: !!env.hasConnCredential,
      connWorkdir: env.connWorkdir || '',
      stages: parseJsonArray<IntegrationStage>(env.stages, prev.stages),
      testAccounts: parseJsonArray<TestAccount>(env.testAccounts, prev.testAccounts),
    }));
    setIntegrationEnvReadOnly(readOnly);
    setIntegrationEnvTab('basic');
    setIntegrationEnvModalOpen(true);
  };

  const handleDeleteEnv = (env: IntegrationEnvVo) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('integration.env.deleteConfirm', { name: env.envName }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      zIndex: 1200,
      onOk: async () => {
        await deleteIntegrationEnv(env.envId);
        message.success(t('common.deleteSuccess'));
        await loadIntegrationEnvs();
      },
    });
  };

  // 保存环境:editingEnvId 决定新建/更新。表单结构化 stages/testAccounts 由服务层序列化为JSON。
  const handleSaveEnv = async () => {
    const f = integrationEnvForm;
    if (!f.name.trim()) {
      message.warning(t('integration.envModal.namePlaceholder'));
      return;
    }
    const payload = {
      envName: f.name,
      address: f.address,
      orchestrator: f.orchestrator,
      connProtocol: f.connProtocol,
      connHost: f.connHost,
      connPort: f.connPort,
      connUser: f.connUser,
      connAuth: f.connAuth,
      connCredentialRef: f.connCredentialRef,
      connWorkdir: f.connWorkdir,
      stages: f.stages,
      testAccounts: f.testAccounts,
    };
    if (editingEnvId !== null) {
      await updateIntegrationEnv({ envId: editingEnvId, ...payload });
    } else {
      await createIntegrationEnv({ projectId, ...payload });
    }
    message.success(t('common.saveSuccess'));
    setIntegrationEnvModalOpen(false);
    await loadIntegrationEnvs();
  };

  // 用例集卡片:查看/修改复用「新增用例集」弹框(查看态只读),删除走确认弹框(当前演示态仅提示)。
  // 新增:清空 editingSuiteId 并重置表单默认值。
  const openCreateSuiteModal = () => {
    setEditingSuiteId(null);
    setIntegrationSuiteForm({
      name: '',
      runner: 'pytest',
      sourceType: 'code',
      repoId: undefined,
      source: '',
      branch: 'main',
      runCommand: 'pytest -q --junitxml=report/junit.xml',
      workdir: '.',
      reportPath: 'report/junit.xml',
      manualFile: 'e2e/manual-cases.md',
      manualCases: [],
    });
    setIntegrationSuiteReadOnly(false);
    setIntegrationSuiteModalOpen(true);
  };

  const openSuiteModal = (suite: IntegrationSuiteVo, readOnly: boolean) => {
    setEditingSuiteId(suite.suiteId);
    setIntegrationSuiteForm({
      name: suite.suiteName,
      runner: suite.runner ?? 'pytest',
      sourceType: suite.sourceType ?? 'code',
      repoId: suite.repoId,
      source: suite.source ?? '',
      branch: suite.branch ?? '',
      runCommand: suite.runCommand ?? '',
      workdir: suite.workdir ?? '.',
      reportPath: suite.reportPath ?? '',
      manualFile: suite.manualFile ?? 'e2e/manual-cases.md',
      // 手测清单不入库(在仓库文件里),编辑态无预览。
      manualCases: [],
    });
    setIntegrationSuiteReadOnly(readOnly);
    setIntegrationSuiteModalOpen(true);
  };

  const handleDeleteSuite = (suite: IntegrationSuiteVo) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('integration.suite.deleteConfirm', { name: suite.suiteName }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      zIndex: 1200,
      onOk: async () => {
        await deleteIntegrationSuite(suite.suiteId);
        message.success(t('common.deleteSuccess'));
        await loadIntegrationSuites();
      },
    });
  };

  // 启用/停用:enabled 落库 '0'/'1',切换后重载列表。
  const handleToggleSuite = async (suite: IntegrationSuiteVo, next: boolean) => {
    await toggleIntegrationSuite(suite.suiteId, next ? '1' : '0');
    await loadIntegrationSuites();
  };

  // 保存用例集:editingSuiteId 决定新建/更新。manual 套件清单不入库,仅登记 manualFile。
  const handleSaveSuite = async () => {
    const f = integrationSuiteForm;
    // 名称是后端非空列(suite_name NOT NULL),空值提交会撞库约束报错,前端先拦。
    if (!f.name?.trim()) {
      message.warning(t('integration.suiteModal.nameRequired'));
      return;
    }
    const isManual = f.runner === 'manual';
    // code:用例与被测代码同仓,测试员工沿用开发已检出目录、免克隆,权威关联走 repoId;
    // standalone:用例在另一个仓库,必须先克隆,只有 source(git URL);
    // env:用例已在环境机上,不涉及任何仓库/分支,这些字段一律清空避免留下误导性配置。
    const isCodeRepo = f.sourceType === 'code';
    const isOnEnv = f.sourceType === 'env';
    const payload = {
      suiteName: f.name,
      runner: f.runner,
      sourceType: f.sourceType,
      repoId: isCodeRepo ? f.repoId : undefined,
      source: isOnEnv ? '' : f.source,
      branch: isOnEnv ? '' : f.branch,
      runCommand: isManual ? '' : f.runCommand,
      workdir: f.workdir,
      reportPath: isManual ? '' : f.reportPath,
      manualFile: isManual ? f.manualFile : undefined,
    };
    if (editingSuiteId !== null) {
      await updateIntegrationSuite({ suiteId: editingSuiteId, ...payload });
    } else {
      await createIntegrationSuite({ projectId, ...payload });
    }
    message.success(t('common.saveSuccess'));
    setIntegrationSuiteModalOpen(false);
    await loadIntegrationSuites();
  };

  // 打开手动测试执行面板:初始化每条用例的空记录。清单不入库,当前无预览用例。
  const openManualRun = (suite: IntegrationSuiteVo) => {
    setManualRunRecords({});
    setManualRunSuite(suite);
    setManualRunOpen(true);
  };

  const setManualRecord = (
    caseId: string,
    patch: Partial<{ result: 'pass' | 'fail' | 'skip' | ''; remark: string; shots: string[] }>
  ) => setManualRunRecords((prev) => ({ ...prev, [caseId]: { ...prev[caseId], ...patch } }));

  // 打开右侧面板并停在指定页签;已开则再点入口视为收起。
  const handleOpenIntegrationPanel = (tab: 'board' | 'config' = 'config') => {
    if (integrationConfigOpen && integrationPanelTab === tab) {
      handleCloseIntegrationConfig();
      return;
    }
    setIntegrationPanelTab(tab);
    setIntegrationConfigOpen(true);
  };

  const phaseLabelOf = (key: string) => integrationFlowPhases.find((p) => p.key === key)?.label ?? key;

  // run 级状态 → Tag 颜色:通过绿、失败/错误红、超时橙、执行中蓝。
  const runStatusColor = (status: string) => {
    if (status === 'passed') return 'success';
    if (status === 'timeout') return 'warning';
    if (status === 'running') return 'processing';
    return 'error';
  };

  // 左侧只留轻量入口:面板按钮 + 定时触发条 + 说明。看板与运行日志内容多,挪到右侧覆盖层,避免窄左栏挤压。
  const renderIntegration = () => (
    <div className={styles.integrationPanel}>
      <button
        type="button"
        className={parentStyles.detailChannelEntry}
        onClick={() => handleOpenIntegrationPanel('config')}
      >
        <FundProjectionScreenOutlined className={parentStyles.detailChannelEntryIcon} />
        <span>
          <strong>{t('integration.panelEntry')}</strong>
        </span>
        {integrationConfigOpen ? <LeftOutlined /> : <RightOutlined />}
      </button>

      {/* V2:定时触发说明条。E2E 不再每个任务跑,改由独立测试员工定时批量执行,"图就绪"是准入。 */}
      <div className={styles.integrationTriggerBanner}>
        <ClockCircleOutlined className={styles.integrationTriggerIcon} />
        <div className={styles.integrationTriggerText}>
          <div className={styles.integrationTriggerTitleRow}>
            <strong>{t('reqIntegration.trigger.title')}</strong>
            <span className={styles.integrationNextRun}>
              {t('reqIntegration.nextRun', { time: integrationNextRunAt })}
            </span>
          </div>
          <span>{t('reqIntegration.trigger.desc')}</span>
        </div>
      </div>

      <div className={styles.integrationNote}>{t('integration.note')}</div>
    </div>
  );

  // 需求级统计概览条:随需求级视图一同下线,保留待用;现由 renderRunStatsStrip 承担概览。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderReqStatsStrip = () => {
    const s = reqIntegrationStats;
    if (!s.total) return null;
    const cells: Array<{ key: string; icon: React.ReactNode; label: string; value: React.ReactNode; cls: string }> = [
      {
        key: 'total',
        icon: <FundProjectionScreenOutlined />,
        label: t('reqIntegration.stats.total'),
        value: s.total,
        cls: styles.reqStatCard_total,
      },
      {
        key: 'attention',
        icon: <ExclamationCircleFilled />,
        label: t('reqIntegration.stats.attention'),
        value: s.attention,
        cls: styles.reqStatCard_attention,
      },
      {
        key: 'running',
        icon: <SyncOutlined spin={s.running > 0} />,
        label: t('reqIntegration.stats.running'),
        value: s.running,
        cls: styles.reqStatCard_running,
      },
      {
        key: 'passed',
        icon: <CheckCircleFilled />,
        label: t('reqIntegration.stats.passed'),
        value: s.passed,
        cls: styles.reqStatCard_passed,
      },
    ];
    return (
      <div className={styles.reqStatsStrip}>
        {cells.map((c) => (
          <div key={c.key} className={`${styles.reqStatCard} ${c.cls}`}>
            <span className={styles.reqStatIcon}>{c.icon}</span>
            <div className={styles.reqStatBody}>
              <span className={styles.reqStatValue}>{c.value}</span>
              <span className={styles.reqStatLabel}>{c.label}</span>
            </div>
          </div>
        ))}
        {s.passRate !== null ? (
          <div className={`${styles.reqStatCard} ${styles.reqStatCard_rate}`}>
            <Progress
              type="circle"
              size={40}
              percent={s.passRate}
              strokeColor={s.passRate >= 80 ? '#52c41a' : s.passRate >= 50 ? '#faad14' : '#ff4d4f'}
              format={(p) => <span className={styles.reqStatRateNum}>{p}%</span>}
            />
            <div className={styles.reqStatBody}>
              <span className={styles.reqStatLabel}>{t('reqIntegration.stats.passRate')}</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  // 概览条:项目经理视角的整体健康度。总次数/需处理/进行中/平均耗时 + 通过率环。
  // 「需处理」可点,等价于把状态筛选切到 failing——概览不只是展示,也是进入明细的入口。
  const renderRunStatsStrip = () => {
    const s = runStats;
    if (!s.total) return null;
    const cells: Array<{
      key: string;
      icon: React.ReactNode;
      label: string;
      value: React.ReactNode;
      cls: string;
      onClick?: () => void;
    }> = [
      {
        key: 'total',
        icon: <FundProjectionScreenOutlined />,
        label: t('runBoard.stats.total'),
        value: s.total,
        cls: styles.reqStatCard_total,
        onClick: () => setRunFilterStatus('all'),
      },
      {
        key: 'failing',
        icon: <ExclamationCircleFilled />,
        label: t('runBoard.stats.failing'),
        value: s.failing,
        cls: styles.reqStatCard_attention,
        onClick: () => setRunFilterStatus('failing'),
      },
      {
        key: 'running',
        icon: <SyncOutlined spin={s.running > 0} />,
        label: t('runBoard.stats.running'),
        value: s.running,
        cls: styles.reqStatCard_running,
        onClick: () => setRunFilterStatus('running'),
      },
      {
        key: 'duration',
        icon: <ClockCircleOutlined />,
        label: t('runBoard.stats.avgDuration'),
        value: formatDuration(s.avgDurationSec),
        cls: styles.reqStatCard_passed,
      },
    ];
    return (
      <div className={styles.reqStatsStrip}>
        {cells.map((c) => (
          <div
            key={c.key}
            className={`${styles.reqStatCard} ${c.cls} ${c.onClick ? styles.reqStatCardClickable : ''}`}
            onClick={c.onClick}
            role={c.onClick ? 'button' : undefined}
            tabIndex={c.onClick ? 0 : undefined}
            onKeyDown={(e) => {
              if (c.onClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                c.onClick();
              }
            }}
          >
            <span className={styles.reqStatIcon}>{c.icon}</span>
            <div className={styles.reqStatBody}>
              <span className={styles.reqStatValue}>{c.value}</span>
              <span className={styles.reqStatLabel}>{c.label}</span>
            </div>
          </div>
        ))}
        {s.passRate !== null ? (
          <div className={`${styles.reqStatCard} ${styles.reqStatCard_rate}`}>
            <Progress
              type="circle"
              size={40}
              percent={s.passRate}
              strokeColor={s.passRate >= 80 ? '#52c41a' : s.passRate >= 50 ? '#faad14' : '#ff4d4f'}
              format={(p) => <span className={styles.reqStatRateNum}>{p}%</span>}
            />
            <div className={styles.reqStatBody}>
              <span className={styles.reqStatLabel}>{t('runBoard.stats.passRate')}</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  // 运行表格:测试人员查/比的主界面。窄列固定、失败行整行标红底,研发能直接扫到失败与打回原因。
  const runTableColumns: ColumnsType<IntegrationRunHistoryVo> = [
    {
      title: t('runBoard.col.status'),
      dataIndex: 'status',
      width: 92,
      render: (status: IntegrationRunHistoryVo['status']) => (
        <Tag color={runStatusColor(status)} className={styles.runTableStatusTag}>
          {t(`integration.result.status.${status}`)}
        </Tag>
      ),
    },
    {
      title: t('runBoard.col.suite'),
      dataIndex: 'suiteId',
      ellipsis: true,
      render: (suiteId: number, row) => {
        const suiteName = integrationSuiteList.find((s) => s.suiteId === suiteId)?.suiteName;
        return (
          <div className={styles.runTableSuiteCell}>
            <span className={styles.runTableSuiteName}>{suiteName || `#${suiteId}`}</span>
            {row.branch ? <span className={styles.runTableBranch}>{row.branch}</span> : null}
          </div>
        );
      },
    },
    {
      title: t('runBoard.col.passRate'),
      dataIndex: 'passed',
      width: 132,
      render: (_: unknown, row) => {
        const total = row.total ?? 0;
        const passed = row.passed ?? 0;
        // 没跑出用例数时不画 0% 进度条(会被误读成全挂),直接给占位。
        if (!total) return <span className={styles.runTableMuted}>-</span>;
        const pct = Math.round((passed / total) * 100);
        return (
          <div className={styles.runTableRateCell}>
            <Progress
              percent={pct}
              size="small"
              showInfo={false}
              strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#faad14' : '#ff4d4f'}
            />
            <span className={styles.runTableRateText}>
              {passed}/{total}
            </span>
          </div>
        );
      },
    },
    {
      title: t('runBoard.col.duration'),
      dataIndex: 'durationSec',
      width: 88,
      render: (sec?: number) => <span className={styles.runTableMono}>{formatDuration(sec)}</span>,
    },
    {
      title: t('runBoard.col.trigger'),
      dataIndex: 'createByName',
      width: 110,
      ellipsis: true,
      render: (name?: string) => name || <span className={styles.runTableMuted}>-</span>,
    },
    {
      title: t('runBoard.col.time'),
      dataIndex: 'time',
      width: 150,
      render: (time?: string) => <span className={styles.runTableMono}>{time || '-'}</span>,
    },
    {
      title: t('runBoard.col.action'),
      key: 'action',
      // 两个 link 按钮并排,88 会把「测试报告」挤到换行。
      width: 150,
      fixed: 'right',
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => openIntegrationResult(row.runId)}>
            {t('integration.log.viewDetail')}
          </Button>
          {/* 报告直达:不必先开结果弹窗再展开套件明细。执行中还没有报告,禁用。 */}
          <Button
            type="link"
            size="small"
            disabled={row.status === 'running'}
            onClick={() => openReportPreview(row.runId)}
          >
            {t('integration.result.viewReportBtn')}
          </Button>
        </>
      ),
    },
  ];

  const renderIntegrationBoard = () => (
    <div className={styles.integrationPanel}>
      <div className={styles.integrationSection}>
        <div className={styles.integrationSectionHeader}>
          <span className={styles.integrationSectionTitle}>{t('runBoard.title')}</span>
          <span className={styles.integrationNextRun}>
            <ClockCircleOutlined /> {t('reqIntegration.nextRun', { time: integrationNextRunAt })}
          </span>
        </div>
        {renderRunStatsStrip()}

        {/* 筛选条:状态段选 + 套件下拉 + 关键字。测试人员按状态/套件收敛,研发直接搜分支或失败原因。 */}
        <div className={styles.runFilterBar}>
          <Segmented
            size="small"
            value={runFilterStatus}
            onChange={(v) => setRunFilterStatus(v as typeof runFilterStatus)}
            options={[
              { value: 'all', label: t('runBoard.filter.all') },
              { value: 'failing', label: t('runBoard.filter.failing') },
              { value: 'running', label: t('runBoard.filter.running') },
              { value: 'passed', label: t('runBoard.filter.passed') },
            ]}
          />
          <Select
            size="small"
            className={styles.runFilterSuite}
            value={runFilterSuite}
            onChange={(v) => setRunFilterSuite(v)}
            options={[
              { value: 'all' as const, label: t('runBoard.filter.allSuites') },
              ...integrationSuiteList
                .filter((s) => s.runner !== 'manual')
                .map((s) => ({ value: s.suiteId, label: s.suiteName || `#${s.suiteId}` })),
            ]}
          />
          <Input
            size="small"
            allowClear
            className={styles.runFilterKeyword}
            prefix={<SearchOutlined />}
            placeholder={t('runBoard.filter.keywordPlaceholder')}
            value={runKeyword}
            onChange={(e) => setRunKeyword(e.target.value)}
          />
          {/* 筛选后条数回显:让"数据变少"是可解释的,而不是像加载失败。 */}
          <span className={styles.runFilterCount}>
            {t('runBoard.filter.count', { shown: filteredRuns.length, total: integrationHistoryList.length })}
          </span>
        </div>

        <Table<IntegrationRunHistoryVo>
          className={styles.runTable}
          size="small"
          rowKey="runId"
          columns={runTableColumns}
          dataSource={filteredRuns}
          scroll={{ x: 'max-content' }}
          pagination={filteredRuns.length > 12 ? { pageSize: 12, size: 'small', showSizeChanger: false } : false}
          // 失败行整行着色:研发扫一眼就知道该看哪几行,不必逐行读状态标签。
          rowClassName={(row) => (isFailingRun(row.status) ? styles.runTableRowFailing : '')}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  integrationHistoryList.length ? t('runBoard.emptyFiltered') : t('integration.history.empty')
                }
              />
            ),
          }}
          // 失败行展开显示打回环节与原因:研发定位所需的上下文就在行内,不用先开弹窗。
          expandable={{
            rowExpandable: (row) => isFailingRun(row.status) && Boolean(row.kickbackTo || row.reason),
            expandedRowRender: (row) => (
              <div className={styles.runTableFailDetail}>
                {row.kickbackTo ? (
                  <span className={styles.runTableFailKickback}>
                    {t('integration.history.kickback', { phase: phaseLabelOf(row.kickbackTo) })}
                  </span>
                ) : null}
                {row.reason ? <span className={styles.runTableFailReason}>{row.reason}</span> : null}
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
  // 右侧集成测试配置面板:环境信息 + 测试用例集,空间充足可容纳复杂配置。
  const renderIntegrationConfigPanel = () => {
    return (
      <div className={parentStyles.detailChannelPanel}>
        <div className={parentStyles.detailChannelPanelHeader}>
          <div className={parentStyles.detailChannelPanelTitle}>
            <h3>{t('integration.panelEntry')}</h3>
            <p>{t('integration.panelSubtitle')}</p>
          </div>
          <div className={parentStyles.detailChannelPanelActions}>
            {/* 规范入口放面板级而不是弹框深处:结果契约是平台硬约定,用户在配置前后都可能要查。 */}
            <Button icon={<BookOutlined />} onClick={() => openSpec(E2E_SPEC_SECTIONS.roles)}>
              {t('integration.specEntry')}
            </Button>
            <Tooltip title={t('common.close')} placement="top">
              <Button icon={<CloseOutlined />} onClick={handleCloseIntegrationConfig} />
            </Tooltip>
          </div>
        </div>
        <div className={parentStyles.detailChannelPanelBody}>
          <Tabs
            className={styles.integrationPanelTabs}
            activeKey={integrationPanelTab}
            onChange={(key) => setIntegrationPanelTab(key as 'board' | 'config')}
            items={[
              { key: 'board', label: t('integration.tab.board'), children: renderIntegrationBoard() },
              {
                key: 'config',
                label: t('integration.tab.config'),
                children: (
                  <div className={styles.integrationPanel}>
                    {/* V2:独立测试数字员工配置。这是「定时集成」banner 背后的真实配置:谁测/何时测/失败怎么打回。 */}
                    <div className={styles.integrationSection}>
                      <div className={styles.integrationSectionHeader}>
                        <span className={styles.integrationSectionTitle}>{t('tester.title')}</span>
                      </div>
                      {/* 与环境/用例集卡片同一网格 + 外壳,保证宽度与风格一致(单卡时不铺满整行)。 */}
                      <div className={styles.integrationCardGrid}>
                        <div className={parentStyles.detailSourceCard}>
                          <div className={parentStyles.detailSourceHeader}>
                            <span className={parentStyles.detailSourceIcon}>
                              <RobotOutlined />
                            </span>
                            <div className={parentStyles.detailSourceTitle}>
                              <strong>{boundTesterName || t('tester.noAgent')}</strong>
                              <span>{t('tester.agentHint')}</span>
                            </div>
                            <Tag color={testerConfig.enabled ? 'success' : 'default'}>
                              {t(testerConfig.enabled ? 'tester.enabled' : 'tester.disabled')}
                            </Tag>
                          </div>
                          <div className={styles.integrationCardBody}>
                            <div className={styles.integrationField}>
                              <span className={styles.integrationFieldLabel}>{t('tester.schedule')}</span>
                              <span className={styles.integrationFieldValue}>
                                {testerConfig.enabled
                                  ? `${testerConfig.schedule.cronLabel} · ${testerConfig.schedule.timezone}`
                                  : t('tester.manualTrigger')}
                              </span>
                            </div>
                            <div className={styles.integrationField}>
                              <span className={styles.integrationFieldLabel}>{t('tester.admission')}</span>
                              <span className={styles.integrationFieldValue}>
                                {testerConfig.admission.requireAllCoded
                                  ? t('tester.admissionAllCoded')
                                  : t('tester.admissionAnyCoded')}
                                {' · '}
                                {t('tester.concurrency', { count: testerConfig.admission.maxConcurrentReqs })}
                              </span>
                            </div>
                            <div className={styles.integrationField}>
                              <span className={styles.integrationFieldLabel}>{t('tester.kickback')}</span>
                              <span className={styles.integrationFieldValue}>
                                {testerConfig.kickback.autoAttribute
                                  ? t('tester.kickbackAuto')
                                  : t('tester.kickbackManual')}
                                {testerConfig.kickback.createDefectWhenUnclear
                                  ? ` · ${t('tester.kickbackDefect')}`
                                  : ''}
                                {' · '}
                                {t('tester.maxRounds', { count: testerConfig.kickback.maxRounds })}
                              </span>
                            </div>
                            <div className={styles.testerNote}>{t('tester.cardNote')}</div>
                          </div>
                          <div className={styles.integrationCardActions}>
                            <Button
                              type="link"
                              size="small"
                              icon={<PlayCircleOutlined />}
                              loading={testerRunning}
                              onClick={handleManualTesterRun}
                            >
                              {t('tester.runNow')}
                            </Button>
                            <Button type="link" size="small" icon={<EditOutlined />} onClick={openTesterModal}>
                              {t('common.edit')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 环境信息配置 */}
                    <div className={styles.integrationSection}>
                      <div className={styles.integrationSectionHeader}>
                        <span className={styles.integrationSectionTitle}>{t('integration.env.title')}</span>
                        <Button
                          type="link"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setEditingEnvId(null);
                            setIntegrationEnvReadOnly(false);
                            setIntegrationEnvTab('basic');
                            setIntegrationEnvModalOpen(true);
                          }}
                        >
                          {t('integration.env.add')}
                        </Button>
                      </div>
                      <div className={styles.integrationCardGrid}>
                        {integrationEnvList.map((env) => (
                          <div className={parentStyles.detailSourceCard} key={env.envId}>
                            <div className={parentStyles.detailSourceHeader}>
                              <span className={parentStyles.detailSourceIcon}>
                                <FundProjectionScreenOutlined />
                              </span>
                              <div className={parentStyles.detailSourceTitle}>
                                <strong>{env.envName}</strong>
                                <span>{env.address}</span>
                              </div>
                              <Tag color="processing">{t(orchestratorTagKey(env.orchestrator))}</Tag>
                            </div>
                            <div className={styles.integrationCardBody}>
                              <div className={styles.integrationField}>
                                <span className={styles.integrationFieldLabel}>
                                  {t('integration.envModal.connProtocol')}
                                </span>
                                <span className={styles.integrationFieldValue}>
                                  {env.connProtocol === 'local'
                                    ? t('integration.envModal.connLocal')
                                    : `${env.connUser || ''}@${env.connHost || ''}${
                                      env.connPort ? `:${env.connPort}` : ''
                                    }`}
                                </span>
                              </div>
                              <div className={styles.integrationField}>
                                <span className={styles.integrationFieldLabel}>
                                  {t('integration.envModal.tabAccounts')}
                                </span>
                                <span className={styles.integrationFieldValue}>
                                  {parseJsonArray<TestAccount>(env.testAccounts, []).map((a) => (
                                    <Tag key={a.id} className={styles.integrationMwTag}>
                                      {a.role}
                                    </Tag>
                                  ))}
                                </span>
                              </div>
                            </div>
                            <div className={styles.integrationCardActions}>
                              <Button
                                type="link"
                                size="small"
                                icon={<ProfileOutlined />}
                                onClick={() => openLogModal('env', env.envId, env.envName)}
                              >
                                {t('integration.log.button')}
                              </Button>
                              <Button
                                type="link"
                                size="small"
                                icon={<EyeOutlined />}
                                onClick={() => openEnvModal(env, true)}
                              >
                                {t('common.view')}
                              </Button>
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => openEnvModal(env, false)}
                              >
                                {t('common.edit')}
                              </Button>
                              <Button
                                type="link"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteEnv(env)}
                              >
                                {t('common.delete')}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 测试用例集管理:每个套件是独立工程,带运行器与运行命令 */}
                    <div className={styles.integrationSection}>
                      <div className={styles.integrationSectionHeader}>
                        <span className={styles.integrationSectionTitle}>{t('integration.suite.title')}</span>
                        <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCreateSuiteModal}>
                          {t('integration.suite.add')}
                        </Button>
                      </div>
                      <div className={styles.integrationCardGrid}>
                        {integrationSuiteList.map((suite) => {
                          const suiteEnabled = suite.enabled !== '0';
                          return (
                            <div className={parentStyles.detailSourceCard} key={suite.suiteId}>
                              <div className={parentStyles.detailSourceHeader}>
                                <span className={parentStyles.detailSourceIcon}>
                                  <FileTextOutlined />
                                </span>
                                <div className={parentStyles.detailSourceTitle}>
                                  <strong>{suite.suiteName}</strong>
                                  <span>
                                    {suite.source}
                                    {suite.branch ? ` · ${suite.branch}` : ''}
                                  </span>
                                </div>
                                <Tag color="processing">{suite.runner}</Tag>
                                <Switch
                                  size="small"
                                  checked={suiteEnabled}
                                  onChange={(next) => handleToggleSuite(suite, next)}
                                />
                              </div>
                              <div className={styles.integrationCardBody}>
                                {suite.runner === 'manual' ? (
                                  <div className={styles.integrationField}>
                                    <span className={styles.integrationFieldLabel}>
                                      {t('integration.suite.manualCases')}
                                    </span>
                                    <span className={styles.integrationFieldValue}>
                                      {t('integration.suite.caseCount', { count: suite.caseCount ?? 0 })}
                                      {' · '}
                                      {t('integration.suite.manualHint')}
                                    </span>
                                  </div>
                                ) : (
                                  <>
                                    <div className={styles.integrationField}>
                                      <span className={styles.integrationFieldLabel}>
                                        {t('integration.suite.sourceType')}
                                      </span>
                                      <span className={styles.integrationFieldValue}>
                                        {t(SUITE_SOURCE_LABEL_KEYS[suite.sourceType ?? 'code'])}
                                        {' · '}
                                        {t('integration.suite.caseCount', { count: suite.caseCount ?? 0 })}
                                      </span>
                                    </div>
                                    <div className={styles.integrationField}>
                                      <span className={styles.integrationFieldLabel}>
                                        {t('integration.suite.runCommand')}
                                      </span>
                                      <span className={`${styles.integrationFieldValue} ${styles.integrationMono}`}>
                                        {suite.runCommand}
                                      </span>
                                    </div>
                                    <div className={styles.integrationField}>
                                      <span className={styles.integrationFieldLabel}>
                                        {t('integration.suite.reportPath')}
                                      </span>
                                      <span className={`${styles.integrationFieldValue} ${styles.integrationMono}`}>
                                        {suite.reportPath}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                              <div className={styles.integrationCardActions}>
                                {suite.runner === 'manual' ? (
                                  <Button
                                    type="link"
                                    size="small"
                                    icon={<PlayCircleOutlined />}
                                    onClick={() => openManualRun(suite)}
                                  >
                                    {t('integration.suite.runManual')}
                                  </Button>
                                ) : (
                                  <Button
                                    type="link"
                                    size="small"
                                    icon={<PlayCircleOutlined />}
                                    disabled={!!runningRunId}
                                    onClick={() => openRunEnvSelect(suite)}
                                  >
                                    {t('integration.suite.runTest')}
                                  </Button>
                                )}
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<ProfileOutlined />}
                                  onClick={() => openLogModal('suite', suite.suiteId, suite.suiteName)}
                                >
                                  {t('integration.log.button')}
                                </Button>
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<EyeOutlined />}
                                  onClick={() => openSuiteModal(suite, true)}
                                >
                                  {t('common.view')}
                                </Button>
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => openSuiteModal(suite, false)}
                                >
                                  {t('common.edit')}
                                </Button>
                                <Button
                                  type="link"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={() => handleDeleteSuite(suite)}
                                >
                                  {t('common.delete')}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
    );
  };
  useEffect(() => {
    if (!integrationConfigOpen) return;
    // 与渠道面板同一模式：集成测试配置内容多，用右侧覆盖层承载。
    const overlayDetailPanelOptions = { overlay: true } as NonNullable<
      Parameters<NonNullable<typeof setDetailPanel>>[1]
    > & { overlay: boolean };
    setDetailPanel?.(renderIntegrationConfigPanel(), overlayDetailPanelOptions);
    // 覆盖层是一次性快照:testerConfig / 环境列表 / 编辑态变更后都要重推,否则右侧面板显示旧数据
    // (集成环境卡片就在这个快照里,删除/新增后必须重推才刷新)。
  }, [
    integrationConfigOpen,
    // 覆盖层是一次性快照,页签是受控组件:切 tab 只改 state 不会自动重推快照,
    // 必须把 integrationPanelTab 纳入依赖,否则快照里的 activeKey 永远停在旧值,点击「无反应」。
    integrationPanelTab,
    setDetailPanel,
    t,
    testerConfig,
    integrationEnvList,
    editingEnvId,
    integrationSuiteList,
    editingSuiteId,
    repos,
    runningRunId,
    // 运行看板的筛选态同理:快照不重推的话,点状态/套件/关键字只改了 state,表格还是旧快照里的行,
    // 表现为"切换不生效、退出重进才对"。看板数据源本身变化也要重推。
    runFilterStatus,
    runFilterSuite,
    runKeyword,
    integrationHistoryList,
  ]);

  useEffect(() => {
    return () => {
      if (integrationConfigOpen) {
        clearDetailPanel?.();
      }
    };
  }, [integrationConfigOpen, clearDetailPanel]);

  useEffect(() => {
    if (!integrationConfigOpen || active) return;
    // 兜底：非点击页签的 activeTab 切换也要关闭集成测试配置覆盖层。
    setIntegrationConfigOpen(false);
    clearDetailPanel?.();
  }, [active, integrationConfigOpen, clearDetailPanel]);
  // 规范现场提示:三条硬契约 + 「完整规范」+「下载 demo」。
  // 之所以不再内联整段契约:弹框是「完成一个动作」的容器,长文放这里没人读,
  // 而且没法分享/收藏。细节交给可寻址的规范页。
  const renderIntegrationSpecCallout = (
    section: string,
    rules: readonly string[],
    ruleIdPrefix: string,
    titleId: string
  ) => (
    <div className={styles.integrationSpecCallout}>
      <div className={styles.integrationSpecCalloutTitle}>
        <ExclamationCircleOutlined />
        <span>{t(titleId)}</span>
      </div>
      <ol className={styles.integrationSpecCalloutRules}>
        {rules.map((rule) => (
          <li key={rule}>{t(`${ruleIdPrefix}.${rule}`)}</li>
        ))}
      </ol>
      <div className={styles.integrationSpecCalloutActions}>
        <Button type="link" size="small" onClick={() => openSpec(section)}>
          {t('integration.spec.openFull')}
        </Button>
        <Button type="link" size="small" onClick={() => openSpec(E2E_SPEC_SECTIONS.demo)}>
          {t('integration.spec.openDemo')}
        </Button>
      </div>
    </div>
  );

  // 用例集作者现场提示:报告路径 / 退出码 / 失败证据,三条违反即坏。
  const renderIntegrationSuiteSpec = () =>
    renderIntegrationSpecCallout(
      E2E_SPEC_SECTIONS.suite,
      E2E_SUITE_HARD_RULES,
      'integration.suiteSpec.rule',
      'integration.suiteSpec.calloutTitle'
    );

  // 编排层现场提示:原子写 / failed 与 error 区分 / 异常兜底终态。
  const renderIntegrationRunSpec = () =>
    renderIntegrationSpecCallout(
      E2E_SPEC_SECTIONS.orchestrator,
      E2E_RUN_HARD_RULES,
      'integration.spec.rule',
      'integration.spec.calloutTitle'
    );

  const renderIntegrationSuiteModal = () => {
    const setField = (key: keyof typeof integrationSuiteForm, value: string) =>
      setIntegrationSuiteForm((prev) => ({ ...prev, [key]: value }));
    // 切换运行器时给出该运行器的默认运行命令,减少手填。
    const runnerDefaults: Record<TestSuite['runner'], { cmd: string; report: string }> = {
      pytest: { cmd: 'pytest -q --junitxml=report/junit.xml', report: 'report/junit.xml' },
      playwright: { cmd: 'npx playwright test --reporter=junit', report: 'results/junit.xml' },
      jest: { cmd: 'npx jest --reporters=jest-junit', report: 'junit.xml' },
      vitest: { cmd: 'npx vitest run --reporter=junit --outputFile=junit.xml', report: 'junit.xml' },
      custom: { cmd: '', report: 'junit.xml' },
      manual: { cmd: '', report: '' },
    };
    const isManual = integrationSuiteForm.runner === 'manual';
    return (
      <Modal
        title={t(integrationSuiteReadOnly ? 'integration.suiteModal.viewTitle' : 'integration.suiteModal.title')}
        open={integrationSuiteModalOpen}
        onCancel={() => setIntegrationSuiteModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setIntegrationSuiteModalOpen(false)}>
            {t('common.close')}
          </Button>,
          ...(integrationSuiteReadOnly
            ? []
            : [
              <Button key="save" type="primary" onClick={handleSaveSuite}>
                {t('integration.envModal.save')}
              </Button>,
            ]),
        ]}
        width={560}
        zIndex={1100}
      >
        {/* 查看态:整块表单禁用,只读展示。 */}
        <ConfigProvider componentDisabled={integrationSuiteReadOnly}>
          <div className={parentStyles.formField}>
            <label>
              <span style={{ color: '#ff4d4f', marginInlineEnd: 4 }}>*</span>
              {t('integration.suiteModal.name')}
            </label>
            <Input
              placeholder={t('integration.suiteModal.namePlaceholder')}
              value={integrationSuiteForm.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          </div>
          <div className={styles.integrationConnRow}>
            <div className={parentStyles.formField} style={{ flex: 1 }}>
              <label>{t('integration.suiteModal.runner')}</label>
              <Select
                value={integrationSuiteForm.runner}
                onChange={(v: TestSuite['runner']) =>
                  setIntegrationSuiteForm((prev) => ({
                    ...prev,
                    runner: v,
                    runCommand: runnerDefaults[v].cmd,
                    reportPath: runnerDefaults[v].report,
                  }))
                }
                options={[
                  { value: 'pytest', label: 'pytest (Python)' },
                  { value: 'playwright', label: 'Playwright (Node)' },
                  { value: 'jest', label: 'Jest (Node)' },
                  { value: 'vitest', label: 'Vitest (Node)' },
                  { value: 'custom', label: t('integration.suiteModal.runnerCustom') },
                  { value: 'manual', label: t('integration.suiteModal.runnerManual') },
                ]}
                style={{ width: '100%' }}
              />
            </div>
            {!isManual && (
              <div className={parentStyles.formField} style={{ flex: 1 }}>
                <label>{t('integration.suiteModal.sourceType')}</label>
                <Radio.Group
                  value={integrationSuiteForm.sourceType}
                  onChange={(e) => setField('sourceType', e.target.value)}
                >
                  <Radio value="code">{t('integration.suite.sourceCode')}</Radio>
                  <Radio value="standalone">{t('integration.suite.sourceStandalone')}</Radio>
                  <Radio value="env">{t('integration.suite.sourceEnv')}</Radio>
                </Radio.Group>
              </div>
            )}
          </div>
          {!isManual && (
            <>
              <div className={styles.integrationNote}>{t('integration.suiteModal.sourceTypeHint')}</div>
              {/* env 来源:用例已在环境机上,不涉及任何仓库与分支,工作目录基准取环境配置的工作目录。 */}
              {integrationSuiteForm.sourceType === 'env' ? (
                <div className={styles.integrationNote}>{t('integration.suiteModal.envSourceHint')}</div>
              ) : integrationSuiteForm.sourceType === 'code' ? (
                // code 来源:用例随被测代码,复用项目「关联仓库」列表;source 冗余仓库 URL,权威关联走 repoId。
                <div className={parentStyles.formField}>
                  <label>{t('integration.suiteModal.codeRepo')}</label>
                  <Select
                    placeholder={t('source.placeholder.repository')}
                    value={integrationSuiteForm.repoId}
                    onChange={(repoId) => {
                      const repo = repos.find((r) => r.repoId === repoId);
                      setIntegrationSuiteForm((prev) => ({
                        ...prev,
                        repoId,
                        source: repo?.repoUrl || repo?.repoFullName || '',
                        branch: repo?.defaultBranch || prev.branch,
                      }));
                    }}
                    options={repos.map((repo) => ({
                      value: repo.repoId,
                      label: repo.repoFullName || repo.repoUrl || String(repo.repoId),
                    }))}
                    notFoundContent={repos.length ? undefined : t('source.noRepositories')}
                    style={{ width: '100%' }}
                  />
                </div>
              ) : (
                // standalone 来源:用例在独立仓库,由测试员工按 URL+分支克隆;无 repoId 关联。
                <div className={parentStyles.formField}>
                  <label>{t('integration.suiteModal.standaloneRepo')}</label>
                  <Input
                    placeholder="git@git.internal:qa/byclaw-e2e.git"
                    value={integrationSuiteForm.source}
                    onChange={(e) => setField('source', e.target.value)}
                  />
                </div>
              )}
              {integrationSuiteForm.sourceType !== 'env' && (
                <div className={parentStyles.formField}>
                  <label>{t('integration.suiteModal.branch')}</label>
                  <Input
                    placeholder="main"
                    value={integrationSuiteForm.branch}
                    onChange={(e) => setField('branch', e.target.value)}
                  />
                  {/* 沿用开发检出目录时分支由开发环节决定,此处仅作克隆兜底;克隆来源时它就是要检出的分支。 */}
                  <div className={styles.integrationNote}>
                    {integrationSuiteForm.sourceType === 'code'
                      ? t('integration.suiteModal.branchHintCode')
                      : t('integration.suiteModal.branchHintStandalone')}
                  </div>
                </div>
              )}
              <div className={parentStyles.formField}>
                <label>{t('integration.suiteModal.workdir')}</label>
                <Input
                  placeholder="."
                  value={integrationSuiteForm.workdir}
                  onChange={(e) => setField('workdir', e.target.value)}
                />
                {/* env 来源的基准目录是环境配置的工作目录,不是克隆出来的用例目录,得说清相对谁。 */}
                {integrationSuiteForm.sourceType === 'env' && (
                  <div className={styles.integrationNote}>{t('integration.suiteModal.workdirHintEnv')}</div>
                )}
              </div>
              <div className={parentStyles.formField}>
                <label>{t('integration.suite.runCommand')}</label>
                <Input.TextArea
                  className={styles.integrationStageScript}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  placeholder="pytest -q --junitxml=report/junit.xml"
                  value={integrationSuiteForm.runCommand}
                  onChange={(e) => setField('runCommand', e.target.value)}
                />
              </div>
              <div className={parentStyles.formField}>
                <label>{t('integration.suite.reportPath')}</label>
                <Input
                  placeholder="report/junit.xml"
                  value={integrationSuiteForm.reportPath}
                  onChange={(e) => setField('reportPath', e.target.value)}
                />
              </div>
              <div className={styles.integrationNote}>{t('integration.suiteModal.reportHint')}</div>
              {renderIntegrationSuiteSpec()}
            </>
          )}

          {/* V2 手测:清单在仓库里,只登记 来源仓库+分支+清单文件路径;下方是平台读取该文件后解析出的只读预览。 */}
          {isManual && (
            <>
              <div className={parentStyles.formField}>
                <label>{t('integration.suiteModal.gitUrl')}</label>
                <Input
                  placeholder="git@git.internal:qa/byclaw-web-e2e.git"
                  value={integrationSuiteForm.source}
                  onChange={(e) => setField('source', e.target.value)}
                />
              </div>
              <div className={styles.integrationConnRow}>
                <div className={parentStyles.formField} style={{ flex: 1 }}>
                  <label>{t('integration.suiteModal.branch')}</label>
                  <Input
                    placeholder="main"
                    value={integrationSuiteForm.branch}
                    onChange={(e) => setField('branch', e.target.value)}
                  />
                </div>
                <div className={parentStyles.formField} style={{ flex: 2 }}>
                  <label>{t('integration.suiteModal.manualFile')}</label>
                  <Input
                    placeholder="e2e/manual-cases.md"
                    value={integrationSuiteForm.manualFile}
                    onChange={(e) => setField('manualFile', e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.integrationNote}>{t('integration.suiteModal.manualFileHint')}</div>

              <div className={styles.integrationSectionHeader}>
                <span className={styles.integrationSectionTitle}>{t('integration.suiteModal.manualPreviewTitle')}</span>
              </div>
              {integrationSuiteForm.manualCases.length ? (
                integrationSuiteForm.manualCases.map((c, idx) => (
                  <div className={styles.integrationStageCard} key={c.id}>
                    <div className={styles.integrationStageHead}>
                      <span className={styles.integrationStageIdx}>{idx + 1}</span>
                      <strong className={styles.reqIntegrationTitle}>{c.title}</strong>
                    </div>
                    <div className={styles.manualRunSteps}>{c.steps}</div>
                    <div className={styles.manualRunExpected}>{c.expected}</div>
                  </div>
                ))
              ) : (
                <div className={styles.integrationNote}>{t('integration.suiteModal.manualPreviewEmpty')}</div>
              )}
            </>
          )}
        </ConfigProvider>
      </Modal>
    );
  };

  const renderIntegrationEnvModal = () => {
    const setField = (key: keyof typeof integrationEnvForm, value: string) =>
      setIntegrationEnvForm((prev) => ({ ...prev, [key]: value }));
    const orchestrator = integrationEnvForm.orchestrator;
    const updateStage = (id: string, patch: Partial<IntegrationStage>) =>
      setIntegrationEnvForm((prev) => ({
        ...prev,
        stages: prev.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }));
    const removeStage = (id: string) =>
      setIntegrationEnvForm((prev) => ({ ...prev, stages: prev.stages.filter((s) => s.id !== id) }));
    const addStage = () =>
      setIntegrationEnvForm((prev) => ({
        ...prev,
        stages: [
          ...prev.stages,
          {
            id: `stage-${Date.now()}`,
            name: '',
            interpreter: 'bash',
            source: 'inline',
            script: '',
            workdir: prev.connWorkdir,
            timeoutSec: 300,
            continueOnError: false,
          },
        ],
      }));
    const updateAccount = (id: string, patch: Partial<TestAccount>) =>
      setIntegrationEnvForm((prev) => ({
        ...prev,
        testAccounts: prev.testAccounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    const removeAccount = (id: string) =>
      setIntegrationEnvForm((prev) => ({
        ...prev,
        testAccounts: prev.testAccounts.filter((a) => a.id !== id),
      }));
    const addAccount = () =>
      setIntegrationEnvForm((prev) => ({
        ...prev,
        testAccounts: [
          ...prev.testAccounts,
          { id: `acc-${Date.now()}`, role: '', envPrefix: '', username: '', credentialRef: '' },
        ],
      }));
    return (
      <Modal
        title={t(integrationEnvReadOnly ? 'integration.envModal.viewTitle' : 'integration.envModal.title')}
        open={integrationEnvModalOpen}
        onCancel={() => setIntegrationEnvModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setIntegrationEnvModalOpen(false)}>
            {t('common.close')}
          </Button>,
          ...(integrationEnvReadOnly
            ? []
            : [
              <Button key="save" type="primary" onClick={handleSaveEnv}>
                {t('integration.envModal.save')}
              </Button>,
            ]),
        ]}
        width={720}
        zIndex={1100}
      >
        {/* 查看态:整块表单禁用,只读展示。内容按 基本信息/环境准备/测试账号/结果规范 分 Tab,避免又窄又长。 */}
        <ConfigProvider componentDisabled={integrationEnvReadOnly}>
          <Tabs
            activeKey={integrationEnvTab}
            onChange={setIntegrationEnvTab}
            items={[
              {
                key: 'basic',
                label: t('integration.envModal.tabBasic'),
                children: (
                  <>
                    <div className={parentStyles.formField}>
                      <label>{t('integration.envModal.name')}</label>
                      <Input
                        placeholder={t('integration.envModal.namePlaceholder')}
                        value={integrationEnvForm.name}
                        onChange={(e) => setField('name', e.target.value)}
                      />
                    </div>
                    <div className={parentStyles.formField}>
                      <label>{t('integration.envModal.address')}</label>
                      <Input
                        placeholder="https://it-integration.internal:8443"
                        value={integrationEnvForm.address}
                        onChange={(e) => setField('address', e.target.value)}
                      />
                    </div>
                    <div className={parentStyles.formField}>
                      <label>{t('integration.envModal.orchestrator')}</label>
                      <Select
                        value={orchestrator}
                        onChange={(v) => setField('orchestrator', v)}
                        options={[
                          { value: 'script', label: t('integration.envModal.orchScript') },
                          { value: 'jenkins', label: t('integration.envModal.orchJenkins') },
                          { value: 'k8s', label: t('integration.envModal.orchK8s') },
                          { value: 'webhook', label: t('integration.envModal.orchWebhook') },
                        ]}
                        style={{ width: '100%' }}
                      />
                      <div className={styles.integrationNote}>{t('integration.envModal.orchHint')}</div>
                    </div>
                    {/* 定时(cron)与执行员工归属「独立测试数字员工」配置(需求级,一份),不在环境重复填写。 */}
                  </>
                ),
              },
              {
                key: 'prepare',
                label: t('integration.envModal.tabPrepare'),
                children:
                  orchestrator !== 'script' ? (
                    <div className={styles.integrationNote}>{t(`integration.envModal.hint.${orchestrator}`)}</div>
                  ) : (
                    <>
                      {/* 连接信息:目标构建机 */}
                      <div className={styles.integrationSectionTitle}>{t('integration.envModal.connTitle')}</div>
                      <div className={parentStyles.formField}>
                        <label>{t('integration.envModal.connProtocol')}</label>
                        <Radio.Group
                          value={integrationEnvForm.connProtocol}
                          onChange={(e) => setField('connProtocol', e.target.value)}
                          options={[
                            { value: 'ssh', label: 'SSH' },
                            { value: 'local', label: t('integration.envModal.connLocal') },
                          ]}
                          optionType="button"
                        />
                      </div>
                      {integrationEnvForm.connProtocol === 'ssh' && (
                        <>
                          <div className={styles.integrationConnRow}>
                            <div className={parentStyles.formField} style={{ flex: 2 }}>
                              <label>{t('integration.envModal.connHost')}</label>
                              <Input
                                placeholder="10.0.12.34"
                                value={integrationEnvForm.connHost}
                                onChange={(e) => setField('connHost', e.target.value)}
                              />
                            </div>
                            <div className={parentStyles.formField} style={{ flex: 1 }}>
                              <label>{t('integration.envModal.connPort')}</label>
                              <Input
                                placeholder="22"
                                value={integrationEnvForm.connPort}
                                onChange={(e) => setField('connPort', e.target.value)}
                              />
                            </div>
                            <div className={parentStyles.formField} style={{ flex: 1 }}>
                              <label>{t('integration.envModal.connUser')}</label>
                              <Input
                                placeholder="deploy"
                                value={integrationEnvForm.connUser}
                                onChange={(e) => setField('connUser', e.target.value)}
                              />
                            </div>
                          </div>
                          <div className={styles.integrationConnRow}>
                            <div className={parentStyles.formField} style={{ flex: 1 }}>
                              <label>{t('integration.envModal.connAuth')}</label>
                              <Select
                                value={integrationEnvForm.connAuth}
                                onChange={(v) => setField('connAuth', v)}
                                options={[
                                  { value: 'key', label: t('integration.envModal.connAuthKey') },
                                  { value: 'password', label: t('integration.envModal.connAuthPassword') },
                                ]}
                                style={{ width: '100%' }}
                              />
                            </div>
                            <div className={parentStyles.formField} style={{ flex: 2 }}>
                              <label>{t('integration.envModal.connCredentialRef')}</label>
                              <Input.Password
                                autoComplete="new-password"
                                placeholder={t(
                                  integrationEnvForm.hasConnCredential
                                    ? 'integration.envModal.connCredentialKeep'
                                    : 'integration.envModal.connCredentialPlaceholder'
                                )}
                                value={integrationEnvForm.connCredentialRef}
                                onChange={(e) => setField('connCredentialRef', e.target.value)}
                              />
                            </div>
                          </div>
                        </>
                      )}
                      <div className={parentStyles.formField}>
                        <label>{t('integration.envModal.connWorkdir')}</label>
                        <Input
                          placeholder="/opt/byclaw/ci"
                          value={integrationEnvForm.connWorkdir}
                          onChange={(e) => setField('connWorkdir', e.target.value)}
                        />
                      </div>

                      {/* 生命周期阶段:每阶段一段完整脚本 */}
                      <div className={parentStyles.repoModalDivider} />
                      <div className={styles.integrationSectionHeader}>
                        <span className={styles.integrationSectionTitle}>{t('integration.envModal.stagesTitle')}</span>
                        <Button type="link" size="small" icon={<PlusOutlined />} onClick={addStage}>
                          {t('integration.envModal.addStage')}
                        </Button>
                      </div>
                      <div className={styles.integrationNote}>{t('integration.envModal.varsHint')}</div>
                      {integrationEnvForm.stages.map((stage, idx) => (
                        <div className={styles.integrationStageCard} key={stage.id}>
                          <div className={styles.integrationStageHead}>
                            <span className={styles.integrationStageIdx}>{idx + 1}</span>
                            <Input
                              className={styles.integrationStageName}
                              placeholder={t('integration.envModal.stageName')}
                              value={stage.name}
                              onChange={(e) => updateStage(stage.id, { name: e.target.value })}
                            />
                            <Select
                              size="small"
                              value={stage.interpreter}
                              onChange={(v) => updateStage(stage.id, { interpreter: v })}
                              options={[
                                { value: 'bash', label: 'bash' },
                                { value: 'sh', label: 'sh' },
                                { value: 'python', label: 'python' },
                                { value: 'node', label: 'node' },
                              ]}
                              style={{ width: 96 }}
                            />
                            <Select
                              size="small"
                              value={stage.source}
                              onChange={(v) => updateStage(stage.id, { source: v })}
                              options={[
                                { value: 'inline', label: t('integration.envModal.sourceInline') },
                                { value: 'path', label: t('integration.envModal.sourcePath') },
                              ]}
                              style={{ width: 110 }}
                            />
                            <Button
                              type="link"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() => removeStage(stage.id)}
                            />
                          </div>
                          {stage.source === 'inline' ? (
                            <Input.TextArea
                              className={styles.integrationStageScript}
                              autoSize={{ minRows: 3, maxRows: 12 }}
                              placeholder={t('integration.envModal.scriptPlaceholder')}
                              value={stage.script}
                              onChange={(e) => updateStage(stage.id, { script: e.target.value })}
                            />
                          ) : (
                            <Input
                              placeholder="deploy/db/incremental/run-all.sh"
                              value={stage.script}
                              onChange={(e) => updateStage(stage.id, { script: e.target.value })}
                            />
                          )}
                          <div className={styles.integrationStageFoot}>
                            <span>{t('integration.envModal.workdir')}</span>
                            <Input
                              size="small"
                              value={stage.workdir}
                              onChange={(e) => updateStage(stage.id, { workdir: e.target.value })}
                              style={{ width: 200 }}
                            />
                            <span>{t('integration.envModal.timeout')}</span>
                            <InputNumber
                              size="small"
                              min={1}
                              value={stage.timeoutSec}
                              onChange={(v) => updateStage(stage.id, { timeoutSec: Number(v) || 300 })}
                              style={{ width: 90 }}
                            />
                            <Switch
                              size="small"
                              checked={stage.continueOnError}
                              onChange={(v) => updateStage(stage.id, { continueOnError: v })}
                            />
                            <span>{t('integration.envModal.continueOnError')}</span>
                          </div>
                        </div>
                      ))}
                      {/* 硬契约贴在编排脚本填写处,而不是单开一个「结果规范」页签:
                          页签要主动点,填脚本的人正需要看的就是这三条。 */}
                      {renderIntegrationRunSpec()}
                    </>
                  ),
              },
              {
                key: 'accounts',
                label: t('integration.envModal.tabAccounts'),
                children: (
                  <>
                    {/* 被测应用的业务测试账号:E2E 登录用。密码只存凭据引用,编排层注入成环境变量供脚本读取。 */}
                    <div className={styles.integrationSectionHeader}>
                      <span className={styles.integrationSectionTitle}>{t('integration.envModal.accTitle')}</span>
                      <Button type="link" size="small" icon={<PlusOutlined />} onClick={addAccount}>
                        {t('integration.envModal.accAdd')}
                      </Button>
                    </div>
                    <div className={styles.integrationNote}>{t('integration.envModal.accHint')}</div>
                    {integrationEnvForm.testAccounts.map((acc) => (
                      <div className={styles.integrationAccountCard} key={acc.id}>
                        <div className={styles.integrationAccountRow}>
                          <div className={parentStyles.formField} style={{ flex: 1 }}>
                            <label>{t('integration.envModal.accRole')}</label>
                            <Input
                              placeholder={t('integration.envModal.accRolePlaceholder')}
                              value={acc.role}
                              onChange={(e) => updateAccount(acc.id, { role: e.target.value })}
                            />
                          </div>
                          <div className={parentStyles.formField} style={{ flex: 1 }}>
                            <label>{t('integration.envModal.accEnvPrefix')}</label>
                            <Input
                              placeholder="E2E_ADMIN"
                              value={acc.envPrefix}
                              onChange={(e) => updateAccount(acc.id, { envPrefix: e.target.value.toUpperCase() })}
                            />
                          </div>
                          <Button
                            type="link"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => removeAccount(acc.id)}
                          />
                        </div>
                        <div className={styles.integrationAccountRow}>
                          <div className={parentStyles.formField} style={{ flex: 1 }}>
                            <label>{t('integration.envModal.accUsername')}</label>
                            <Input
                              placeholder="qa_admin"
                              value={acc.username}
                              onChange={(e) => updateAccount(acc.id, { username: e.target.value })}
                            />
                          </div>
                          <div className={parentStyles.formField} style={{ flex: 1 }}>
                            <label>{t('integration.envModal.accCredentialRef')}</label>
                            <Input.Password
                              autoComplete="new-password"
                              placeholder={t(
                                acc.hasCredential
                                  ? 'integration.envModal.connCredentialKeep'
                                  : 'integration.envModal.accCredentialPlaceholder'
                              )}
                              value={acc.credentialRef}
                              onChange={(e) => updateAccount(acc.id, { credentialRef: e.target.value })}
                            />
                          </div>
                        </div>
                        {acc.envPrefix && (
                          <div className={styles.integrationAccountInject}>
                            {t('integration.envModal.accInject', {
                              user: `$${acc.envPrefix}_USER`,
                              pass: `$${acc.envPrefix}_PASS`,
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                ),
              },
            ]}
          />
        </ConfigProvider>
      </Modal>
    );
  };

  // 套件明细:每套一个可折叠块,失败套件默认展开,列出失败用例 + 失败信息 + 截图/artifacts。
  // 手动测试执行:测试人对每条用例判 通过/失败/跳过,填备注、贴截图。提交后平台汇总成与自动化一致的套件结果。
  const renderManualRunModal = () => {
    const suite = manualRunSuite;
    // 手测清单不入库(在仓库文件里),当前无预览用例;后续从 manualFile 解析后填充。
    const cases: ManualCase[] = [];
    const decided = cases.filter((c) => manualRunRecords[c.id]?.result).length;
    const hasFail = cases.some((c) => manualRunRecords[c.id]?.result === 'fail');
    const allDecided = cases.length > 0 && decided === cases.length;
    return (
      <Modal
        title={
          suite
            ? t('integration.manualRun.title', { name: suite.suiteName })
            : t('integration.manualRun.title', { name: '' })
        }
        open={manualRunOpen}
        onCancel={() => setManualRunOpen(false)}
        footer={[
          <Button key="close" onClick={() => setManualRunOpen(false)}>
            {t('common.close')}
          </Button>,
          <Button
            key="submit"
            type="primary"
            disabled={!allDecided}
            onClick={() => {
              // 演示态:仅提示。真实实现把记录写成套件结果 -> status.json;有失败则整轮打回 coder。
              message.info(t(hasFail ? 'integration.manualRun.submittedFail' : 'integration.manualRun.submittedPass'));
              setManualRunOpen(false);
            }}
          >
            {t('integration.manualRun.submit')}
          </Button>,
        ]}
        width={720}
        zIndex={1100}
      >
        <div className={styles.manualRunProgress}>
          {t('integration.manualRun.progress', { decided, total: cases.length })}
          {hasFail ? (
            <Tag color="error" style={{ marginLeft: 8 }}>
              {t('integration.manualRun.hasFail')}
            </Tag>
          ) : null}
        </div>
        {cases.map((c, idx) => {
          const rec = manualRunRecords[c.id] ?? { result: '', remark: '', shots: [] };
          return (
            <div className={styles.manualRunCase} key={c.id}>
              <div className={styles.manualRunCaseTitle}>
                <span className={styles.integrationStageIdx}>{idx + 1}</span>
                <strong>{c.title}</strong>
              </div>
              <div className={styles.manualRunCaseMeta}>
                <div>
                  <span className={styles.manualRunLabel}>{t('integration.suiteModal.caseSteps')}</span>
                  <pre className={styles.manualRunSteps}>{c.steps}</pre>
                </div>
                <div>
                  <span className={styles.manualRunLabel}>{t('integration.suiteModal.caseExpected')}</span>
                  <div className={styles.manualRunExpected}>{c.expected}</div>
                </div>
              </div>
              <Radio.Group
                value={rec.result}
                onChange={(e) => setManualRecord(c.id, { result: e.target.value })}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'pass', label: t('integration.manualRun.pass') },
                  { value: 'fail', label: t('integration.manualRun.fail') },
                  { value: 'skip', label: t('integration.manualRun.skip') },
                ]}
              />
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 4 }}
                placeholder={t('integration.manualRun.remarkPlaceholder')}
                value={rec.remark}
                onChange={(e) => setManualRecord(c.id, { remark: e.target.value })}
                style={{ marginTop: 8 }}
              />
              <div className={styles.manualRunShots}>
                <Upload
                  listType="picture-card"
                  fileList={rec.shots.map((name, i) => ({ uid: `${c.id}-${i}`, name, status: 'done' as const }))}
                  beforeUpload={(file) => {
                    // 演示态:不真正上传,仅把文件名记进列表示意"截图已附加"。
                    setManualRecord(c.id, { shots: [...rec.shots, file.name] });
                    return false;
                  }}
                  onRemove={(file) => setManualRecord(c.id, { shots: rec.shots.filter((n) => n !== file.name) })}
                >
                  {rec.shots.length >= 6 ? null : (
                    <div>
                      <PlusOutlined />
                      <div style={{ marginTop: 4 }}>{t('integration.manualRun.addShot')}</div>
                    </div>
                  )}
                </Upload>
              </div>
            </div>
          );
        })}
      </Modal>
    );
  };

  const renderIntegrationResultSuites = (r: IntegrationRunResult) => (
    <Collapse
      size="small"
      className={styles.integrationResultSuites}
      defaultActiveKey={r.suites.filter((s) => s.status === 'failed').map((s) => s.suiteId)}
      items={r.suites.map((s) => ({
        key: s.suiteId,
        label: (
          <div className={styles.integrationResultSuiteHead}>
            <Tag color={s.status === 'passed' ? 'success' : s.status === 'skipped' ? 'default' : 'error'}>
              {t(`integration.result.status.${s.status}`)}
            </Tag>
            <span className={styles.integrationResultSuiteName}>{s.name}</span>
            <span className={styles.integrationResultSuiteStat}>
              {t('integration.result.passOf', { passed: s.passed, total: s.total })}
              {` · ${t('integration.result.duration', { sec: s.durationSec })}`}
            </span>
          </div>
        ),
        children: (
          <div className={styles.integrationResultSuiteBody}>
            <div className={styles.integrationResultSuitePaths}>
              {/* 报告路径可点:后端按需去环境机读原文,弹窗里能看能下载。没配路径时保持纯文本。 */}
              {s.reportPath ? (
                <Tooltip title={t('integration.result.viewReport')}>
                  <a className={styles.integrationMono} onClick={() => openReportPreview(r.runId, s.reportPath)}>
                    <FileTextOutlined /> {s.reportPath}
                  </a>
                </Tooltip>
              ) : null}
              <span className={styles.integrationMono}>{s.logPath}</span>
            </div>
            {s.failedCases.length === 0 ? (
              <div className={styles.integrationResultAllPass}>{t('integration.result.allPass')}</div>
            ) : (
              s.failedCases.map((c) => (
                <div className={styles.integrationResultCase} key={c.caseId}>
                  <div className={styles.integrationResultCaseName}>
                    <CloseOutlined className={styles.integrationResultCaseIcon} />
                    <span className={styles.integrationMono}>{c.caseId}</span>
                  </div>
                  <div className={styles.integrationResultCaseMsg}>{c.message}</div>
                  {c.artifacts.length > 0 ? (
                    <div className={styles.integrationResultArtifacts}>
                      {c.artifacts.map((a) => (
                        <Tag key={a} className={styles.integrationResultArtifactTag}>
                          {a.split('/').pop()}
                        </Tag>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ),
      }))}
    />
  );

  // 日志复制走带降级的工具函数:内网常是 http,navigator.clipboard 在非安全上下文不可用。
  const copyLogText = (text: string) => {
    if (!text.trim()) {
      message.warning(t('integration.result.noLog'));
      return;
    }
    copyTextToClipboard(
      text,
      () => message.success(t('common.copySuccess')),
      () => message.error(t('common.copyFail'))
    );
  };

  // 整段日志带上步骤名/状态/退出码:贴给研发或 AI 排查时不用再回来对照弹窗。
  const buildRunLogText = (r: IntegrationRunResult) =>
    (r.steps ?? [])
      .map((step) => {
        const exit = typeof step.exitCode === 'number' ? ` (exit ${step.exitCode})` : '';
        const head = `[${step.status}] ${step.stepName}${exit}`;
        return step.logText ? `${head}\n${step.logText}` : head;
      })
      .join('\n\n');

  // 查看结果:展示一次 E2E 运行的整体状态 + 打回原因 + 各套件明细(失败用例带截图/artifacts)。
  const renderIntegrationResultModal = () => {
    const r = integrationResult;
    const isRunning = !!runningRunId && (!r || !['passed', 'failed', 'error', 'timeout'].includes(r.status));
    return (
      <Modal
        title={t('integration.result.runTitle')}
        open={integrationResultOpen}
        onCancel={closeIntegrationResult}
        footer={[
          // 报告入口放脚注:reportPath 只在 suites 里,而 tester 回流/解析失败的 run 没有 suites,
          // 那时套件明细整块不渲染,报告就没了入口。后端只要 runId 就能定位报告路径,这里不依赖 suites。
          <Button
            key="report"
            icon={<FileTextOutlined />}
            disabled={!r || isRunning}
            onClick={() => r && openReportPreview(r.runId, r.suites[0]?.reportPath || '')}
          >
            {t('integration.result.viewReportBtn')}
          </Button>,
          // 排查失败通常要整段日志,单步复制之外再给一个一次性复制入口。
          <Button
            key="copyAll"
            icon={<CopyOutlined />}
            disabled={!r?.steps?.length}
            onClick={() => copyLogText(r ? buildRunLogText(r) : '')}
          >
            {t('integration.result.copyAllLog')}
          </Button>,
          <Button key="close" onClick={closeIntegrationResult}>
            {t('common.close')}
          </Button>,
        ]}
        width={760}
        zIndex={1100}
      >
        {r ? (
          <div className={styles.integrationResult}>
            {/* 概览:整体状态 + 通过率 + 耗时 */}
            <div className={styles.integrationResultHead}>
              <Tag color={runStatusColor(r.status)} className={styles.integrationResultStatusTag}>
                {isRunning ? t('integration.result.status.running') : t(`integration.result.status.${r.status}`)}
              </Tag>
              <span className={styles.integrationResultTotals}>
                {t('integration.result.passOf', { passed: r.totals.passed, total: r.totals.total })}
                {r.totals.failed > 0 ? ` · ${t('integration.result.failCount', { count: r.totals.failed })}` : ''}
              </span>
              <span className={styles.integrationResultDuration}>
                {t('integration.result.duration', { sec: r.durationSec })}
              </span>
            </div>

            {/* 执行步骤进度:stages + 套件命令逐条状态,轮询时实时更新 */}
            {r.steps && r.steps.length > 0 ? (
              <div className={styles.integrationResultSteps}>
                {r.steps.map((step) => (
                  <div className={styles.integrationResultStepItem} key={step.seq}>
                    <div className={styles.integrationResultStep}>
                      <Tag color={runStatusColor(step.status)}>{t(`integration.result.status.${step.status}`)}</Tag>
                      <span className={styles.integrationResultStepName}>{step.stepName}</span>
                      <span className={styles.integrationResultStepMeta}>
                        {typeof step.exitCode === 'number'
                          ? t('integration.result.exitCode', { code: step.exitCode })
                          : null}
                      </span>
                      <span className={styles.integrationResultStepMeta}>
                        {t('integration.result.duration', { sec: step.durationSec })}
                      </span>
                    </div>
                    {/* 每步执行日志:后端落 log_text(截断尾部),可折叠查看 */}
                    {step.logText ? (
                      <Collapse
                        ghost
                        size="small"
                        items={[
                          {
                            key: 'log',
                            label: t('integration.result.stepLog'),
                            // 复制按钮放在折叠头 extra:日志常被折叠着,不展开也能直接复制。
                            extra: (
                              <Tooltip title={t('integration.result.copyStepLog')}>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={(e) => {
                                    // 阻止冒泡,否则点复制会顺带折叠/展开面板。
                                    e.stopPropagation();
                                    copyLogText(step.logText ?? '');
                                  }}
                                />
                              </Tooltip>
                            ),
                            children: <pre className={styles.integrationResultStepLog}>{step.logText}</pre>,
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {/* 失败时的打回横幅:直接对应研发闭环里"打回 coder"的动作 */}
            {r.kickbackTo ? (
              <div className={styles.integrationResultKickback}>
                {t('integration.result.kickback', { phase: phaseLabelOf(r.kickbackTo) })}
                {r.reason ? ` · ${r.reason}` : ''}
              </div>
            ) : null}

            {/* 元信息:分支/commit/环境/轮次/时间/结果目录 */}
            <Descriptions size="small" column={2} bordered className={styles.integrationResultMeta}>
              <Descriptions.Item label={t('integration.result.branch')}>{r.branch}</Descriptions.Item>
              <Descriptions.Item label={t('integration.result.commit')}>{r.commit}</Descriptions.Item>
              <Descriptions.Item label={t('integration.result.env')}>{r.envName}</Descriptions.Item>
              <Descriptions.Item label={t('integration.result.round')}>{r.round}</Descriptions.Item>
              <Descriptions.Item label={t('integration.result.startedAt')}>{r.startedAt}</Descriptions.Item>
              <Descriptions.Item label={t('integration.result.finishedAt')}>{r.finishedAt}</Descriptions.Item>
              <Descriptions.Item label={t('integration.result.resultDir')} span={2}>
                <span className={styles.integrationMono}>{r.resultDir}</span>
              </Descriptions.Item>
            </Descriptions>

            {/* 各套件明细:一套一块,失败套件默认展开失败用例 */}
            <div className={styles.integrationResultSuitesTitle}>{t('integration.result.suitesTitle')}</div>
            {renderIntegrationResultSuites(r)}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('integration.result.notReady')} />
        )}
      </Modal>
    );
  };

  // 日志弹窗:列出该环境/套件历次运行,点「查看日志」复用 result Modal 展示 steps[].logText。
  const renderIntegrationLogModal = () => {
    const isEnv = logModalTarget?.kind === 'env';
    const title = isEnv ? t('integration.log.envTitle') : t('integration.log.suiteTitle');
    return (
      <Modal
        title={logModalTarget ? `${title} · ${logModalTarget.name}` : title}
        open={logModalOpen}
        onCancel={() => setLogModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setLogModalOpen(false)}>
            {t('common.close')}
          </Button>,
        ]}
        width={640}
        zIndex={1100}
      >
        <List
          size="small"
          bordered
          loading={logLoading}
          className={styles.integrationHistoryList}
          dataSource={logRuns}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('integration.log.empty')} />,
          }}
          renderItem={(item) => {
            const passed = item.status === 'passed';
            const rate = `${item.passed ?? 0}/${item.total ?? 0}`;
            const suiteName = integrationSuiteList.find((s) => s.suiteId === item.suiteId)?.suiteName;
            return (
              <List.Item
                actions={[
                  <Tag key="result" color={runStatusColor(item.status)}>
                    {t(`integration.result.status.${item.status}`)}
                  </Tag>,
                  <Button key="view" type="link" size="small" onClick={() => openIntegrationResult(item.runId)}>
                    {t('integration.log.viewDetail')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      {suiteName || `#${item.suiteId}`}
                      {item.branch ? <span className={styles.integrationHistoryRound}>{item.branch}</span> : null}
                    </span>
                  }
                  description={
                    <div>
                      <span className={parentStyles.detailSourceTime}>
                        {t('integration.history.passRate', { rate })} · {item.time}
                      </span>
                      {!passed && item.kickbackTo ? (
                        <div className={styles.integrationHistoryKickback}>
                          {t('integration.history.kickback', { phase: phaseLabelOf(item.kickbackTo) })}
                          {item.reason ? ` · ${item.reason}` : ''}
                        </div>
                      ) : null}
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Modal>
    );
  };

  // 独立测试员工配置弹框:绑定员工 + 定时 + 就绪准入 + 打回策略(静态演示,确认只写本地状态)。
  const renderTesterModal = () => (
    <Modal
      title={t('tester.modalTitle')}
      open={testerModalOpen}
      onCancel={() => setTesterModalOpen(false)}
      onOk={handleSaveTester}
      confirmLoading={testerSaving}
      okText={t('integration.envModal.save')}
      cancelText={t('common.cancel')}
      width={560}
      zIndex={1100}
    >
      <div className={styles.testerFormRow}>
        <label>{t('tester.enable')}</label>
        <Switch
          checked={testerDraft.enabled}
          onChange={(enabled) => setTesterDraft((prev) => ({ ...prev, enabled }))}
        />
      </div>

      <div className={parentStyles.formField}>
        <label>{t('tester.agent')}</label>
        {/* 执行员工统一取全局「测试数字员工」默认,此处只读展示;改绑定去「默认数字员工」改,避免两处配置不一致。 */}
        <div className={styles.testerAgentReadonly}>
          <RobotOutlined />
          <strong>{resolvedTesterName || t('tester.noAgent')}</strong>
        </div>
        <p className={styles.testerFormHint}>{t('tester.agentHint')}</p>
      </div>

      <div className={styles.integrationConnRow}>
        <div className={parentStyles.formField} style={{ flex: 1 }}>
          <label>{t('tester.cron')}</label>
          <Input
            placeholder="0 2 * * *"
            value={testerDraft.schedule.cron}
            onChange={(e) =>
              setTesterDraft((prev) => ({
                ...prev,
                schedule: { ...prev.schedule, cron: e.target.value },
              }))
            }
          />
        </div>
        <div className={parentStyles.formField} style={{ flex: 1 }}>
          <label>{t('tester.cronLabel')}</label>
          <Input
            placeholder={t('tester.cronLabelPlaceholder')}
            value={testerDraft.schedule.cronLabel}
            onChange={(e) =>
              setTesterDraft((prev) => ({
                ...prev,
                schedule: { ...prev.schedule, cronLabel: e.target.value },
              }))
            }
          />
        </div>
      </div>
      <p className={styles.testerFormHint}>{t('tester.cronHint')}</p>

      <div className={styles.testerFormRow}>
        <label>{t('tester.requireAllCoded')}</label>
        <Switch
          checked={testerDraft.admission.requireAllCoded}
          onChange={(requireAllCoded) =>
            setTesterDraft((prev) => ({
              ...prev,
              admission: { ...prev.admission, requireAllCoded },
            }))
          }
        />
      </div>
      <p className={styles.testerFormHint}>{t('tester.requireAllCodedHint')}</p>

      <div className={styles.integrationConnRow}>
        <div className={parentStyles.formField} style={{ flex: 1 }}>
          <label>{t('tester.maxConcurrent')}</label>
          <InputNumber
            min={1}
            max={10}
            value={testerDraft.admission.maxConcurrentReqs}
            onChange={(value) =>
              setTesterDraft((prev) => ({
                ...prev,
                admission: { ...prev.admission, maxConcurrentReqs: value ?? 1 },
              }))
            }
            style={{ width: '100%' }}
          />
        </div>
        <div className={parentStyles.formField} style={{ flex: 1 }}>
          <label>{t('tester.maxRoundsField')}</label>
          <InputNumber
            min={1}
            max={10}
            value={testerDraft.kickback.maxRounds}
            onChange={(value) =>
              setTesterDraft((prev) => ({
                ...prev,
                kickback: { ...prev.kickback, maxRounds: value ?? 1 },
              }))
            }
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div className={styles.testerFormRow}>
        <label>{t('tester.autoAttribute')}</label>
        <Switch
          checked={testerDraft.kickback.autoAttribute}
          onChange={(autoAttribute) =>
            setTesterDraft((prev) => ({ ...prev, kickback: { ...prev.kickback, autoAttribute } }))
          }
        />
      </div>
      <div className={styles.testerFormRow}>
        <label>{t('tester.createDefect')}</label>
        <Switch
          checked={testerDraft.kickback.createDefectWhenUnclear}
          onChange={(createDefectWhenUnclear) =>
            setTesterDraft((prev) => ({
              ...prev,
              kickback: { ...prev.kickback, createDefectWhenUnclear },
            }))
          }
        />
      </div>
      <p className={styles.testerFormHint}>{t('tester.kickbackHint')}</p>
    </Modal>
  );

  // 执行测试前的环境选择弹框:自动化套件点「执行测试」后选一个已配置环境再连上去跑。
  const renderRunEnvSelectModal = () => (
    <Modal
      title={t('integration.run.selectEnvTitle')}
      open={runEnvSelectOpen}
      onCancel={() => setRunEnvSelectOpen(false)}
      onOk={handleStartRun}
      okText={t('integration.run.start')}
      okButtonProps={{ loading: runStarting, disabled: !runSelectedEnvId }}
      confirmLoading={runStarting}
      width={480}
      zIndex={1100}
    >
      <div className={styles.integrationField}>
        <span className={styles.integrationFieldLabel}>{t('integration.run.suite')}</span>
        <span className={styles.integrationFieldValue}>{runTargetSuite?.suiteName}</span>
      </div>
      <div className={styles.integrationField}>
        <span className={styles.integrationFieldLabel}>{t('integration.run.env')}</span>
        <Select
          style={{ width: '100%' }}
          value={runSelectedEnvId ?? undefined}
          placeholder={t('integration.run.envPlaceholder')}
          onChange={(v) => setRunSelectedEnvId(v)}
          options={integrationEnvList.map((env) => ({
            value: env.envId,
            label: `${env.envName}${env.connHost ? ` · ${env.connHost}` : ''}`,
          }))}
        />
      </div>
      {/* 执行方式:这里是人工调试入口,默认 backend 当场出结果;定时批量走后端配置的 tester,不受这里影响。 */}
      <div className={styles.integrationField}>
        <span className={styles.integrationFieldLabel}>{t('integration.run.mode')}</span>
        <Radio.Group
          value={runExecutorMode}
          onChange={(e) => setRunExecutorMode(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          size="small"
          options={[
            { value: 'backend', label: t('integration.run.modeBackend') },
            { value: 'tester', label: t('integration.run.modeTester') },
          ]}
        />
      </div>
      <div className={styles.integrationNote}>
        {runExecutorMode === 'tester' ? t('integration.run.hintTester') : t('integration.run.hint')}
      </div>
    </Modal>
  );

  // 手动执行独立测试员工:选一个环境,对项目下所有启用用例集各起一次真实 run。
  const renderTesterRunEnvModal = () => (
    <Modal
      title={t('tester.runModalTitle')}
      open={testerRunEnvOpen}
      onCancel={() => setTesterRunEnvOpen(false)}
      onOk={handleConfirmTesterRun}
      okText={t('tester.runConfirm')}
      okButtonProps={{ loading: testerRunning, disabled: !testerRunEnvId }}
      confirmLoading={testerRunning}
      width={480}
      zIndex={1100}
    >
      <div className={styles.integrationField}>
        <span className={styles.integrationFieldLabel}>{t('tester.runScope')}</span>
        <span className={styles.integrationFieldValue}>{t('tester.runScopeValue')}</span>
      </div>
      <div className={styles.integrationField}>
        <span className={styles.integrationFieldLabel}>{t('integration.run.env')}</span>
        <Select
          style={{ width: '100%' }}
          value={testerRunEnvId ?? undefined}
          placeholder={t('integration.run.envPlaceholder')}
          onChange={(v) => setTesterRunEnvId(v)}
          options={integrationEnvList.map((env) => ({
            value: env.envId,
            label: `${env.envName}${env.connHost ? ` · ${env.connHost}` : ''}`,
          }))}
        />
      </div>
      <div className={styles.integrationNote}>{t('tester.runModalHint')}</div>
    </Modal>
  );

  return (
    <>
      {active ? (embedded ? renderIntegrationConfigPanel() : renderIntegration()) : null}
      {renderIntegrationEnvModal()}
      {renderIntegrationSuiteModal()}
      {renderRunEnvSelectModal()}
      {renderIntegrationResultModal()}
      {renderIntegrationLogModal()}
      {renderManualRunModal()}
      {renderTesterModal()}
      {renderTesterRunEnvModal()}
      {/* 报告预览:复用消息区通用预览弹窗,xml 走高亮源码页签,右上角自带下载/复制。 */}
      <Previewer
        previewInfo={reportPreview}
        onClosePreviewModal={closeReportPreview}
        fileType="xml"
        fileName={reportFileName}
        zIndex={1200}
      />
    </>
  );
};

export default Integration;
