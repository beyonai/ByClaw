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
  Radio,
  Select,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import {
  ClockCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RightOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import {
  createIntegrationEnv,
  createIntegrationSuite,
  deleteIntegrationEnv,
  deleteIntegrationSuite,
  getIntegrationRun,
  listIntegrationEnvs,
  listIntegrationRuns,
  listIntegrationSuites,
  startIntegrationRun,
  toggleIntegrationSuite,
  updateIntegrationEnv,
  updateIntegrationSuite,
} from '@/service/devloop';
import styles from './index.module.less'; // 集成测试专用类
import parentStyles from '../index.module.less'; // 共享 chrome 类(与渠道/来源卡片共用,DRY 保留在父级)
import {
  DEFAULT_TESTER_CONFIG,
  E2E_RESULT_DIR_TREE,
  E2E_SCRIPT_SKELETON,
  E2E_STATUS_ENUM,
  E2E_STATUS_JSON,
  E2E_SUITE_CONTRACT,
  TESTER_AGENT_OPTIONS,
} from './mock';
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

const Integration: React.FC<IntegrationProps> = ({ active, projectId, repos }) => {
  const intl = useIntl();
  // 项目详情的所有固定界面文案统一从 detail 命名空间读取。
  const t = React.useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.detail.${id}` }, values),
    [intl]
  );
  const { setDetailPanel, clearDetailPanel } = React.useContext(SiderContentContext);
  // 集成测试配置(环境+用例集)内容多,沿用需求渠道配置模式:入口按钮打开右侧覆盖面板。
  const [integrationConfigOpen, setIntegrationConfigOpen] = useState(false);
  // V2:独立测试数字员工配置(谁测 / 何时测 / 失败怎么打回),静态演示态,后端就绪后接入。
  const [testerConfig, setTesterConfig] = useState<TesterConfig>(DEFAULT_TESTER_CONFIG);
  const [testerModalOpen, setTesterModalOpen] = useState(false);
  // 弹框内的草稿:确认才写回 testerConfig,取消不改。
  const [testerDraft, setTesterDraft] = useState<TesterConfig>(DEFAULT_TESTER_CONFIG);
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
    sourceType: 'git',
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

  // 套件列表变化后刷新历史(套件加载完成/执行完成后触发)。
  useEffect(() => {
    if (active) {
      loadIntegrationRuns(integrationSuiteList);
    }
  }, [active, integrationSuiteList, loadIntegrationRuns]);

  // 执行测试:选环境弹框 + 轮询。runningRunId 非空表示有一次执行在进行,轮询直到进入终态。
  const [runEnvSelectOpen, setRunEnvSelectOpen] = useState(false);
  const [runTargetSuite, setRunTargetSuite] = useState<IntegrationSuiteVo | null>(null);
  const [runSelectedEnvId, setRunSelectedEnvId] = useState<number | null>(null);
  const [runStarting, setRunStarting] = useState(false);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // 执行进入终态即停轮询;组件卸载/关闭结果弹框也清理,避免定时器泄漏。
  const TERMINAL_STATUS = React.useMemo(() => ['passed', 'failed', 'error', 'timeout'], []);

  const clearPollTimer = React.useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearPollTimer, [clearPollTimer]);

  const fetchRun = React.useCallback(
    async (runId: string) => {
      const r = (await getIntegrationRun(runId)) as IntegrationRunResult | null;
      if (r) {
        setIntegrationResult(r);
        if (TERMINAL_STATUS.includes(r.status)) {
          clearPollTimer();
          setRunningRunId(null);
          // 执行结束刷新历史列表,让本次 run 进历史。
          loadIntegrationRuns(integrationSuiteList);
        }
      }
    },
    [TERMINAL_STATUS, clearPollTimer, loadIntegrationRuns, integrationSuiteList]
  );

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
      const res = (await startIntegrationRun(runTargetSuite.suiteId, runSelectedEnvId)) as { runId: string } | null;
      const runId = res?.runId;
      if (!runId) {
        message.error(t('integration.run.startFailed'));
        return;
      }
      setRunEnvSelectOpen(false);
      setIntegrationResult(null);
      setRunningRunId(runId);
      setIntegrationResultOpen(true);
      // 立即拉一次,再定时轮询直到终态。
      fetchRun(runId);
      clearPollTimer();
      pollTimerRef.current = setInterval(() => fetchRun(runId), 2500);
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
      // 若该历史仍在执行(running),继续轮询。
      if (!TERMINAL_STATUS.includes(r.status)) {
        setRunningRunId(runId);
        clearPollTimer();
        pollTimerRef.current = setInterval(() => fetchRun(runId), 2500);
      }
    } catch (e) {
      message.info(t('integration.result.notReady'));
    }
  };

  const closeIntegrationResult = () => {
    setIntegrationResultOpen(false);
    clearPollTimer();
    setRunningRunId(null);
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

  // V2 mock:需求级集成视图。集成挂在需求(而非单任务),一个需求拆成多仓库任务,
  // 由独立测试员工定时批量跑;失败按图归因,分发回责任任务。
  const requirementIntegrationList: RequirementIntegration[] = [
    {
      reqId: 'req-pay',
      reqNo: 'REQ-2098',
      reqName: '支付流程改造',
      status: 'failed',
      round: 2,
      lastRunId: 'run-1-12-2',
      lastRunAt: '2026-07-26 17:08',
      passRate: '15/18',
      tasks: [
        { id: 't-fe', repo: 'byclaw-fe', branch: 'feat/pay-ui', phase: 'pr', coded: true },
        { id: 't-be', repo: 'byclaw-be', branch: 'feat/pay-api', phase: 'pr', coded: true },
        { id: 't-mw', repo: 'byclaw-middleware', branch: 'feat/pay-mq', phase: 'pr', coded: true },
      ],
      kickbackTasks: [{ repo: 'byclaw-be', branch: 'feat/pay-api', reason: '跨模块调用鉴权头丢失,登录用例 3 条失败' }],
    },
    {
      reqId: 'req-order',
      reqNo: 'REQ-2101',
      reqName: '订单中心重构',
      status: 'waiting_ready',
      round: 0,
      lastRunId: '',
      lastRunAt: '',
      passRate: '',
      tasks: [
        { id: 't2-fe', repo: 'byclaw-fe', branch: 'feat/order-ui', phase: 'pr', coded: true },
        { id: 't2-be', repo: 'byclaw-be', branch: 'feat/order-api', phase: 'coder', coded: false },
      ],
      kickbackTasks: [],
    },
    {
      reqId: 'req-report',
      reqNo: 'REQ-2087',
      reqName: '经营报表导出',
      status: 'passed',
      round: 3,
      lastRunId: 'run-1-12-3',
      lastRunAt: '2026-07-27 09:41',
      passRate: '18/18',
      tasks: [
        { id: 't3-fe', repo: 'byclaw-fe', branch: 'feat/report-ui', phase: 'done', coded: true },
        { id: 't3-be', repo: 'byclaw-be', branch: 'feat/report-api', phase: 'done', coded: true },
      ],
      kickbackTasks: [],
    },
  ];

  // 需求级集成状态 → 展示配色/文案 key。
  const reqIntegrationStatusMeta: Record<RequirementIntegrationStatus, { color: string; labelId: string }> = {
    waiting_ready: { color: 'default', labelId: 'reqIntegration.status.waitingReady' },
    ready: { color: 'processing', labelId: 'reqIntegration.status.ready' },
    running: { color: 'processing', labelId: 'reqIntegration.status.running' },
    failed: { color: 'error', labelId: 'reqIntegration.status.failed' },
    passed: { color: 'success', labelId: 'reqIntegration.status.passed' },
  };

  // 对标 Vibe Kanban/Nimbalyst 的「需要你处理 vs 还在工作中」二态模型:按状态分泳道,failed 置顶醒目。
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

  // 当前绑定的独立测试员工(找不到时兜底第一个,保证卡片有内容)。
  const boundTesterAgent =
    TESTER_AGENT_OPTIONS.find((agent) => agent.agentId === testerConfig.agentId) ?? TESTER_AGENT_OPTIONS[0];

  const openTesterModal = () => {
    setTesterDraft(testerConfig);
    setTesterModalOpen(true);
  };

  const handleSaveTester = () => {
    setTesterConfig(testerDraft);
    setTesterModalOpen(false);
  };

  const renderReqIntegrationCard = (req: RequirementIntegration) => {
    const statusMeta = reqIntegrationStatusMeta[req.status];
    const codedCount = req.tasks.filter((task) => task.coded).length;
    const isReady = req.status !== 'waiting_ready';
    return (
      <div className={styles.reqIntegrationCard} key={req.reqId}>
        <div className={styles.reqIntegrationHead}>
          <div className={styles.reqIntegrationTitle}>
            <span className={styles.reqIntegrationNo}>{req.reqNo}</span>
            <strong>{req.reqName}</strong>
          </div>
          <Tag color={statusMeta.color}>{t(statusMeta.labelId)}</Tag>
        </div>

        {/* 需求→多任务→多仓库:每个任务一枚芯片,标出仓库/分支与是否已 coded(就绪判定的最小条件)。 */}
        <div className={styles.reqIntegrationTasks}>
          {req.tasks.map((task) => (
            <span
              key={task.id}
              className={`${styles.reqIntegrationTaskChip} ${
                task.coded ? styles.reqIntegrationTaskChipReady : styles.reqIntegrationTaskChipPending
              }`}
            >
              <span className={styles.reqIntegrationTaskDot}>{task.coded ? '✓' : '…'}</span>
              {task.repo}
              <span className={styles.reqIntegrationTaskBranch}>{task.branch}</span>
            </span>
          ))}
        </div>

        <div className={styles.reqIntegrationMeta}>
          <span className={styles.reqIntegrationReady}>
            {t('reqIntegration.readyOf', { coded: codedCount, total: req.tasks.length })}
          </span>
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
                {t('reqIntegration.kickback', { repo: kb.repo, branch: kb.branch })}
                {kb.reason ? ` · ${kb.reason}` : ''}
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
      sourceType: 'git',
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
      sourceType: suite.sourceType ?? 'git',
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
    const isGit = f.sourceType === 'git';
    const payload = {
      suiteName: f.name,
      runner: f.runner,
      sourceType: f.sourceType,
      // git 来源权威关联 repoId;shared 无仓库,置空。
      repoId: isGit ? f.repoId : undefined,
      source: f.source,
      branch: isGit ? f.branch : '',
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

  const handleToggleIntegrationConfig = () => {
    if (integrationConfigOpen) {
      handleCloseIntegrationConfig();
      return;
    }
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

  // 左侧集成测试概览:入口按钮(打开右侧配置面板) + 闭环流程条 + 历次结果。内容多的配置移到右侧,避免左栏挤压。
  const renderIntegration = () => (
    <div className={styles.integrationPanel}>
      <button type="button" className={parentStyles.detailChannelEntry} onClick={handleToggleIntegrationConfig}>
        <FundProjectionScreenOutlined className={parentStyles.detailChannelEntryIcon} />
        <span>
          <strong>{t('integration.configEntry')}</strong>
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

      {/* V2:需求级集成视图。集成挂在需求(而非单任务),展示需求下多仓库任务的就绪度、上次结果与失败分发。 */}
      <div className={styles.integrationSection}>
        <div className={styles.integrationSectionHeader}>
          <span className={styles.integrationSectionTitle}>{t('reqIntegration.title')}</span>
        </div>
        {/* 对标 Vibe Kanban/Nimbalyst:按状态分泳道,「需要处理」置顶,便于一眼看出该处理谁。 */}
        {reqIntegrationGroups.map((group) => (
          <div className={styles.reqIntegrationGroup} key={group.key}>
            <div className={`${styles.reqIntegrationGroupHead} ${styles[`reqIntegrationGroup_${group.key}`]}`}>
              <span className={styles.reqIntegrationGroupDot} />
              <span className={styles.reqIntegrationGroupTitle}>{t(group.labelId)}</span>
              <span className={styles.reqIntegrationGroupCount}>{group.items.length}</span>
            </div>
            <div className={styles.reqIntegrationList}>{group.items.map(renderReqIntegrationCard)}</div>
          </div>
        ))}
        <div className={styles.integrationFlowKickback}>{t('reqIntegration.kickbackHint')}</div>
      </div>

      <div className={styles.integrationSection}>
        <div className={styles.integrationSectionHeader}>
          <span className={styles.integrationSectionTitle}>{t('integration.history.title')}</span>
        </div>
        <List
          size="small"
          bordered
          className={styles.integrationHistoryList}
          dataSource={integrationHistoryList}
          locale={{ emptyText: t('integration.history.empty') }}
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
                    {t('integration.history.viewResult')}
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
      </div>

      <div className={styles.integrationNote}>{t('integration.note')}</div>
    </div>
  );
  // 右侧集成测试配置面板:环境信息 + 测试用例集,空间充足可容纳复杂配置。
  const renderIntegrationConfigPanel = () => {
    return (
      <div className={parentStyles.detailChannelPanel}>
        <div className={parentStyles.detailChannelPanelHeader}>
          <div className={parentStyles.detailChannelPanelTitle}>
            <h3>{t('integration.configEntry')}</h3>
            <p>{t('integration.configSubtitle')}</p>
          </div>
          <div className={parentStyles.detailChannelPanelActions}>
            <Tooltip title={t('common.close')} placement="top">
              <Button icon={<CloseOutlined />} onClick={handleCloseIntegrationConfig} />
            </Tooltip>
          </div>
        </div>
        <div className={parentStyles.detailChannelPanelBody}>
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
                      <strong>{boundTesterAgent?.name ?? t('tester.noAgent')}</strong>
                      <span>{(boundTesterAgent?.skills ?? []).join(' / ')}</span>
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
                        {testerConfig.kickback.autoAttribute ? t('tester.kickbackAuto') : t('tester.kickbackManual')}
                        {testerConfig.kickback.createDefectWhenUnclear ? ` · ${t('tester.kickbackDefect')}` : ''}
                        {' · '}
                        {t('tester.maxRounds', { count: testerConfig.kickback.maxRounds })}
                      </span>
                    </div>
                    <div className={styles.testerNote}>{t('tester.cardNote')}</div>
                  </div>
                  <div className={styles.integrationCardActions}>
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
                        <span className={styles.integrationFieldLabel}>{t('integration.envModal.connProtocol')}</span>
                        <span className={styles.integrationFieldValue}>
                          {env.connProtocol === 'local'
                            ? t('integration.envModal.connLocal')
                            : `${env.connUser || ''}@${env.connHost || ''}${env.connPort ? `:${env.connPort}` : ''}`}
                        </span>
                      </div>
                      <div className={styles.integrationField}>
                        <span className={styles.integrationFieldLabel}>{t('integration.envModal.tabAccounts')}</span>
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
                      <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openEnvModal(env, true)}>
                        {t('common.view')}
                      </Button>
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEnvModal(env, false)}>
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
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={openCreateSuiteModal}
                >
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
                            <span className={styles.integrationFieldLabel}>{t('integration.suite.manualCases')}</span>
                            <span className={styles.integrationFieldValue}>
                              {t('integration.suite.caseCount', { count: suite.caseCount ?? 0 })}
                              {' · '}
                              {t('integration.suite.manualHint')}
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className={styles.integrationField}>
                              <span className={styles.integrationFieldLabel}>{t('integration.suite.sourceType')}</span>
                              <span className={styles.integrationFieldValue}>
                                {t(
                                  suite.sourceType === 'git'
                                    ? 'integration.suite.sourceGit'
                                    : 'integration.suite.sourceShared'
                                )}
                                {' · '}
                                {t('integration.suite.caseCount', { count: suite.caseCount ?? 0 })}
                              </span>
                            </div>
                            <div className={styles.integrationField}>
                              <span className={styles.integrationFieldLabel}>{t('integration.suite.runCommand')}</span>
                              <span className={`${styles.integrationFieldValue} ${styles.integrationMono}`}>
                                {suite.runCommand}
                              </span>
                            </div>
                            <div className={styles.integrationField}>
                              <span className={styles.integrationFieldLabel}>{t('integration.suite.reportPath')}</span>
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
    setDetailPanel,
    t,
    testerConfig,
    integrationEnvList,
    editingEnvId,
    integrationSuiteList,
    editingSuiteId,
    repos,
    runningRunId,
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
  // 新增测试用例集弹框:选运行器 + 来源 + 运行命令 + 报告路径(静态演示,暂不落库)。
  // 单套件契约:用例集作者只需知道自己那份产物往哪写、退出码怎么判,不管整轮状态机。
  const renderIntegrationSuiteSpec = () => (
    <Collapse
      size="small"
      className={styles.integrationSpec}
      items={[
        {
          key: 'suite-spec',
          label: t('integration.suiteSpec.title'),
          children: (
            <div className={styles.integrationSpecBody}>
              <div className={styles.integrationSpecHint}>{t('integration.suiteSpec.intro')}</div>
              <pre className={styles.integrationSpecPre}>{E2E_SUITE_CONTRACT}</pre>
            </div>
          ),
        },
      ]}
    />
  );

  // 整轮契约(run 级):编排层/环境负责建目录、写 meta、汇总各套件结果、原子写 status.json 并驱动状态机。
  const renderIntegrationRunSpec = () => (
    <Collapse
      size="small"
      defaultActiveKey={['run-spec']}
      className={styles.integrationSpec}
      items={[
        {
          key: 'run-spec',
          label: t('integration.spec.title'),
          children: (
            <div className={styles.integrationSpecBody}>
              <div className={styles.integrationSpecHint}>{t('integration.spec.intro')}</div>

              <div className={styles.integrationSpecSubTitle}>{t('integration.spec.treeTitle')}</div>
              <pre className={styles.integrationSpecPre}>{E2E_RESULT_DIR_TREE}</pre>

              <div className={styles.integrationSpecSubTitle}>{t('integration.spec.statusTitle')}</div>
              <pre className={styles.integrationSpecPre}>{E2E_STATUS_JSON}</pre>

              <div className={styles.integrationSpecSubTitle}>{t('integration.spec.enumTitle')}</div>
              <div className={styles.integrationSpecEnum}>
                {E2E_STATUS_ENUM.map((item) => (
                  <div className={styles.integrationSpecEnumRow} key={item.code}>
                    <Tag className={styles.integrationMono}>{item.code}</Tag>
                    <span>{item.meaning}</span>
                  </div>
                ))}
              </div>

              <div className={styles.integrationSpecSubTitle}>{t('integration.spec.scriptTitle')}</div>
              <pre className={styles.integrationSpecPre}>{E2E_SCRIPT_SKELETON}</pre>
            </div>
          ),
        },
      ]}
    />
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
                <Select
                  value={integrationSuiteForm.sourceType}
                  onChange={(v) => setField('sourceType', v)}
                  options={[
                    { value: 'git', label: t('integration.suite.sourceGit') },
                    { value: 'shared', label: t('integration.suite.sourceShared') },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </div>
          {!isManual && (
            <>
              {integrationSuiteForm.sourceType === 'git' ? (
                // git 来源复用项目「关联仓库」列表:source 存仓库 URL(与渠道一致),选中即带出默认分支。
                <div className={parentStyles.formField}>
                  <label>{t('integration.suiteModal.gitUrl')}</label>
                  <Select
                    placeholder={t('source.placeholder.repository')}
                    value={integrationSuiteForm.repoId}
                    onChange={(repoId) => {
                      const repo = repos.find((r) => r.repoId === repoId);
                      setIntegrationSuiteForm((prev) => ({
                        ...prev,
                        repoId,
                        // source 冗余仓库 URL 供展示/克隆;权威关联走 repoId。
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
                <div className={parentStyles.formField}>
                  <label>{t('integration.suiteModal.sharedPath')}</label>
                  <Input
                    placeholder="/by/testcases/smoke/"
                    value={integrationSuiteForm.source}
                    onChange={(e) => setField('source', e.target.value)}
                  />
                </div>
              )}
              {integrationSuiteForm.sourceType === 'git' && (
                <div className={parentStyles.formField}>
                  <label>{t('integration.suiteModal.branch')}</label>
                  <Input
                    placeholder="main"
                    value={integrationSuiteForm.branch}
                    onChange={(e) => setField('branch', e.target.value)}
                  />
                </div>
              )}
              <div className={parentStyles.formField}>
                <label>{t('integration.suiteModal.workdir')}</label>
                <Input
                  placeholder="."
                  value={integrationSuiteForm.workdir}
                  onChange={(e) => setField('workdir', e.target.value)}
                />
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
                                    : 'integration.envModal.connCredentialPlaceholder',
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
                                  : 'integration.envModal.accCredentialPlaceholder',
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
              {
                key: 'spec',
                label: t('integration.envModal.tabSpec'),
                children: renderIntegrationRunSpec(),
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
              <span className={styles.integrationMono}>{s.reportPath}</span>
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

  // 独立测试员工配置弹框:绑定员工 + 定时 + 就绪准入 + 打回策略(静态演示,确认只写本地状态)。
  const renderTesterModal = () => (
    <Modal
      title={t('tester.modalTitle')}
      open={testerModalOpen}
      onCancel={() => setTesterModalOpen(false)}
      onOk={handleSaveTester}
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
        <Select
          value={testerDraft.agentId}
          onChange={(agentId) => setTesterDraft((prev) => ({ ...prev, agentId }))}
          style={{ width: '100%' }}
          options={TESTER_AGENT_OPTIONS.map((agent) => ({
            value: agent.agentId,
            label: `${agent.name} · ${agent.skills.join(' / ')}`,
          }))}
        />
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
      <div className={styles.integrationNote}>{t('integration.run.hint')}</div>
    </Modal>
  );

  return (
    <>
      {active ? renderIntegration() : null}
      {renderIntegrationEnvModal()}
      {renderIntegrationSuiteModal()}
      {renderRunEnvSelectModal()}
      {renderIntegrationResultModal()}
      {renderManualRunModal()}
      {renderTesterModal()}
    </>
  );
};

export default Integration;
