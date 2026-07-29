import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Collapse,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Upload,
  message,
  type MenuProps,
} from 'antd';
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  DingdingOutlined,
  EditOutlined,
  EllipsisOutlined,
  EyeOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  GithubOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useDispatch, useIntl, useNavigate, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import {
  checkDwsAuthStatus,
  checkDwsAuthStatusBySource,
  checkGitHubPat,
  createManualRequirement,
  createProjectRepo,
  createScanSource,
  createTask,
  deleteManualRequirement,
  deleteProjectRepo,
  deleteScanSource,
  getProject,
  listProjectSpaceFiles,
  listProjectSessionsByQo,
  listProjectMembers,
  getTaskChanges,
  getTaskFileDiff,
  listRequirementsByProject,
  listScanLogs,
  listScanSources,
  listTasks,
  saveGitHubPat,
  saveProjectFileToSpace,
  searchDingtalkGroups,
  startDwsDeviceAuth,
  toggleScanSource,
  triggerScan,
  updateManualRequirement,
  updateScanSource,
  type DevloopProjectSpaceFile,
  type DevloopTaskChanges,
  type DevloopTaskFileDiff,
} from '@/service/devloop';
import { deleteFiles, listFiles, renameFile, type FileBrowserItem } from '@/service/fileBrowser';
import SessionOverviewDrawer from './SessionOverviewDrawer';
import TaskDetailDrawer from './TaskDetailDrawer';
import { isCurrentUserTaskAssignee } from './taskAccess';
import { getTaskDateRangePresets, type TaskDateRange } from './taskDatePresets';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import { getArrayData, normalizeProjectSession } from '@/pages/projectSpace/utils';
import AntdIcon from '@/components/AntdIcon';
import ChatAvatar from '@/components/ChatAvatar';
import RenameModal from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import useFilePreviewActions from '@/layout/sider/components/FileSiderPanel/hooks/useFilePreviewActions';
import fileSiderStyles from '@/layout/sider/components/FileSiderPanel/index.module.less';
import {
  SESSION_FILE_PATH,
  SHARED_FILE_PATH,
  type FileTreeItem,
} from '@/layout/sider/components/FileSiderPanel/constants';
import {
  canPreviewFile,
  ensureDirectoryPath,
  getFileType,
  getParentDirectoryPath,
  getSessionFilePath,
  isDirectory,
  isPathIn,
  normalizeFileBrowserPath,
  normalizeReferenceItem,
  sortFileBrowserItems,
  unwrapListResponse,
} from '@/layout/sider/components/FileSiderPanel/utils';
import { downloadFile as downloadUrlFile, getFileUrl } from '@/utils/file';
import { sessionHandler } from '@/utils/session';
import type { ISession } from '@/typescript/session';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import ProjectMemberList from './ProjectMemberList';
import ListEndMessage from './ListEndMessage';
import styles from './index.module.less';

type SourceType = 'dingtalk' | 'dingtalk_todo' | 'github_issue';

type ScanSourceItem = {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  config?: string;
  cronExpr?: string;
  enabled?: string;
  repoId?: number | null;
  confirmMode?: string;
  scoreThreshold?: number | null;
  lastScanTime?: string | null;
  // 创建者:用于授权/编辑/删除的创建者权限控制。
  createBy?: string | null;
  createByName?: string | null;
};

// 按源的 DWS 授权状态(查该源创建者的授权)。
type SourceDwsStatus = {
  tokenValid?: boolean;
  hasToken?: boolean;
  expiresAt?: string;
  canAuthorize?: boolean;
  creatorName?: string;
};

// 集成测试脚本型适配器的单个生命周期阶段:每阶段一段完整可执行脚本。
type IntegrationStage = {
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
type TestAccount = {
  id: string;
  role: string; // 角色说明,如 管理员 / 普通用户 / 审批人
  envPrefix: string; // 环境变量前缀,如 E2E_ADMIN
  username: string;
  credentialRef: string; // 密码凭据 key,指向 ~/.openclaw/credentials/,不存明文
};

// 手动测试用例:无法自动化的场景由人工按步骤执行、逐条记录结果。
type ManualCase = {
  id: string;
  title: string;
  steps: string; // 操作步骤(多行)
  expected: string; // 预期结果
};

// 端到端测试用例集:自动化套件是独立工程(pytest/playwright/jest…),按运行命令执行、按报告路径收结果;
// manual 套件是人工检查清单,由测试人执行并逐条记录,平台把记录汇总成与自动化一致的套件结果。
type TestSuite = {
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
  // 仅 manual 套件:人工检查清单。
  manualCases?: ManualCase[];
};

// 一次 E2E 运行的结果详情:对应 status.json + 各套件 JUnit + artifacts,供"查看结果"页展示。
type IntegrationRunSuiteResult = {
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

type IntegrationRunResult = {
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

// 端到端测试"结果目录与状态"契约:展示给写脚本的人看,平台按此约定读状态,脚本按此约定写状态。
// 平台通过环境变量把本次运行的结果根目录注入构建机/用例工程,脚本产物必须落在该目录下的约定结构里。
const E2E_RESULT_DIR_TREE = `$BYCLAW_E2E_RESULT_DIR/        # 平台注入的本次运行结果根目录(分支+轮次唯一)
├── status.json      # 状态真相源:状态机 + 心跳 + 汇总(最后原子写入)
├── meta.json        # 不变信息:分支/commit/环境/触发时间/轮次(平台预写)
├── reports/         # 各用例集产出的 JUnit XML(明细,判断哪条用例挂了)
│   └── <suiteId>.xml
├── logs/            # 拉码/构建/部署/各套件运行日志
│   └── <suiteId>.log
└── artifacts/       # 失败证据(E2E 必备:截图/录屏/trace)
    └── <suiteId>/           # 按套件分目录,避免多套件文件重名打架
        ├── <caseId>.png     # 截图:文件名 = 用例ID,平台按名挂到失败用例
        ├── <caseId>.webm    # 录屏(可选)
        └── <caseId>.zip     # Playwright trace(可选)`;

const E2E_STATUS_JSON = `{
  "schemaVersion": 1,
  "status": "running",          // 见下方状态枚举(封闭取值)
  "startedAt":  "2026-07-27T09:30:00+08:00",
  "updatedAt":  "2026-07-27T09:41:12+08:00",  // 心跳:运行中定期刷新,用于判活
  "finishedAt": null,           // 仅终态非空
  "totals": { "total": 18, "passed": 15, "failed": 3, "skipped": 0 },
  "suites": [
    { "id": "suite-api", "status": "passed",  "report": "reports/suite-api.xml" },
    { "id": "suite-web", "status": "failed",  "report": "reports/suite-web.xml",
      "failedCases": [                        // 编排层解析 XML+artifacts 后回填,失败用例带截图
        { "case": "test_login", "artifacts": ["artifacts/suite-web/test_login.png"] }
      ] }
  ],
  "reason": "登录用例 3 条失败:跨模块调用鉴权头丢失"  // 打回原因,非失败可为空
}`;

const E2E_SCRIPT_SKELETON = `#!/usr/bin/env bash
set -euo pipefail
DIR="$BYCLAW_E2E_RESULT_DIR"
mkdir -p "$DIR/reports" "$DIR/logs" "$DIR/artifacts"

# 原子写状态:先写临时文件再 rename,读者永远读不到半截 JSON
write_status() { echo "$1" > "$DIR/status.json.tmp" && mv "$DIR/status.json.tmp" "$DIR/status.json"; }

write_status '{"schemaVersion":1,"status":"running","startedAt":"'"$(date -Is)"'"}'

# 业务测试账号由编排层按「环境」里配的账号注入成环境变量,用例直接读,不落明文:
#   登录 "$E2E_ADMIN_USER" / "$E2E_ADMIN_PASS"   (前缀 = 环境配置里的 envPrefix)

# 运行用例集,产出 JUnit XML 到 reports/;运行中可周期性刷新 updatedAt 作为心跳
if pytest -q --junitxml="$DIR/reports/suite-api.xml" | tee "$DIR/logs/suite-api.log"; then
  write_status '{"schemaVersion":1,"status":"passed","finishedAt":"'"$(date -Is)"'"}'
else
  # 用例失败 -> failed(打回 coder);若是构建/环境错误未跑到用例 -> error
  write_status '{"schemaVersion":1,"status":"failed","finishedAt":"'"$(date -Is)"'","reason":"用例失败"}'
fi`;

// 单套件契约:用例集作者只需保证自己这份产物的落点与退出码,整轮 status.json 由编排层汇总。
const E2E_SUITE_CONTRACT = `# 用例集作者只需保证四件事,整轮状态由编排层汇总,无需自己写 status.json:

# 1) JUnit XML 报告(平台读它汇总通过率,判断哪条用例挂了)
#    产到运行命令里指定的报告路径,平台会收集到 $BYCLAW_E2E_RESULT_DIR/reports/<suiteId>.xml
pytest -q --junitxml=report/junit.xml

# 2) 退出码语义(平台据此判定本套件成败)
#    0     = 全部通过
#    非 0  = 有失败 / 运行错误

# 3) 标准输出即日志,平台收集到 $BYCLAW_E2E_RESULT_DIR/logs/<suiteId>.log

# 4) 失败证据(E2E 建议对失败用例必留截图):放当前工程约定目录,平台归集到 artifacts/<suiteId>/
#    命名 = 用例ID(如 test_login.png),平台按文件名把截图挂到 JUnit 里对应的失败用例。
#    - Playwright: use: { screenshot:'only-on-failure', video:'retain-on-failure', trace:'retain-on-failure' }
#    - pytest+selenium: 失败钩子里 driver.save_screenshot(f"artifacts/{case_id}.png")
#    (进阶)也可在 JUnit 用 [[ATTACHMENT|artifacts/<suiteId>/<caseId>.png]] 显式声明附件路径`;

// status.json 的 status 封闭枚举:平台据此判断"没开始/准备中/测试中/通过/失败/错误/超时/取消"。
const E2E_STATUS_ENUM: Array<{ code: string; meaning: string }> = [
  { code: 'pending', meaning: '未开始(或 status.json 尚不存在)' },
  { code: 'preparing', meaning: '准备中:拉码 / 构建镜像 / 部署' },
  { code: 'running', meaning: '测试进行中(finishedAt 为 null;心跳超时未刷新则判为崩溃)' },
  { code: 'passed', meaning: '全部通过 → 进入「提交 PR」' },
  { code: 'failed', meaning: '有用例失败 → 打回「编码」环节' },
  { code: 'error', meaning: '构建/部署/环境错误,未跑到用例 → 打回编码或运维介入' },
  { code: 'timeout', meaning: '超过最大时长被终止' },
  { code: 'cancelled', meaning: '人工取消' },
];

type RepoOption = {
  repoId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
};

type ScanLogEntry = {
  logId: number;
  scanTime: string;
  foundCount: number;
  createdCount: number;
  status: string;
  errorMsg?: string;
};

type RequirementItem = {
  itemId: number;
  title: string;
  originId?: string;
  originUrl?: string;
  action?: string;
  createTime?: string;
  sourceType?: string;
  sourceName?: string;
  sessionId?: number;
  originalContent?: string;
  productContent?: string;
  content?: string;
  description?: string;
  summary?: string;
  score?: number | null;
  priority?: string | null;
  scoreDetail?: string | null;
  // 手工需求的业务来源；sourceType 仍表示后端内部的 manual 扫描来源。
  manualSourceType?: string;
  // 用户填写的影响分支上下文，不等同任务创建后生成的工作分支。
  branch?: string;
  // 手工需求指定的研发仓库，优先于项目默认仓库用于启动研发任务。
  repoId?: number | null;
};

type TaskQueryState = {
  pageNum: number;
  pageSize: number;
  dateRange: TaskDateRange;
  taskName: string;
};

type TaskFetchOptions = Partial<TaskQueryState> & {
  append?: boolean;
};

// AI 评分明细：与后端 score_detail JSON 字段、满分口径对齐
type ScoreDetail = {
  businessValue?: number;
  userImpact?: number;
  urgency?: number;
  strategyFit?: number;
  feasibility?: number;
  reuseValue?: number;
  risk?: number;
  summary?: string;
};

type ProjectDetailTranslate = (id: string, values?: Record<string, string | number>) => string;

// 详情面板的静态元数据仅保存语言键，切换语言时不会再依赖中文常量。
const SCORE_DIMENSIONS: { key: keyof ScoreDetail; labelId: string; max: number }[] = [
  { key: 'businessValue', labelId: 'requirement.score.businessValue', max: 30 },
  { key: 'userImpact', labelId: 'requirement.score.userImpact', max: 20 },
  { key: 'urgency', labelId: 'requirement.score.urgency', max: 15 },
  { key: 'strategyFit', labelId: 'requirement.score.strategyFit', max: 15 },
  { key: 'feasibility', labelId: 'requirement.score.feasibility', max: 10 },
  { key: 'reuseValue', labelId: 'requirement.score.reuseValue', max: 10 },
];

const getTaskStatusMeta = (status?: string) => {
  // 任务列表与任务视图共用状态口径，同时兼容后端返回的中英文枚举值。
  const normalizedStatus = `${status || ''}`.trim().toLowerCase();
  if (['完成', '已完成', 'done', 'completed'].includes(normalizedStatus)) {
    return { labelId: 'task.status.completed', className: 'Done' };
  }
  if (['进行中', 'doing', 'running', 'in_progress'].includes(normalizedStatus)) {
    return { labelId: 'task.status.inProgress', className: 'Running' };
  }
  if (['暂停', 'paused', 'pause'].includes(normalizedStatus)) {
    return { labelId: 'task.status.paused', className: 'Paused' };
  }
  return { labelId: 'task.status.pending', className: 'Pending' };
};

const parseScoreDetail = (raw?: string | null): ScoreDetail => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

type SourceForm = {
  type: SourceType;
  name: string;
  chatId: string;
  chatName: string;
  keywords: string;
  lookbackHours: string;
  labels: string;
  pat: string;
  cron: string;
  repoId?: number;
  confirmMode: string;
  scoreThreshold: number;
  // 钉钉待办:优先级过滤(多选,值为 10/20/30/40),空=全部优先级。
  todoPriority: string[];
};

type ManualRequirementSourceType = 'manual' | 'customer_feedback' | 'internal_proposal';

type ManualRequirementForm = {
  sourceType: ManualRequirementSourceType;
  branch: string;
  repoId?: number;
  title: string;
  originalContent: string;
  productContent: string;
};

type ResourceFileScope = 'current' | 'all';
type ProjectResourceSession = NonNullable<ProjectSpace['sessions']>[number];
type ProjectSpaceFileItem = FileBrowserItem &
  DevloopProjectSpaceFile & {
    isProjectSpaceFile: true;
  };
type ProjectSpaceFileTreeItem = FileTreeItem & ProjectSpaceFileItem;

type Props = {
  project?: ProjectSpace;
  onBack: () => void;
  onEditProject?: (project: ProjectSpace) => void;
  onDeleteProject?: (project: ProjectSpace) => void;
  onProjectSharedChange?: (projectId: string | number) => void;
  onCurrentUserRemoved?: (projectId: number) => void;
  developProjectEnabled?: boolean;
};

const REQUIREMENT_PAGE_SIZE = 20;
// 任务列表固定页大小，取消分页器后按此值触底追加。
const TASK_PAGE_SIZE = 20;
// 后端尚未限制手工需求的两个长文本字段，前端统一限制为 1000 字，避免无界内容写入任务提示词。
const MANUAL_REQUIREMENT_CONTENT_MAX_LENGTH = 1000;

// GitHub 文件变更状态 -> 角标字母/配色,沿用常见 git 管理视觉:新增绿/修改黄/删除红/重命名蓝。
const FILE_CHANGE_META: Record<string, { letter: string; labelId: string; className: string }> = {
  added: { letter: 'A', labelId: 'codeChanges.status.added', className: 'fileChangeAdded' },
  modified: { letter: 'M', labelId: 'codeChanges.status.modified', className: 'fileChangeModified' },
  changed: { letter: 'M', labelId: 'codeChanges.status.modified', className: 'fileChangeModified' },
  removed: { letter: 'D', labelId: 'codeChanges.status.removed', className: 'fileChangeRemoved' },
  renamed: { letter: 'R', labelId: 'codeChanges.status.renamed', className: 'fileChangeRenamed' },
  copied: { letter: 'C', labelId: 'codeChanges.status.copied', className: 'fileChangeRenamed' },
};

const getFileChangeMeta = (status?: string) =>
  FILE_CHANGE_META[(status || 'modified').toLowerCase()] || FILE_CHANGE_META.modified;

// 从完整路径拆出文件名与所在目录,分别加粗/弱化展示。
const splitFilePath = (path: string) => {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? { name: path.slice(idx + 1), dir: path.slice(0, idx) } : { name: path, dir: '' };
};

// unified diff 行类型:git diff 输出按行首字符分类,供 modal 逐行着色(参考 git 客户端)。
type DiffLineType = 'meta' | 'hunk' | 'add' | 'del' | 'context';

const classifyDiffLine = (line: string): DiffLineType => {
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
    return 'meta';
  }
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'context';
};

// 把 unified diff 文本解析为带类型的行数组;meta/无内容行过滤掉文件头噪音只留必要信息。
const parseDiffLines = (diff?: string | null): { type: DiffLineType; text: string }[] => {
  if (!diff) return [];
  return diff.split('\n').map((text) => ({ type: classifyDiffLine(text), text }));
};

const cronPresets = [
  { value: '*/1 * * * *', labelId: 'source.cron.everyOneMinute' },
  { value: '*/5 * * * *', labelId: 'source.cron.everyFiveMinutes' },
  { value: '*/15 * * * *', labelId: 'source.cron.everyFifteenMinutes' },
  { value: '*/30 * * * *', labelId: 'source.cron.everyThirtyMinutes' },
  { value: '0 */1 * * *', labelId: 'source.cron.everyOneHour' },
  { value: '0 */2 * * *', labelId: 'source.cron.everyTwoHours' },
  { value: '0 9,14,18 * * 1-5', labelId: 'source.cron.weekdaySchedule' },
];

const getCronDisplayText = (cronExpr: string | undefined, t: ProjectDetailTranslate) => {
  // 渠道卡片展示用户可读的扫描频率，避免直接暴露 cron 表达式。
  if (!cronExpr) return t('source.cron.manual');
  const matchedPreset = cronPresets.find((preset) => preset.value === cronExpr);
  if (matchedPreset) return t('source.cron.scanAt', { frequency: t(matchedPreset.labelId) });

  const minuteMatch = cronExpr.match(/^\*\/(\d+) \* \* \* \*$/);
  if (minuteMatch) return t('source.cron.everyMinutesScan', { minutes: minuteMatch[1] });

  const hourMatch = cronExpr.match(/^0 \*\/(\d+) \* \* \*$/);
  if (hourMatch) return t('source.cron.everyHoursScan', { hours: hourMatch[1] });

  return cronExpr;
};

const getDefaultSourceForm = (): SourceForm => ({
  type: 'github_issue',
  name: '',
  chatId: '',
  chatName: '',
  keywords: '',
  lookbackHours: '24',
  labels: '',
  pat: '',
  cron: '*/30 * * * *',
  repoId: undefined,
  confirmMode: 'manual',
  scoreThreshold: 70,
  todoPriority: [],
});

// 每次打开弹窗都创建新表单，避免取消或提交过的内容残留到下一次录入。
// 分支字段仅是需求上下文，真正的任务分支由后端启动任务时生成。
const getDefaultManualRequirementForm = (): ManualRequirementForm => ({
  sourceType: 'manual',
  branch: 'develop',
  repoId: undefined,
  title: '',
  originalContent: '',
  productContent: '',
});

// 后端只为可解析的手工需求 JSON 回填 manualSourceType，据此排除内部来源中的历史或异常扫描条目。
const isManualRequirement = (requirement: RequirementItem) => Boolean(requirement.manualSourceType);

// 后端仅接受固定来源枚举，历史数据缺少业务来源时按“人工录入”回填。
const getManualRequirementSourceType = (sourceType?: string): ManualRequirementSourceType => {
  if (sourceType === 'customer_feedback' || sourceType === 'internal_proposal') return sourceType;
  return 'manual';
};

const formatConfig = (type: string, config: string | undefined, t: ProjectDetailTranslate) => {
  try {
    const parsedConfig = JSON.parse(config || '{}');
    if (type === 'dingtalk') return parsedConfig.chatName || parsedConfig.chatId || parsedConfig.groupId || '-';
    if (type === 'dingtalk_todo') {
      return parsedConfig.keyword
        ? t('source.config.keyword', { keyword: parsedConfig.keyword })
        : t('source.type.dingtalkTodo');
    }
    if (type === 'github_issue') {
      return parsedConfig.labels
        ? t('source.config.labels', { labels: parsedConfig.labels })
        : t('source.config.allIssues');
    }
    return '-';
  } catch {
    return '-';
  }
};

const getSourceIcon = (sourceType: string) => {
  if (sourceType === 'dingtalk' || sourceType === 'dingtalk_todo') return <DingdingOutlined />;
  return <GithubOutlined />;
};

const getSourceLabel = (sourceType: string | undefined, t: ProjectDetailTranslate) => {
  if (sourceType === 'dingtalk') return t('source.type.dingtalk');
  if (sourceType === 'dingtalk_todo') return t('source.type.dingtalkTodo');
  if (sourceType === 'github_issue') return t('source.type.githubIssues');
  if (sourceType === 'manual') return t('manualRequirement.source.manual');
  if (sourceType === 'customer_feedback') return t('manualRequirement.source.customerFeedback');
  if (sourceType === 'internal_proposal') return t('manualRequirement.source.internalProposal');
  return t('source.type.default');
};

const getSessionResourceName = (session: Partial<ProjectResourceSession>, t: ProjectDetailTranslate) =>
  session?.sessionName || t('resource.unnamedSession');

// 非研发任务视觉上等同普通会话，复用会话头像的默认图片和稳定主题色规则。
const normalizeTaskSession = (task: any, fallbackProjectId: number, t: ProjectDetailTranslate): ISession => {
  const session: ISession = {
    parentSessionId: Number(task?.parentSessionId || 0),
    sessionId: `${task?.sessionId || task?.taskId || ''}`,
    sessionName: task?.sessionName || task?.title || task?.taskName || t('task.defaultSessionName'),
    createTime: `${task?.createTime || ''}`,
    updateTime: `${task?.updateTime || task?.createTime || ''}`,
    projectId: `${task?.projectId ?? fallbackProjectId}`,
    avatar: task?.avatar,
  };
  return sessionHandler(session);
};

const normalizeProjectSpaceFile = (file: DevloopProjectSpaceFile): ProjectSpaceFileItem => ({
  ...file,
  // 项目共享文件接口返回 fileName/fileUrl，这里补齐文件树组件使用的 name/path/isDir 字段。
  name: file.fileName || '',
  path: file.fileUrl || `${SHARED_FILE_PATH}${file.fileName || ''}`,
  isDir: false,
  isProjectSpaceFile: true,
});

const isProjectSpaceFile = (item: FileTreeItem): item is ProjectSpaceFileTreeItem =>
  'isProjectSpaceFile' in item && item.isProjectSpaceFile === true;

const getRequirementDetailText = (requirement: RequirementItem, t: ProjectDetailTranslate) =>
  requirement.productContent ||
  requirement.originalContent ||
  requirement.content ||
  requirement.description ||
  requirement.summary ||
  requirement.title ||
  t('common.emptyValue');

// 资源 tab 下会话文件路径形如 /.sessions/{sessionId}/，操作后需要按会话刷新对应目录。
const getResourceSessionIdByPath = (path: string) => {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  if (!isPathIn(normalizedPath, SESSION_FILE_PATH)) return '';
  return normalizedPath.slice(SESSION_FILE_PATH.length).split('/').filter(Boolean)[0] || '';
};

const ProjectDetailPanel: React.FC<Props> = ({
  project,
  onBack,
  onEditProject,
  onDeleteProject,
  onProjectSharedChange,
  onCurrentUserRemoved,
  developProjectEnabled = false,
}) => {
  const intl = useIntl();
  // 项目详情的所有固定界面文案统一从 detail 命名空间读取。
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.detail.${id}` }, values),
    [intl]
  );
  // 任务 Tab 与整体任务视图共享快捷日期范围，保证同一选择对应相同的服务端查询条件。
  const taskDatePresets = useMemo(() => getTaskDateRangePresets((id) => intl.formatMessage({ id })), [intl]);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const { EventEmitter, sessionId: activeChatSessionId, setSessionId } = useGlobal();
  const activeSiderAgent = useActiveSiderAgent();
  const { setDetailPanel, clearDetailPanel } = React.useContext(SiderContentContext);
  const [activeTab, setActiveTab] = useState('requirements');
  const [sources, setSources] = useState<ScanSourceItem[]>([]);
  // 每个钉钉/待办源的授权状态(查各自创建者),键为 sourceId。替代旧的全局 dwsAuthed 单一状态。
  const [sourceDwsStatusMap, setSourceDwsStatusMap] = useState<Record<number, SourceDwsStatus>>({});
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [requirementSearchKeyword, setRequirementSearchKeyword] = useState('');
  const [visibleRequirementCount, setVisibleRequirementCount] = useState(REQUIREMENT_PAGE_SIZE);
  const [detailReq, setDetailReq] = useState<RequirementItem | null>(null);
  const [startingRequirementIds, setStartingRequirementIds] = useState<Set<number>>(() => new Set());
  const [tasks, setTasks] = useState<any[]>([]);
  const [hasMoreTasks, setHasMoreTasks] = useState(false);
  const [taskDateRange, setTaskDateRange] = useState<TaskDateRange>(null);
  const [taskSearchKeyword, setTaskSearchKeyword] = useState('');
  const [, setMembers] = useState<any[]>([]);
  const [resourceFileScope, setResourceFileScope] = useState<ResourceFileScope>('current');
  const [sharedFiles, setSharedFiles] = useState<FileBrowserItem[]>([]);
  const [sharedFilesLoading, setSharedFilesLoading] = useState(false);
  const [resourceSessions, setResourceSessions] = useState<ProjectResourceSession[]>([]);
  const [sessionFilesMap, setSessionFilesMap] = useState<Record<string, FileBrowserItem[]>>({});
  const [sessionFilesLoadingMap, setSessionFilesLoadingMap] = useState<Record<string, boolean>>({});
  const [resourceChildrenByPath, setResourceChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [resourceExpandedKeys, setResourceExpandedKeys] = useState<React.Key[]>([]);
  // 资源 tab 的“代码变更”卡片:按当前会话(任务)拉取远程分支相对基线的文件变更。
  const [taskChanges, setTaskChanges] = useState<DevloopTaskChanges | null>(null);
  const [taskChangesLoading, setTaskChangesLoading] = useState(false);
  // 代码变更文件 diff modal:点文件行拉取该文件 unified diff 并弹窗逐行渲染。
  const [diffModalFile, setDiffModalFile] = useState<string | null>(null);
  const [diffModalData, setDiffModalData] = useState<DevloopTaskFileDiff | null>(null);
  const [diffModalLoading, setDiffModalLoading] = useState(false);
  const [resourceRenameOpen, setResourceRenameOpen] = useState(false);
  const [resourceRenameTarget, setResourceRenameTarget] = useState<FileBrowserItem | null>(null);
  const [resourceRenameLoading, setResourceRenameLoading] = useState(false);
  const [lastLog, setLastLog] = useState<ScanLogEntry | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [requirementsLoading, setRequirementsLoading] = useState(false);
  const [requirementsRefreshLoading, setRequirementsRefreshLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  // 手动刷新、普通查询和触底分页分别展示，避免同一任务请求出现多个 loading。
  const [tasksRefreshLoading, setTasksRefreshLoading] = useState(false);
  const [tasksLoadingMore, setTasksLoadingMore] = useState(false);
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<ScanSourceItem | null>(null);
  // 非创建者查看渠道:复用编辑弹窗,字段 disabled + 隐藏确定按钮。
  const [sourceModalReadonly, setSourceModalReadonly] = useState(false);
  const [sourceForm, setSourceForm] = useState<SourceForm>(getDefaultSourceForm);
  // 新增和编辑渠道共用保存状态，统一控制确定按钮的加载反馈。
  const [sourceSaving, setSourceSaving] = useState(false);
  const [hasPatSaved, setHasPatSaved] = useState(false);
  const [groupOptions, setGroupOptions] = useState<{ value: string; label: string }[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [dwsAuthed, setDwsAuthed] = useState(false);
  const [dwsExpired, setDwsExpired] = useState(false);
  const [dwsExpiresAt, setDwsExpiresAt] = useState('');
  const [dwsAuthLoading, setDwsAuthLoading] = useState(false);
  const [dwsDeviceInfo, setDwsDeviceInfo] = useState<{ userCode: string; verificationUrl: string } | null>(null);
  const [dwsAuthPolling, setDwsAuthPolling] = useState(false);
  const [dwsAuthDetailVisible, setDwsAuthDetailVisible] = useState(false);
  const [dwsAuthDetail, setDwsAuthDetail] = useState<any>(null);
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logModalSource, setLogModalSource] = useState<ScanSourceItem | null>(null);
  const [logList, setLogList] = useState<ScanLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [channelPanelOpen, setChannelPanelOpen] = useState(false);
  // 集成测试配置(环境+用例集)内容多,沿用需求渠道配置模式:入口按钮打开右侧覆盖面板。
  const [integrationConfigOpen, setIntegrationConfigOpen] = useState(false);
  const [taskKanbanOpen, setTaskKanbanOpen] = useState(false);
  // 研发任务通过更多操作打开环节详情抽屉，不必先经整体视图。
  const [detailTask, setDetailTask] = useState<any>(null);
  // 记录任务列表最近一次点击项，详情打开或进入会话后仍保留选中反馈。
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  // 菜单展开时保持研发任务的更多操作可见，避免鼠标移入菜单后图标闪动。
  const [openTaskActionId, setOpenTaskActionId] = useState<string>();
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  // 集成测试「新增测试用例集」弹框(静态演示态)。
  const [integrationSuiteModalOpen, setIntegrationSuiteModalOpen] = useState(false);
  // 查看态:弹框复用新增表单,只读展示,不给保存按钮。
  const [integrationSuiteReadOnly, setIntegrationSuiteReadOnly] = useState(false);
  // 手动测试执行:测试人逐条记录 通过/失败/跳过 + 备注 + 截图。
  const [manualRunOpen, setManualRunOpen] = useState(false);
  const [manualRunSuite, setManualRunSuite] = useState<TestSuite | null>(null);
  const [manualRunRecords, setManualRunRecords] = useState<
    Record<string, { result: 'pass' | 'fail' | 'skip' | ''; remark: string; shots: string[] }>
  >({});
  const [integrationSuiteForm, setIntegrationSuiteForm] = useState<{
    name: string;
    runner: TestSuite['runner'];
    sourceType: TestSuite['sourceType'];
    source: string;
    branch: string;
    runCommand: string;
    workdir: string;
    reportPath: string;
    manualCases: ManualCase[];
  }>({
    name: '',
    runner: 'pytest',
    sourceType: 'git',
    source: '',
    branch: 'main',
    runCommand: 'pytest -q --junitxml=report/junit.xml',
    workdir: '.',
    reportPath: 'report/junit.xml',
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
    connCredentialRef: string;
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
    connCredentialRef: 'it-integration-ssh-key',
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
        credentialRef: 'it-integration-e2e-admin',
      },
      {
        id: 'acc-user',
        role: '普通用户',
        envPrefix: 'E2E_USER',
        username: 'qa_user01',
        credentialRef: 'it-integration-e2e-user',
      },
    ],
  });
  // 仓库弹窗被渠道、手工需求共用，创建完成后按打开来源回填对应表单。
  const [repoModalTarget, setRepoModalTarget] = useState<'source' | 'manualRequirement'>('source');
  const [repoForm, setRepoForm] = useState({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
  const [repoSaving, setRepoSaving] = useState(false);
  const [manualRequirementOpen, setManualRequirementOpen] = useState(false);
  const [manualRequirementSubmitting, setManualRequirementSubmitting] = useState(false);
  // 新增、修改共用同一表单，编辑态保存当前待修改的需求条目。
  const [editingManualRequirement, setEditingManualRequirement] = useState<RequirementItem | null>(null);
  // 更多菜单展开时维持三点按钮可见，避免移入菜单后按钮闪动。
  const [openManualRequirementActionId, setOpenManualRequirementActionId] = useState<string>();
  const [deletingManualRequirementId, setDeletingManualRequirementId] = useState<number | null>(null);
  const [manualRequirementForm, setManualRequirementForm] = useState<ManualRequirementForm>(
    getDefaultManualRequirementForm
  );
  const groupSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requirementSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwsAuthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dwsAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRequirementIdsRef = useRef<Set<number>>(new Set());
  // 新增表单只在打开时自动回填一次首个仓库，避免用户主动清空选择后又被重复选回。
  const sourceRepoDefaultedRef = useRef(false);
  const manualRequirementRepoDefaultedRef = useRef(false);
  // 状态更新前先同步加锁，避免连续点击确定按钮重复保存渠道。
  const sourceSavingRef = useRef(false);
  // 手工需求的新建和修改共用同步锁，避免 React 状态尚未刷新时重复提交。
  const manualRequirementSubmittingRef = useRef(false);
  // 删除确认弹窗返回 Promise 时会展示 loading；同步锁用于拦截重复确认。
  const deletingManualRequirementIdRef = useRef<number | null>(null);
  const resourceClickTimerRef = useRef<number | null>(null);
  const requirementQueryVersionRef = useRef(0);
  const taskQueryRef = useRef<TaskQueryState>({
    pageNum: 1,
    pageSize: TASK_PAGE_SIZE,
    dateRange: null,
    taskName: '',
  });
  const taskQueryVersionRef = useRef(0);
  const taskAppendingVersionRef = useRef<number | null>(null);
  const taskRequestCountRef = useRef(0);

  const projectId = Number(project?.projectId);
  // 删除入口只在项目创建者侧展示；服务端仍会根据项目创建者再次校验。
  const isProjectCreator = useMemo(() => {
    const currentUserId = userInfo?.userId ?? userInfo?.id;
    return (
      currentUserId !== undefined &&
      currentUserId !== null &&
      project?.createBy !== undefined &&
      project.createBy !== null &&
      `${currentUserId}` === `${project.createBy}`
    );
  }, [project?.createBy, userInfo?.id, userInfo?.userId]);
  // 项目类型来自后端/静态参数，先按字符串归一，避免默认项目枚举声明不同步时报比较类型错误。
  const projectType = project?.projectType ? String(project.projectType) : undefined;
  // 详情标题与项目列表使用同一场景标签规则，研发项目优先于共享状态展示。
  const projectScene = useMemo(() => {
    if (!project) return null;
    if (projectType === 'default') {
      return { classSuffix: 'Default', text: intl.formatMessage({ id: 'projectSpace.scene.default' }) };
    }
    if (projectType === 'develop') {
      return { classSuffix: 'Development', text: intl.formatMessage({ id: 'projectSpace.scene.development' }) };
    }
    if (project.sharedFlag) {
      return { classSuffix: 'Shared', text: intl.formatMessage({ id: 'projectSpace.scene.shared' }) };
    }
    return { classSuffix: 'Personal', text: intl.formatMessage({ id: 'projectSpace.scene.personal' }) };
  }, [intl, project, projectType]);
  // 未配置研发项目时，即使存在历史 develop 数据也不展示研发闭环能力。
  const isDevelopProject = developProjectEnabled && projectType === 'develop';
  const fileResourceId = activeSiderAgent.resourceId || (project?.resourceId ? `${project.resourceId}` : '');
  const { handlePreview: handleResourcePreview, handleDownload: handleResourceDownload } = useFilePreviewActions({
    resourceId: fileResourceId,
    EventEmitter,
    previewClassName: fileSiderStyles.previewContent,
  });
  // 需求只服务研发项目；成员管理同时服务研发项目和普通共享项目。
  const showRequirementsTab = isDevelopProject;
  const showMembersTab = isDevelopProject || !!project?.sharedFlag;
  const canEnterDetailTaskSession = useMemo(
    () => isCurrentUserTaskAssignee(detailTask, userInfo),
    [detailTask, userInfo]
  );

  const handleOpenTaskSession = useCallback(
    (task: any) => {
      if (!task?.sessionId) {
        message.warning(t('task.noSession'));
        return;
      }

      // 任务列表单击直接进入关联会话，并补齐会话缓存和项目上下文。
      const normalizedTaskSession = normalizeTaskSession(task, projectId, t);
      const taskSessionPayload = {
        ...task,
        sessionId: normalizedTaskSession.sessionId,
        sessionName: normalizedTaskSession.sessionName,
      };
      // 新增流程自行计算稳定主题色；二次更新只回填列表解析出的头像，避免 undefined 覆盖默认会话头像。
      const taskSessionUpdatePayload = {
        ...taskSessionPayload,
        avatar: normalizedTaskSession.avatar,
      };
      const targetProjectId = [projectId, task.projectId]
        .map((candidateProjectId) => Number(candidateProjectId))
        .find(
          (candidateProjectId) =>
            Number.isFinite(candidateProjectId) && (candidateProjectId === -1 || candidateProjectId > 0)
        );

      if (targetProjectId !== undefined) {
        EventEmitter.emit('projectSpace-session-context', {
          sessionId: `${task.sessionId}`,
          projectId: targetProjectId,
          projectName: project?.projectName || task.projectName,
        });
        dispatch({
          type: 'session/addSession',
          payload: { ...taskSessionPayload, projectId: targetProjectId },
        });
        dispatch({
          type: 'session/updateSession',
          payload: { ...taskSessionUpdatePayload, projectId: targetProjectId },
        });
        setSessionId?.(String(task.sessionId));
        navigate('/chat', {
          state: {
            keepSiderActiveKey: 'sessions',
            from: 'projectSpace',
            projectId: targetProjectId,
            projectName: project?.projectName || task.projectName,
          },
        });
        return;
      }

      dispatch({ type: 'session/addSession', payload: taskSessionPayload });
      dispatch({ type: 'session/updateSession', payload: taskSessionUpdatePayload });
      setSessionId?.(String(task.sessionId));
      navigate('/chat');
    },
    [EventEmitter, dispatch, navigate, project?.projectName, projectId, setSessionId, t]
  );

  // 只读查看别人任务的会话:复用全局回放 Drawer 的 preview 机制,有历史消息、无输入框,不能对话。
  const handleOpenReadonlySession = useCallback(
    (task: any) => {
      if (!task?.sessionId) {
        message.warning(t('task.noSession'));
        return;
      }
      const sessionName = task.title || task.taskName || task.sessionName || `#${task.sessionId}`;
      EventEmitter.emit('beyond-fullabsolute-driver-open-type', {
        drawerType: 'readonlysession',
        canClose: true,
        title: sessionName,
      });
      EventEmitter.emit('beyond-fullabsolute-driver-message', {
        sessionInfo: { sessionId: `${task.sessionId}`, sessionName },
      });
    },
    [EventEmitter, t]
  );

  const handleOpenTaskDetail = useCallback(
    (task: any) => {
      if (channelPanelOpen) {
        // 渠道配置渲染在共享的右侧详情面板中。
        // 打开任务详情前必须先清除该覆盖层，避免两个大页面同时显示。
        setChannelPanelOpen(false);
        clearDetailPanel?.();
      }
      setDetailTask(task);
    },
    [channelPanelOpen, clearDetailPanel]
  );

  const projectSessions = useMemo(() => {
    const sessionMap = new Map<string, ProjectResourceSession>();
    [...(project?.sessions || []), ...resourceSessions].forEach((session) => {
      if (session.sessionId) {
        sessionMap.set(`${session.sessionId}`, session);
      }
    });
    return Array.from(sessionMap.values());
  }, [project?.sessions, resourceSessions]);
  const currentResourceSession = useMemo(() => {
    const activeSessionId = `${activeChatSessionId || ''}`;
    if (activeSessionId) {
      return (
        projectSessions.find((session) => `${session.sessionId}` === activeSessionId) || {
          sessionId: activeSessionId,
          sessionName: t('resource.currentSession'),
        }
      );
    }
    return projectSessions[0];
  }, [activeChatSessionId, projectSessions, t]);

  // 逐个钉钉/待办源查授权状态(查各自创建者)。GitHub 源无需。
  const fetchSourceDwsStatuses = useCallback(async (sourceList: ScanSourceItem[]) => {
    const dingtalkSources = (sourceList || []).filter(
      (s) => s.sourceType === 'dingtalk' || s.sourceType === 'dingtalk_todo'
    );
    if (!dingtalkSources.length) {
      setSourceDwsStatusMap({});
      return;
    }
    const entries = await Promise.all(
      dingtalkSources.map(async (s) => {
        try {
          const res = await checkDwsAuthStatusBySource(s.sourceId);
          return [s.sourceId, (res || {}) as SourceDwsStatus] as const;
        } catch {
          return [s.sourceId, {} as SourceDwsStatus] as const;
        }
      })
    );
    setSourceDwsStatusMap(Object.fromEntries(entries));
  }, []);

  const fetchSources = useCallback(async () => {
    if (!projectId) return [];
    setSourcesLoading(true);
    try {
      const sourceList = (await listScanSources(projectId)) || [];
      setSources(sourceList);
      void fetchSourceDwsStatuses(sourceList as ScanSourceItem[]);
      return sourceList as ScanSourceItem[];
    } finally {
      setSourcesLoading(false);
    }
  }, [projectId, fetchSourceDwsStatuses]);

  // 当前登录用户是否为该源创建者:控制授权/编辑/删除入口。
  const isSourceCreator = useCallback(
    (source: ScanSourceItem) => {
      const currentUserId = userInfo?.userId ?? userInfo?.id;
      return (
        currentUserId !== undefined &&
        currentUserId !== null &&
        source.createBy !== undefined &&
        source.createBy !== null &&
        `${source.createBy}` === `${currentUserId}`
      );
    },
    [userInfo]
  );

  const fetchRequirements = useCallback(
    async (sourceList?: ScanSourceItem[], title = '') => {
      if (!projectId) return;
      const queryVersion = requirementQueryVersionRef.current + 1;
      requirementQueryVersionRef.current = queryVersion;
      setRequirementsLoading(true);
      try {
        // 一次按项目直查全部需求，后端已 join 源并按创建时间倒序；不再逐源循环请求、不再前端排序。
        const items = ((await listRequirementsByProject(projectId, title)) || []) as RequirementItem[];
        if (queryVersion !== requirementQueryVersionRef.current) return;
        setRequirements(items);
        setVisibleRequirementCount(REQUIREMENT_PAGE_SIZE);
        if (sourceList) {
          // “上次扫描完成”时间直接取源列表里最大的 lastScanTime，省掉逐源查扫描日志。
          const latestScanTime = sourceList
            .map((s: any) => s.lastScanTime)
            .filter(Boolean)
            .sort()
            .pop();
          setLastLog(latestScanTime ? ({ scanTime: latestScanTime } as ScanLogEntry) : null);
        }
      } finally {
        if (queryVersion === requirementQueryVersionRef.current) {
          setRequirementsLoading(false);
        }
      }
    },
    [projectId]
  );

  const fetchTasks = useCallback(
    async ({ append = false, ...overrides }: TaskFetchOptions = {}) => {
      if (!projectId) return;

      const queryState = { ...taskQueryRef.current, ...overrides };
      const queryVersion = append ? taskQueryVersionRef.current : taskQueryVersionRef.current + 1;
      if (append && taskAppendingVersionRef.current === queryVersion) return;

      if (!append) {
        taskQueryVersionRef.current = queryVersion;
        taskAppendingVersionRef.current = null;
        setTasksLoadingMore(false);
      }
      taskQueryRef.current = queryState;
      setTaskDateRange(queryState.dateRange);
      setTaskSearchKeyword(queryState.taskName);
      if (append) {
        // 只有滚动追加时展示底部 loading，刷新和搜索不再复用该提示。
        taskAppendingVersionRef.current = queryVersion;
        setTasksLoadingMore(true);
      }
      taskRequestCountRef.current += 1;
      setTasksLoading(true);
      try {
        const taskPage = await listTasks({
          projectId,
          pageNum: queryState.pageNum,
          pageSize: queryState.pageSize,
          createTimeStart: queryState.dateRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
          createTimeEnd: queryState.dateRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
          taskName: queryState.taskName || undefined,
        });
        // 筛选重置列表，触底请求只追加未出现过的任务，避免滚动事件重复触发产生重复卡片。
        if (queryVersion !== taskQueryVersionRef.current) return;

        const taskList = Array.isArray(taskPage?.list) ? taskPage.list : [];
        const total = Number(taskPage?.total || 0);
        setTasks((currentTasks) => {
          if (!append) return taskList;

          const existingTaskKeys = new Set(currentTasks.map((task) => `${task.taskId || task.sessionId}`));
          return [
            ...currentTasks,
            ...taskList.filter((task) => !existingTaskKeys.has(`${task.taskId || task.sessionId}`)),
          ];
        });
        setHasMoreTasks(queryState.pageNum * queryState.pageSize < total);
      } finally {
        if (append && taskAppendingVersionRef.current === queryVersion) {
          taskAppendingVersionRef.current = null;
          setTasksLoadingMore(false);
        }
        taskRequestCountRef.current = Math.max(0, taskRequestCountRef.current - 1);
        setTasksLoading(taskRequestCountRef.current > 0);
      }
    },
    [projectId]
  );

  const handleTaskSearchChange = useCallback(
    (value: string) => {
      setTaskSearchKeyword(value);
      if (taskSearchTimerRef.current) clearTimeout(taskSearchTimerRef.current);

      // 输入停顿后按任务名称查询，避免每个字符都触发任务列表请求。
      taskSearchTimerRef.current = setTimeout(() => {
        void fetchTasks({ pageNum: 1, taskName: value.trim() });
        taskSearchTimerRef.current = null;
      }, 300);
    },
    [fetchTasks]
  );

  const handleTaskSearchSubmit = useCallback(() => {
    if (taskSearchTimerRef.current) {
      clearTimeout(taskSearchTimerRef.current);
      taskSearchTimerRef.current = null;
    }
    void fetchTasks({ pageNum: 1, taskName: taskSearchKeyword.trim() });
  }, [fetchTasks, taskSearchKeyword]);

  const handleRefreshTasks = useCallback(async () => {
    if (tasksRefreshLoading) return;
    if (taskSearchTimerRef.current) {
      clearTimeout(taskSearchTimerRef.current);
      taskSearchTimerRef.current = null;
    }
    // 手动刷新保留当前任务名称和日期范围，避免刷新后丢失用户正在查看的筛选结果。
    setTasksRefreshLoading(true);
    try {
      await fetchTasks({ pageNum: 1, taskName: taskSearchKeyword.trim(), dateRange: taskDateRange });
    } finally {
      // 刷新按钮独立结束，列表已有数据时不再同时显示整块 loading。
      setTasksRefreshLoading(false);
    }
  }, [fetchTasks, taskDateRange, taskSearchKeyword, tasksRefreshLoading]);

  useEffect(
    () => () => {
      if (taskSearchTimerRef.current) clearTimeout(taskSearchTimerRef.current);
      if (requirementSearchTimerRef.current) clearTimeout(requirementSearchTimerRef.current);
    },
    []
  );

  const fetchRepos = useCallback(async () => {
    if (!projectId) return;
    // 收集源编辑页的仓库下拉复用项目详情接口返回的 repos，和 /devloop 页面保持一致。
    const detail = await getProject(projectId);
    setRepos(detail?.repos || []);
  }, [projectId]);

  useEffect(() => {
    if (
      !sourceModalOpen ||
      editingSource ||
      sourceModalReadonly ||
      sourceRepoDefaultedRef.current ||
      sourceForm.repoId !== undefined ||
      !repos.length
    ) {
      return;
    }
    sourceRepoDefaultedRef.current = true;
    // 新增渠道默认使用项目仓库列表第一项，编辑渠道保留原有关联仓库。
    setSourceForm((prev) => ({ ...prev, repoId: repos[0].repoId }));
  }, [editingSource, repos, sourceForm.repoId, sourceModalOpen, sourceModalReadonly]);

  useEffect(() => {
    if (
      !manualRequirementOpen ||
      editingManualRequirement ||
      manualRequirementRepoDefaultedRef.current ||
      manualRequirementForm.repoId !== undefined ||
      !repos.length
    ) {
      return;
    }
    manualRequirementRepoDefaultedRef.current = true;
    // 新增需求默认使用项目仓库列表第一项，编辑需求保留原有关联仓库。
    setManualRequirementForm((prev) => ({ ...prev, repoId: repos[0].repoId }));
  }, [editingManualRequirement, manualRequirementForm.repoId, manualRequirementOpen, repos]);

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    const res = await listProjectMembers(projectId);
    const memberList = Array.isArray(res) ? res : [];
    setMembers(memberList);
  }, [projectId]);

  const handleMembersChange = useCallback(
    (memberList: any[]) => {
      setMembers(memberList);
      // 成员 tab 新增成员后，父组件统一刷新项目共享状态，避免子组件额外扩展 props 类型。
      if (memberList.length && projectId && !project?.sharedFlag) {
        onProjectSharedChange?.(projectId);
      }
    },
    [onProjectSharedChange, project?.sharedFlag, projectId]
  );

  const handleCurrentUserRemoved = useCallback(() => {
    // 当前用户退出项目后立即清除右侧覆盖面板，避免保留已无权限访问的项目上下文。
    clearDetailPanel?.();
    if (projectId && onCurrentUserRemoved) {
      onCurrentUserRemoved(projectId);
      return;
    }
    onBack();
  }, [clearDetailPanel, onBack, onCurrentUserRemoved, projectId]);

  const fetchProjectResourceSessions = useCallback(async () => {
    if (!projectId) return;
    try {
      // 资源 tab 的“全部会话”按项目会话接口取分组，避免依赖左侧列表是否展开过。
      const res = await listProjectSessionsByQo(
        {
          projectId,
          pageNum: 1,
          pageSize: 200,
        },
        { responseCfg: { hideErrorTips: true } }
      );
      setResourceSessions(getArrayData(res).map((item) => normalizeProjectSession(item, `${projectId}`)));
    } catch (error) {
      console.error('Failed to load project resource sessions:', error);
      setResourceSessions([]);
    }
  }, [projectId]);

  const fetchSharedResourceFiles = useCallback(async () => {
    if (!projectId) return;
    setSharedFilesLoading(true);
    try {
      // 共享文件空间改为项目维度接口，避免继续读取当前数字员工的 /.shared/ 目录。
      const res = await listProjectSpaceFiles(projectId);
      setSharedFiles(
        sortFileBrowserItems(unwrapListResponse<DevloopProjectSpaceFile>(res).map(normalizeProjectSpaceFile))
      );
    } catch (error) {
      console.error('Failed to load shared project files:', error);
      message.error(t('resource.sharedFilesLoadFailed'));
      setSharedFiles([]);
    } finally {
      setSharedFilesLoading(false);
    }
  }, [projectId, t]);

  // 代码变更按当前会话(任务)拉取:远程分支相对基线的文件 diff。切换会话时重取。
  const fetchTaskChanges = useCallback(async (sessionId?: string | number | null) => {
    if (!sessionId) {
      setTaskChanges(null);
      return;
    }
    setTaskChangesLoading(true);
    try {
      const res = await getTaskChanges(Number(sessionId));
      setTaskChanges(res || null);
    } catch (error) {
      console.error('Failed to load task changes:', error);
      setTaskChanges(null);
    } finally {
      setTaskChangesLoading(false);
    }
  }, []);

  // 点变更文件行:打开 diff modal 并拉取该文件的本地 unified diff。
  const openFileDiff = useCallback(
    async (filePath: string) => {
      const sessionId = currentResourceSession?.sessionId;
      if (!sessionId) return;
      setDiffModalFile(filePath);
      setDiffModalData(null);
      setDiffModalLoading(true);
      try {
        const res = await getTaskFileDiff(Number(sessionId), filePath);
        setDiffModalData(res || null);
      } catch (error) {
        console.error('Failed to load file diff:', error);
        setDiffModalData(null);
      } finally {
        setDiffModalLoading(false);
      }
    },
    [currentResourceSession?.sessionId]
  );

  const closeFileDiff = useCallback(() => {
    setDiffModalFile(null);
    setDiffModalData(null);
  }, []);

  const fetchSessionResourceFiles = useCallback(
    async (sessionId: string) => {
      if (!fileResourceId || !sessionId) return;
      setSessionFilesLoadingMap((prev) => ({ ...prev, [sessionId]: true }));
      try {
        // 会话文件与文件模块“会话空间”同源，每个会话对应 /.sessions/{sessionId}/。
        const res = await listFiles({ resourceId: fileResourceId, path: getSessionFilePath(sessionId) });
        setSessionFilesMap((prev) => ({
          ...prev,
          [sessionId]: sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(res)),
        }));
      } catch (error) {
        console.error('Failed to load session project files:', error);
        setSessionFilesMap((prev) => ({ ...prev, [sessionId]: [] }));
      } finally {
        setSessionFilesLoadingMap((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [fileResourceId]
  );

  // 会话空间刷新:按当前范围(当前会话/全部会话)重新拉取对应会话的文件。
  const refreshSessionResourceFiles = useCallback(() => {
    const sessionIds =
      resourceFileScope === 'all'
        ? projectSessions.map((session) => `${session.sessionId}`).filter(Boolean)
        : currentResourceSession?.sessionId
          ? [`${currentResourceSession.sessionId}`]
          : [];
    Array.from(new Set(sessionIds)).forEach((id) => {
      void fetchSessionResourceFiles(id);
    });
  }, [resourceFileScope, projectSessions, currentResourceSession?.sessionId, fetchSessionResourceFiles]);

  const loadResourceTreeNode = useCallback(
    async (node: FileTreeItem) => {
      if (!fileResourceId || !isDirectory(node)) return;
      const directoryPath = ensureDirectoryPath(node.path);
      if (resourceChildrenByPath[directoryPath]) return;

      try {
        // 资源 tab 复用文件模块目录树，下钻时按当前目录实时读取子级文件。
        const res = await listFiles({ resourceId: fileResourceId, path: directoryPath });
        setResourceChildrenByPath((prev) => ({
          ...prev,
          [directoryPath]: sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(res)),
        }));
      } catch (error) {
        console.error('Failed to load project resource child files:', error);
        setResourceChildrenByPath((prev) => ({ ...prev, [directoryPath]: [] }));
      }
    },
    [fileResourceId, resourceChildrenByPath]
  );

  const pruneResourceDirectoryCache = useCallback((targetPath: string) => {
    const targetDirectoryPath = ensureDirectoryPath(normalizeFileBrowserPath(targetPath));
    // 文件夹被改名或删除后，清掉旧路径下的展开和子级缓存，避免继续展示旧目录。
    setResourceExpandedKeys((prev) =>
      prev.filter((key) => {
        const normalizedKey = ensureDirectoryPath(normalizeFileBrowserPath(String(key)));
        return !isPathIn(normalizedKey, targetDirectoryPath);
      })
    );
    setResourceChildrenByPath((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(
          ([path]) => !isPathIn(ensureDirectoryPath(normalizeFileBrowserPath(path)), targetDirectoryPath)
        )
      )
    );
  }, []);

  const refreshResourceDirectory = useCallback(
    async (directoryPath: string) => {
      if (!fileResourceId) return;
      const normalizedDirectoryPath = ensureDirectoryPath(normalizeFileBrowserPath(directoryPath));
      if (normalizedDirectoryPath === SHARED_FILE_PATH) {
        await fetchSharedResourceFiles();
        return;
      }

      const resourceSessionId = getResourceSessionIdByPath(normalizedDirectoryPath);
      if (resourceSessionId && normalizedDirectoryPath === getSessionFilePath(resourceSessionId)) {
        await fetchSessionResourceFiles(resourceSessionId);
        return;
      }

      const res = await listFiles({ resourceId: fileResourceId, path: normalizedDirectoryPath });
      setResourceChildrenByPath((prev) => ({
        ...prev,
        [normalizedDirectoryPath]: sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(res)),
      }));
    },
    [fetchSessionResourceFiles, fetchSharedResourceFiles, fileResourceId]
  );

  const getSharedResourceFileActionItems = useCallback(
    (item: FileBrowserItem): MenuProps['items'] => {
      const labelIdMap = {
        quote: 'common.quote',
        preview: 'fileBrowser.action.preview',
        download: 'directoryManage.downloadFile',
      };
      const actionKeys = ['quote', ...(canPreviewFile(item) ? (['preview'] as const) : []), 'download'] as const;

      // 项目共享文件来自 listSpaceFiles，引用操作与文件树双击共用同一个处理函数。
      return actionKeys.map((key) => ({
        key,
        label: <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: labelIdMap[key] })}</div>,
      }));
    },
    [intl]
  );

  const getSessionResourceFileActionItems = useCallback(
    (item: FileBrowserItem): MenuProps['items'] => {
      const labelIdMap = {
        quote: 'common.quote',
        preview: 'fileBrowser.action.preview',
        download: 'directoryManage.downloadFile',
        rename: 'fileBrowser.action.rename',
        delete: 'fileBrowser.action.delete',
      };
      const canSaveToSpace = !isDirectory(item) && !!getResourceSessionIdByPath(item.path);
      const actionKeys = [
        'quote',
        ...(canPreviewFile(item) ? (['preview'] as const) : []),
        'download',
        'rename',
        'delete',
        ...(canSaveToSpace ? (['saveToSpace'] as const) : []),
      ] as const;

      // 会话空间文件可保存到项目共享文件空间；文件夹暂不接入，和后端 saveToSpace 入参保持一致。
      return actionKeys.map((key) => ({
        key,
        label: (
          <div className={employeeStyles.dropdownMenuItem}>
            {key === 'saveToSpace' ? t('resource.saveToSpace') : intl.formatMessage({ id: labelIdMap[key] })}
          </div>
        ),
      }));
    },
    [intl, t]
  );

  const handleDeleteResourceFile = useCallback(
    async (item: FileBrowserItem) => {
      if (!fileResourceId) return;
      const itemPath = normalizeFileBrowserPath(item.path);
      const parentPath = getParentDirectoryPath(itemPath);
      try {
        await deleteFiles({ resourceId: fileResourceId, paths: [item.path] });
        message.success(intl.formatMessage({ id: 'fileBrowser.delete.success' }));
        if (isDirectory(item)) {
          pruneResourceDirectoryCache(item.path);
        }
        await refreshResourceDirectory(parentPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.delete.failed' }));
      }
    },
    [fileResourceId, intl, pruneResourceDirectoryCache, refreshResourceDirectory]
  );

  const handleResourceRenameOk = useCallback(
    async (newName: string) => {
      if (!resourceRenameTarget || !fileResourceId) return;
      const parentPath = getParentDirectoryPath(resourceRenameTarget.path);
      setResourceRenameLoading(true);
      try {
        await renameFile({ resourceId: fileResourceId, sourcePath: resourceRenameTarget.path, newName });
        message.success(intl.formatMessage({ id: 'fileBrowser.rename.success' }));
        setResourceRenameOpen(false);
        setResourceRenameTarget(null);
        if (isDirectory(resourceRenameTarget)) {
          pruneResourceDirectoryCache(resourceRenameTarget.path);
        }
        await refreshResourceDirectory(parentPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.rename.failed' }));
      } finally {
        setResourceRenameLoading(false);
      }
    },
    [fileResourceId, intl, pruneResourceDirectoryCache, refreshResourceDirectory, resourceRenameTarget]
  );

  const handleSharedResourcePreview = useCallback(
    async (item: FileBrowserItem) => {
      const fileUrl = (item as ProjectSpaceFileItem).fileUrl;
      if (!fileUrl) {
        void handleResourcePreview(item);
        return;
      }
      if (!canPreviewFile(item)) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
        return;
      }

      const fileType = getFileType(item.name);
      EventEmitter.emit('beyond-main-driver-open-type', {
        title: item.name,
        width: '50vw',
        minWidth: '360px',
        maxWidth: '70vw',
        drawerType: 'preview',
        canClose: true,
        canFullScreen: false,
      });
      EventEmitter.emit('beyond-main-driver-message', {
        data: undefined,
        type: fileType,
        title: item.name,
        className: fileSiderStyles.previewContent,
      });

      try {
        // listSpaceFiles 返回的是 commonFile 预览地址，预览时直接按 URL 拉取文件流。
        const response = await fetch(getFileUrl(fileUrl));
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const blob = await response.blob();
        EventEmitter.emit('beyond-main-driver-message', {
          data: blob,
          type: fileType,
          title: item.name,
          className: fileSiderStyles.previewContent,
        });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.preview.failed' }));
      }
    },
    [EventEmitter, handleResourcePreview, intl]
  );

  const handleSharedResourceDownload = useCallback(
    (item: FileBrowserItem) => {
      const fileUrl = (item as ProjectSpaceFileItem).fileUrl;
      if (!fileUrl) {
        void handleResourceDownload(item);
        return;
      }
      downloadUrlFile({ fileUrl, fileName: item.name });
    },
    [handleResourceDownload]
  );

  const handleSaveSessionFileToSpace = useCallback(
    async (item: FileBrowserItem) => {
      if (!projectId) return;
      const resourceSessionId = getResourceSessionIdByPath(item.path);
      if (!resourceSessionId) {
        message.warning(t('resource.sessionNotFound'));
        return;
      }

      const messageKey = 'projectSaveFileToSpace';
      message.loading({ key: messageKey, content: t('resource.savingToSpace'), duration: 0 });
      try {
        await saveProjectFileToSpace({
          projectId,
          sessionId: Number(resourceSessionId),
          filePath: item.path,
          fileName: item.name,
        });
        message.success({ key: messageKey, content: t('resource.savedToSpace') });
        await fetchSharedResourceFiles();
      } catch (error: any) {
        message.error({ key: messageKey, content: error?.message || t('resource.saveToSpaceFailed') });
      }
    },
    [fetchSharedResourceFiles, projectId, t]
  );

  const clearResourceClickTimer = useCallback(() => {
    if (resourceClickTimerRef.current) {
      window.clearTimeout(resourceClickTimerRef.current);
      resourceClickTimerRef.current = null;
    }
  }, []);

  const handleResourceItemDoubleClick = useCallback(
    (item: FileBrowserItem) => {
      if (!fileResourceId) return;
      clearResourceClickTimer();
      // 菜单引用和双击共用该处理，确保插入聊天输入框的资源格式完全一致。
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, fileResourceId),
        type: isDirectory(item) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, clearResourceClickTimer, fileResourceId]
  );

  const handleSharedResourceFileAction = useCallback(
    (key: React.Key, item: FileBrowserItem) => {
      if (key === 'quote') {
        handleResourceItemDoubleClick(item);
      } else if (key === 'preview') {
        void handleSharedResourcePreview(item);
      } else if (key === 'download') {
        handleSharedResourceDownload(item);
      }
    },
    [handleResourceItemDoubleClick, handleSharedResourceDownload, handleSharedResourcePreview]
  );

  const handleResourceFileAction = useCallback(
    (key: React.Key, item: FileBrowserItem) => {
      if (key === 'quote') {
        handleResourceItemDoubleClick(item);
      } else if (key === 'preview') {
        void handleResourcePreview(item);
      } else if (key === 'download') {
        void handleResourceDownload(item);
      } else if (key === 'rename') {
        setResourceRenameTarget(item);
        setResourceRenameOpen(true);
      } else if (key === 'delete') {
        Modal.confirm({
          title: intl.formatMessage({ id: 'fileBrowser.delete.confirm' }),
          content: intl.formatMessage({ id: 'fileBrowser.delete.confirmName' }, { name: item.name }),
          onOk: () => handleDeleteResourceFile(item),
        });
      } else if (key === 'saveToSpace') {
        void handleSaveSessionFileToSpace(item);
      }
    },
    [
      handleDeleteResourceFile,
      handleResourceDownload,
      handleResourceItemDoubleClick,
      handleResourcePreview,
      handleSaveSessionFileToSpace,
      intl,
    ]
  );

  const handleResourceItemClick = useCallback(
    (event: React.MouseEvent, item: FileTreeItem) => {
      event.stopPropagation();
      clearResourceClickTimer();
      // 延迟执行预览，给双击引用留出取消单击行为的时间窗口。
      resourceClickTimerRef.current = window.setTimeout(() => {
        resourceClickTimerRef.current = null;
        if (isDirectory(item)) return;
        if (!canPreviewFile(item)) {
          message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
          return;
        }
        if (isProjectSpaceFile(item)) {
          void handleSharedResourcePreview(item);
          return;
        }
        void handleResourcePreview(item);
      }, 220);
    },
    [clearResourceClickTimer, handleResourcePreview, handleSharedResourcePreview, intl]
  );

  useEffect(() => clearResourceClickTimer, [clearResourceClickTimer]);

  const fetchDetailData = useCallback(async () => {
    if (!projectId) return;
    // 打开详情时并行请求当前可见 tab 需要的数据，成员 tab 隐藏时不额外查询成员。
    const requirementPromise = showRequirementsTab
      ? fetchSources().then((sourceList) => fetchRequirements(sourceList, ''))
      : Promise.resolve();
    const memberPromise = showMembersTab ? fetchMembers() : Promise.resolve();
    await Promise.all([requirementPromise, fetchTasks(), memberPromise, fetchRepos()]);
  }, [
    fetchMembers,
    fetchRepos,
    fetchRequirements,
    fetchSources,
    fetchTasks,
    projectId,
    showMembersTab,
    showRequirementsTab,
  ]);

  useEffect(() => {
    if (requirementSearchTimerRef.current) {
      clearTimeout(requirementSearchTimerRef.current);
      requirementSearchTimerRef.current = null;
    }
    requirementQueryVersionRef.current += 1;
    if (taskSearchTimerRef.current) {
      clearTimeout(taskSearchTimerRef.current);
      taskSearchTimerRef.current = null;
    }
    taskQueryRef.current = { pageNum: 1, pageSize: TASK_PAGE_SIZE, dateRange: null, taskName: '' };
    taskQueryVersionRef.current += 1;
    taskAppendingVersionRef.current = null;
    setTaskDateRange(null);
    setTaskSearchKeyword('');
    setTasks([]);
    setHasMoreTasks(false);
    setTasksRefreshLoading(false);
    setTasksLoadingMore(false);
    setActiveTab(showRequirementsTab ? 'requirements' : 'tasks');
    setDetailReq(null);
    setRequirementSearchKeyword('');
    setVisibleRequirementCount(REQUIREMENT_PAGE_SIZE);
    startingRequirementIdsRef.current.clear();
    setStartingRequirementIds(new Set());
    if (!showRequirementsTab) {
      setSources([]);
      setRequirements([]);
      setLastLog(null);
    }
    fetchDetailData();
  }, [fetchDetailData, showRequirementsTab]);

  useEffect(() => {
    setResourceFileScope('current');
    setSharedFiles([]);
    setResourceSessions([]);
    setSessionFilesMap({});
    setSessionFilesLoadingMap({});
    setResourceChildrenByPath({});
    setResourceExpandedKeys([]);
    setResourceRenameOpen(false);
    setResourceRenameTarget(null);
    setResourceRenameLoading(false);
  }, [fileResourceId, projectId]);

  useEffect(() => {
    if (activeTab !== 'resources') return;
    void fetchProjectResourceSessions();
  }, [activeTab, fetchProjectResourceSessions]);

  useEffect(() => {
    if (activeTab !== 'resources') return;
    void fetchSharedResourceFiles();
  }, [activeTab, fetchSharedResourceFiles]);

  // 代码变更只跟当前会话(任务)走,与“会话空间”的当前会话同口径;切会话即重取。仅研发项目拉取。
  useEffect(() => {
    if (activeTab !== 'resources' || !isDevelopProject) return;
    void fetchTaskChanges(currentResourceSession?.sessionId);
  }, [activeTab, isDevelopProject, currentResourceSession?.sessionId, fetchTaskChanges]);

  useEffect(() => {
    if (activeTab !== 'resources' || !fileResourceId) return;
    let sessionIds: string[] = [];
    if (resourceFileScope === 'all') {
      sessionIds = projectSessions.map((session) => `${session.sessionId}`).filter(Boolean);
    } else if (currentResourceSession?.sessionId) {
      sessionIds = [`${currentResourceSession.sessionId}`];
    }
    Array.from(new Set(sessionIds)).forEach((item) => {
      void fetchSessionResourceFiles(item);
    });
  }, [
    activeTab,
    currentResourceSession?.sessionId,
    fetchSessionResourceFiles,
    fileResourceId,
    projectSessions,
    resourceFileScope,
  ]);

  useEffect(() => {
    checkGitHubPat()
      .then((res: any) => {
        if (res?.hasPat) setHasPatSaved(true);
      })
      .catch((error) => {
        // PAT 状态只是 GitHub 收集源的辅助信息，失败时不影响详情页其它 tab 功能。
        console.error('Failed to check GitHub PAT:', error);
      });
  }, []);

  useEffect(() => {
    checkDwsAuthStatus()
      .then((res: any) => {
        setDwsAuthDetail(res);
        if (res?.tokenValid) {
          setDwsAuthed(true);
          setDwsExpired(false);
          if (res.expiresAt) setDwsExpiresAt(res.expiresAt);
        } else if (res?.hasToken) {
          setDwsAuthed(false);
          setDwsExpired(true);
        }
      })
      .catch((error) => {
        // DWS 授权状态只影响钉钉源编辑提示，查询失败不阻塞项目详情。
        console.error('Failed to check DWS auth status:', error);
      });

    return () => {
      if (dwsAuthTimerRef.current) clearInterval(dwsAuthTimerRef.current);
      if (dwsAuthTimeoutRef.current) clearTimeout(dwsAuthTimeoutRef.current);
    };
  }, []);

  const hasRequirementVisibleData = sources.length > 0 || requirements.length > 0 || !!lastLog;
  const requirementsTabLoading = sourcesLoading || requirementsLoading;
  const visibleRequirements = useMemo(
    () => requirements.slice(0, visibleRequirementCount),
    [requirements, visibleRequirementCount]
  );
  const hasMoreRequirements = visibleRequirementCount < requirements.length;

  // 各 tab 只响应自己的加载状态；需求 tab 已有可见数据时不再整块遮罩，避免“数据已出现但还在 loading”的观感。
  const detailSpinning =
    (activeTab === 'requirements' &&
      requirementsTabLoading &&
      !hasRequirementVisibleData &&
      !requirementsRefreshLoading) ||
    (activeTab === 'tasks' && tasksLoading && !tasks.length && !tasksRefreshLoading);

  const tabItems = useMemo(
    () => [
      ...(showRequirementsTab ? [{ key: 'requirements', label: t('tabs.requirements') }] : []),
      { key: 'tasks', label: t('tabs.tasks') },
      { key: 'resources', label: t('tabs.resources') },
      // 研发型项目才展示集成测试环境配置(与需求 Tab 同门禁)。
      // ...(showRequirementsTab ? [{ key: 'integration', label: t('tabs.integration') }] : []),
      ...(showMembersTab ? [{ key: 'members', label: t('tabs.members') }] : []),
    ],
    [showMembersTab, showRequirementsTab, t]
  );

  const detailPanelTabCountClass = styles[`projectDetailPanelTabCount${tabItems.length}`] || '';

  const resetSourceForm = (type: SourceType = 'github_issue') => {
    setEditingSource(null);
    setSourceModalReadonly(false);
    setSourceForm({
      ...getDefaultSourceForm(),
      type,
    });
    setGroupOptions([]);
  };

  const openAddSourceModal = (type: SourceType = 'github_issue') => {
    sourceRepoDefaultedRef.current = false;
    resetSourceForm(type);
    setSourceModalOpen(true);
  };

  const handleHeaderAdd = () => {
    if (!showRequirementsTab) return;
    openAddSourceModal();
  };

  const handleRefreshRequirements = useCallback(async () => {
    if (!showRequirementsTab || requirementsRefreshLoading) return;
    setRequirementsRefreshLoading(true);
    try {
      const sourceList = await fetchSources();
      await fetchRequirements(sourceList, requirementSearchKeyword.trim());
    } catch (error) {
      console.error('Failed to refresh project requirements:', error);
      message.error(t('requirement.refreshFailed'));
    } finally {
      // 手动刷新按钮只响应自己的刷新动作，避免打开渠道配置时拉渠道数据导致按钮转圈。
      setRequirementsRefreshLoading(false);
    }
  }, [fetchRequirements, fetchSources, requirementSearchKeyword, requirementsRefreshLoading, showRequirementsTab, t]);

  const handleRequirementSearchChange = useCallback(
    (value: string) => {
      setRequirementSearchKeyword(value);
      setVisibleRequirementCount(REQUIREMENT_PAGE_SIZE);
      if (requirementSearchTimerRef.current) clearTimeout(requirementSearchTimerRef.current);

      // 与会话、任务列表统一在输入停顿后查询，避免每个字符都请求需求接口。
      requirementSearchTimerRef.current = setTimeout(() => {
        void fetchRequirements(undefined, value.trim());
        requirementSearchTimerRef.current = null;
      }, 300);
    },
    [fetchRequirements]
  );

  const handleRequirementSearchSubmit = useCallback(() => {
    if (requirementSearchTimerRef.current) {
      clearTimeout(requirementSearchTimerRef.current);
      requirementSearchTimerRef.current = null;
    }
    void fetchRequirements(undefined, requirementSearchKeyword.trim());
  }, [fetchRequirements, requirementSearchKeyword]);

  const handleRequirementListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMoreRequirements) return;

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight > 80) return;

      // 需求接口当前一次返回归并结果，左侧窄面板按 20 条递增渲染，避免一次性塞满列表。
      setVisibleRequirementCount((prev) => Math.min(prev + REQUIREMENT_PAGE_SIZE, requirements.length));
    },
    [hasMoreRequirements, requirements.length]
  );

  const handleTaskListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMoreTasks) return;

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight > 80) return;

      // 任务接口按页返回，触底时继续追加下一页，分页条件与当前日期筛选保持一致。
      void fetchTasks({ pageNum: taskQueryRef.current.pageNum + 1, append: true });
    },
    [fetchTasks, hasMoreTasks]
  );

  const openManualRequirementModal = () => {
    if (manualRequirementSubmittingRef.current) return;

    manualRequirementRepoDefaultedRef.current = false;
    setEditingManualRequirement(null);
    setManualRequirementForm(getDefaultManualRequirementForm());
    setManualRequirementOpen(true);
  };

  const openEditManualRequirementModal = (requirement: RequirementItem) => {
    if (
      manualRequirementSubmittingRef.current ||
      startingRequirementIdsRef.current.has(requirement.itemId) ||
      (requirement.sessionId !== undefined && requirement.sessionId !== null) ||
      !isManualRequirement(requirement)
    ) {
      return;
    }

    setEditingManualRequirement(requirement);
    setManualRequirementForm({
      sourceType: getManualRequirementSourceType(requirement.manualSourceType),
      branch: requirement.branch || '',
      repoId: requirement.repoId ?? undefined,
      title: requirement.title || '',
      originalContent: requirement.originalContent || '',
      productContent: requirement.productContent || '',
    });
    setManualRequirementOpen(true);
  };

  const handleManualRequirementSubmit = async () => {
    if (!projectId || manualRequirementSubmittingRef.current) return;
    const repoId = manualRequirementForm.repoId;
    if (!manualRequirementForm.title.trim()) {
      message.warning(t('manualRequirement.validation.titleRequired'));
      return;
    }
    if (!manualRequirementForm.originalContent.trim()) {
      message.warning(t('manualRequirement.validation.originalContentRequired'));
      return;
    }
    if (!repoId) {
      message.warning(t('manualRequirement.validation.repoRequired'));
      return;
    }

    const editingRequirementId = editingManualRequirement?.itemId;
    const isEditingManualRequirement = editingRequirementId !== undefined;
    const manualRequirementPayload = {
      sourceType: manualRequirementForm.sourceType,
      branch: manualRequirementForm.branch.trim() || undefined,
      repoId,
      title: manualRequirementForm.title.trim(),
      originalContent: manualRequirementForm.originalContent.trim(),
      productContent: manualRequirementForm.productContent.trim() || undefined,
    };

    manualRequirementSubmittingRef.current = true;
    setManualRequirementSubmitting(true);
    try {
      if (isEditingManualRequirement) {
        await updateManualRequirement({ itemId: editingRequirementId, ...manualRequirementPayload });
      } else {
        await createManualRequirement({ projectId, ...manualRequirementPayload });
      }
      message.success(
        t(isEditingManualRequirement ? 'manualRequirement.updateSuccess' : 'manualRequirement.createSuccess')
      );
      setManualRequirementOpen(false);
      setEditingManualRequirement(null);
      setManualRequirementForm(getDefaultManualRequirementForm());
      // 列表和当前已打开的详情都可能保留旧内容，保存后统一按项目重新拉取。
      if (isEditingManualRequirement && detailReq?.itemId === editingRequirementId) {
        setDetailReq(null);
      }
      const sourceList = await fetchSources();
      await fetchRequirements(sourceList, requirementSearchKeyword.trim());
    } catch (error: any) {
      message.error(
        error?.message ||
          t(isEditingManualRequirement ? 'manualRequirement.updateFailed' : 'manualRequirement.createFailed')
      );
    } finally {
      manualRequirementSubmittingRef.current = false;
      setManualRequirementSubmitting(false);
    }
  };

  const handleDeleteManualRequirement = (requirement: RequirementItem) => {
    if (
      !isProjectCreator ||
      startingRequirementIdsRef.current.has(requirement.itemId) ||
      (requirement.sessionId !== undefined && requirement.sessionId !== null) ||
      !isManualRequirement(requirement) ||
      deletingManualRequirementIdRef.current !== null
    ) {
      return;
    }

    Modal.confirm({
      title: t('manualRequirement.deleteConfirmTitle'),
      content: t('manualRequirement.deleteConfirm', { name: requirement.title }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      // 返回 Promise 后确认按钮会自动进入 loading，避免等待删除接口时重复确认。
      onOk: async () => {
        if (deletingManualRequirementIdRef.current !== null) return;

        deletingManualRequirementIdRef.current = requirement.itemId;
        setDeletingManualRequirementId(requirement.itemId);
        try {
          await deleteManualRequirement(requirement.itemId);
          message.success(t('manualRequirement.deleteSuccess'));
          if (detailReq?.itemId === requirement.itemId) {
            setDetailReq(null);
          }
          // 删除已成功后先移除本地列表项，使确认弹窗立即关闭；列表刷新不应阻塞成功结果。
          setRequirements((items) => items.filter((item) => item.itemId !== requirement.itemId));
          void fetchRequirements(undefined, requirementSearchKeyword.trim()).catch(() => {
            // 删除结果已生效，刷新失败时保留本地移除结果，避免将刷新异常误报为删除失败。
          });
        } catch (error: any) {
          message.error(error?.message || t('manualRequirement.deleteFailed'));
          // 抛出异常让确认弹窗保持打开，用户修正问题后可直接再次确认删除。
          throw error;
        } finally {
          deletingManualRequirementIdRef.current = null;
          setDeletingManualRequirementId(null);
        }
      },
    });
  };

  const handleSaveSource = async () => {
    if (!projectId || sourceSavingRef.current) return;
    if (!sourceForm.name.trim()) {
      message.error(t('source.validation.nameRequired'));
      return;
    }
    if (!sourceForm.repoId) {
      message.error(t('source.validation.repoRequired'));
      return;
    }

    let config = '';
    if (sourceForm.type === 'dingtalk') {
      if (!sourceForm.chatId) {
        message.error(t('source.validation.groupRequired'));
        return;
      }
      const selectedGroup = groupOptions.find((group) => group.value === sourceForm.chatId);
      const chatName = selectedGroup?.label || sourceForm.chatName || '';
      config = JSON.stringify({
        groupId: sourceForm.chatId,
        // 群名用于列表展示和编辑回填，扫描仍以 groupId 为准。
        chatName,
        keyword: sourceForm.keywords || t('source.defaultKeyword'),
        lookbackHours: parseInt(sourceForm.lookbackHours, 10) || 24,
        corpId: dwsAuthDetail?.corpId || '',
      });
    } else if (sourceForm.type === 'dingtalk_todo') {
      // 待办固定拉"派给我(executor)"的未完成项;keyword 过滤研发需求,priority 逗号拼接给 DWS。
      config = JSON.stringify({
        keyword: sourceForm.keywords || t('source.defaultKeyword'),
        priority: (sourceForm.todoPriority || []).join(','),
        corpId: dwsAuthDetail?.corpId || '',
      });
    } else {
      if (!hasPatSaved && !sourceForm.pat.trim()) {
        message.error(t('source.validation.patRequired'));
        return;
      }
      // GitHub 实际扫描仓库由 repoId 关联，config 只保留过滤条件。
      config = JSON.stringify({ labels: sourceForm.labels, state: 'open' });
    }

    sourceSavingRef.current = true;
    setSourceSaving(true);
    try {
      if (sourceForm.type === 'github_issue' && sourceForm.pat.trim()) {
        await saveGitHubPat(sourceForm.pat.trim());
        setHasPatSaved(true);
      }

      if (editingSource) {
        await updateScanSource({
          sourceId: editingSource.sourceId,
          sourceName: sourceForm.name.trim(),
          config,
          cronExpr: sourceForm.cron,
          repoId: sourceForm.repoId,
          confirmMode: sourceForm.confirmMode,
          scoreThreshold: sourceForm.scoreThreshold,
        });
        message.success(t('source.updateSuccess'));
      } else {
        await createScanSource({
          projectId,
          sourceName: sourceForm.name.trim(),
          sourceType: sourceForm.type,
          config,
          cronExpr: sourceForm.cron,
          enabled: '1',
          repoId: sourceForm.repoId,
          confirmMode: sourceForm.confirmMode,
          scoreThreshold: sourceForm.scoreThreshold,
        });
        message.success(t('source.addSuccess'));
      }

      setSourceModalOpen(false);
      setEditingSource(null);
      const sourceList = await fetchSources();
      await fetchRequirements(sourceList, requirementSearchKeyword.trim());
    } catch {
      message.error(t(editingSource ? 'source.updateFailed' : 'source.addFailed'));
    } finally {
      // 保存流程结束后释放提交锁，失败时用户也可以修正表单后再次保存。
      sourceSavingRef.current = false;
      setSourceSaving(false);
    }
  };

  const handleEditSource = (source: ScanSourceItem, readonly = false) => {
    setSourceModalReadonly(readonly);
    setEditingSource(source);
    let config: any = {};
    try {
      config = JSON.parse(source.config || '{}');
    } catch (error) {
      // 历史收集源可能存在非 JSON 配置，编辑时保留空表单继续让用户修正。
      console.error('Failed to parse scan source config:', error);
    }

    setSourceForm({
      type: source.sourceType as SourceType,
      name: source.sourceName,
      chatId: config.groupId || '',
      chatName: config.chatName || '',
      keywords: config.keyword || '',
      lookbackHours: config.lookbackHours ? String(config.lookbackHours) : '24',
      labels: config.labels || '',
      pat: '',
      cron: source.cronExpr || '*/30 * * * *',
      repoId: source.repoId ?? undefined,
      confirmMode: source.confirmMode || 'manual',
      scoreThreshold: source.scoreThreshold ?? 70,
      // 待办优先级 config 存逗号串,回填成多选数组;非待办源为空。
      todoPriority: config.priority ? String(config.priority).split(',').filter(Boolean) : [],
    });
    // 已保存的群名先放入下拉选项，编辑时不需要重新搜索也能展示正确名称。
    if (config.groupId) {
      setGroupOptions([{ value: config.groupId, label: config.chatName || config.groupId }]);
    } else {
      setGroupOptions([]);
    }
    setSourceModalOpen(true);
  };

  const handleCreateRepo = async () => {
    if (!projectId) return;
    if (!repoForm.repoFullName.trim()) {
      message.error(t('repository.validation.fullNameRequired'));
      return;
    }

    setRepoSaving(true);
    try {
      const res = await createProjectRepo({
        projectId,
        repoFullName: repoForm.repoFullName.trim(),
        repoUrl: repoForm.repoUrl.trim() || undefined,
        defaultBranch: repoForm.defaultBranch.trim() || undefined,
      });
      if (!res?.repoId) {
        message.error(t('repository.createFailed'));
        return;
      }
      message.success(t('repository.createSuccess'));
      setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
      await fetchRepos();
      if (repoModalTarget === 'manualRequirement') {
        setManualRequirementForm((prev) => ({ ...prev, repoId: res.repoId }));
      } else {
        setSourceForm((prev) => ({ ...prev, repoId: res.repoId }));
      }
    } catch {
      message.error(t('repository.createFailed'));
    } finally {
      setRepoSaving(false);
    }
  };

  const handleDeleteRepo = (repo: RepoOption) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('repository.deleteConfirm', { name: `${repo.repoFullName || repo.repoUrl || repo.repoId}` }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProjectRepo(repo.repoId);
          message.success(t('repository.deleteSuccess'));
          if (sourceForm.repoId === repo.repoId) {
            setSourceForm((prev) => ({ ...prev, repoId: undefined }));
          }
          if (manualRequirementForm.repoId === repo.repoId) {
            setManualRequirementForm((prev) => ({ ...prev, repoId: undefined }));
          }
          await fetchRepos();
        } catch (error: any) {
          message.error(error?.message || t('repository.deleteFailed'));
        }
      },
    });
  };

  const handleDeleteSource = (source: ScanSourceItem) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('source.deleteConfirm', { name: source.sourceName }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteScanSource(source.sourceId);
        message.success(t('source.deleteSuccess'));
        const sourceList = await fetchSources();
        await fetchRequirements(sourceList, requirementSearchKeyword.trim());
      },
    });
  };

  const handleTriggerScan = async (sourceId: number) => {
    setScanningId(sourceId);
    try {
      const res = await triggerScan(sourceId);
      message.success(t('source.scanSuccess', { count: res?.createdCount || 0 }));
      const sourceList = await fetchSources();
      await fetchRequirements(sourceList, requirementSearchKeyword.trim());
    } catch {
      message.error(t('source.scanFailed'));
    } finally {
      setScanningId(null);
    }
  };

  const handleToggleSource = async (sourceId: number, checked: boolean) => {
    await toggleScanSource(sourceId, checked ? '1' : '0');
    message.success(t(checked ? 'source.enabled' : 'source.paused'));
    await fetchSources();
  };

  const handleViewLogs = async (source: ScanSourceItem) => {
    setLogModalSource(source);
    setLogDrawerOpen(true);
    setLogLoading(true);
    try {
      const logs = (await listScanLogs(source.sourceId, 10)) || [];
      setLogList(logs);
    } finally {
      setLogLoading(false);
    }
  };

  const handleStartTask = async (requirement: RequirementItem) => {
    if (!projectId) return;
    const requirementId = requirement.itemId;
    if (requirement.sessionId || startingRequirementIdsRef.current.has(requirementId)) return;

    startingRequirementIdsRef.current.add(requirementId);
    setStartingRequirementIds((prev) => new Set(prev).add(requirementId));
    try {
      const res = await createTask({
        projectId,
        sourceItemId: requirementId,
        title: requirement.title,
      });
      if (!res) {
        message.error(t('requirement.createTaskFailed'));
        return;
      }

      // 后端 createTask 已建会话(带 projectId)并异步发起对话，前端无需再自建会话回写。
      setRequirements((prev) =>
        prev.map((item) => (item.itemId === requirementId ? { ...item, sessionId: res.sessionId } : item))
      );
      message.success(t('requirement.createTaskSuccess'));
      await Promise.all([
        fetchTasks({ pageNum: 1 }),
        fetchSources().then((sourceList) => fetchRequirements(sourceList, requirementSearchKeyword.trim())),
      ]);
      setActiveTab('tasks');
    } catch (error: any) {
      const errorMessage = error?.message || t('requirement.createTaskFailed');
      message.error(errorMessage);
      if (errorMessage.includes('重复启动') || errorMessage.includes('已有进行中的任务')) {
        // 页面需求数据可能落后于后端任务状态，重复启动失败后主动刷新让按钮状态回到已启动。
        void fetchRequirements(sources, requirementSearchKeyword.trim());
      }
    } finally {
      startingRequirementIdsRef.current.delete(requirementId);
      setStartingRequirementIds((prev) => {
        const next = new Set(prev);
        next.delete(requirementId);
        return next;
      });
    }
  };

  const handleGroupSearch = (value: string) => {
    if (!value || value.length < 2) {
      setGroupOptions([]);
      return;
    }

    if (groupSearchTimerRef.current) {
      clearTimeout(groupSearchTimerRef.current);
    }

    groupSearchTimerRef.current = setTimeout(async () => {
      setGroupSearching(true);
      try {
        const res = await searchDingtalkGroups(value);
        setGroupOptions(
          (res || []).map((group: any) => ({
            value: group.openConversationId,
            label: group.name || group.openConversationId,
          }))
        );
      } catch {
        setGroupOptions([]);
      } finally {
        setGroupSearching(false);
      }
    }, 500);
  };

  const pollDwsAuthStatus = () => {
    if (dwsAuthTimerRef.current) clearInterval(dwsAuthTimerRef.current);
    if (dwsAuthTimeoutRef.current) clearTimeout(dwsAuthTimeoutRef.current);

    dwsAuthTimerRef.current = setInterval(async () => {
      try {
        const res = await checkDwsAuthStatus();
        if (!res?.tokenValid) return;

        if (dwsAuthTimerRef.current) clearInterval(dwsAuthTimerRef.current);
        if (dwsAuthTimeoutRef.current) clearTimeout(dwsAuthTimeoutRef.current);
        dwsAuthTimerRef.current = null;
        dwsAuthTimeoutRef.current = null;
        message.success(t('dws.authorizeSuccess'));
        setDwsAuthed(true);
        setDwsExpired(false);
        setDwsAuthDetail(res);
        if (res.expiresAt) setDwsExpiresAt(res.expiresAt);
        setDwsDeviceInfo(null);
        setDwsAuthPolling(false);
      } catch {
        // 授权轮询失败时继续等下一次，避免临时网络抖动中断流程。
      }
    }, 5000);

    dwsAuthTimeoutRef.current = setTimeout(() => {
      if (dwsAuthTimerRef.current) clearInterval(dwsAuthTimerRef.current);
      dwsAuthTimerRef.current = null;
      dwsAuthTimeoutRef.current = null;
      setDwsDeviceInfo(null);
      setDwsAuthPolling(false);
      message.warning(t('dws.authorizeTimeout'));
    }, 180000);
  };

  const handleStartDwsAuth = async () => {
    setDwsAuthLoading(true);
    try {
      const res = await startDwsDeviceAuth();
      if (res?.userCode && res?.verificationUrl) {
        setDwsDeviceInfo({ userCode: res.userCode, verificationUrl: res.verificationUrl });
        window.open(res.verificationUrl, '_blank');
        setDwsAuthPolling(true);
        pollDwsAuthStatus();
      } else {
        message.error(res?.message || t('dws.authorizeStartFailed'));
      }
    } catch {
      message.error(t('dws.authorizeStartFailed'));
    } finally {
      setDwsAuthLoading(false);
    }
  };

  const repoLabel = (repoId?: number | null) => {
    if (!repoId) return null;
    const repo = repos.find((item) => item.repoId === repoId);
    return repo ? repo.repoFullName || repo.repoUrl || String(repo.repoId) : null;
  };

  // 钉钉/待办源的授权标签:按源创建者的授权状态展示。
  // 创建者本人:可点授权/查看;非创建者:只读展示"创建者{名字}已/未授权",不可点(授权是创建者的事)。
  const renderSourceDwsTag = (source: ScanSourceItem) => {
    const status = sourceDwsStatusMap[source.sourceId] || {};
    const creator = isSourceCreator(source);
    const creatorName = source.createByName || status.creatorName || '';
    const authed = !!status.tokenValid;

    if (creator) {
      // 创建者本人:沿用可点交互(已授权查看详情;未授权/过期点击发起授权)。
      if (authed) {
        return (
          <Tag
            className={`${styles.detailSourceDwsTag} ${styles.detailSourceDwsTagClickable}`}
            color="green"
            onClick={() => setDwsAuthDetailVisible(true)}
          >
            {t('dws.authorized')}
          </Tag>
        );
      }
      return (
        <Tag
          className={`${styles.detailSourceDwsTag} ${styles.detailSourceDwsTagClickable}`}
          color={status.hasToken ? 'red' : 'orange'}
          onClick={handleStartDwsAuth}
        >
          {status.hasToken ? t('dws.authorizationExpired') : t('dws.authorizationRequired')}
        </Tag>
      );
    }

    // 非创建者:只读,不可点。(c) 文案带创建者名。
    return (
      <Tag className={styles.detailSourceDwsTag} color={authed ? 'green' : 'default'}>
        {authed
          ? t('dws.creatorAuthorized', { name: creatorName || t('dws.creatorFallback') })
          : t('dws.creatorNotAuthorized', { name: creatorName || t('dws.creatorFallback') })}
      </Tag>
    );
  };

  const renderSourceList = (emptyText = t('source.empty'), options: { panel?: boolean } = {}) => (
    <Spin spinning={sourcesLoading && !sources.length}>
      {sources.length ? (
        <div className={options.panel ? styles.detailChannelSourceList : styles.detailSourceList}>
          {sources.map((source) => (
            <div key={source.sourceId} className={styles.detailSourceCard}>
              <div className={styles.detailSourceHeader}>
                <span className={styles.detailSourceIcon}>{getSourceIcon(source.sourceType)}</span>
                <div className={styles.detailSourceTitle}>
                  <strong>{source.sourceName}</strong>
                  <span>{formatConfig(source.sourceType, source.config, t)}</span>
                </div>
                <Switch
                  size="small"
                  checked={source.enabled === '1'}
                  onChange={(checked) => handleToggleSource(source.sourceId, checked)}
                />
              </div>
              {(repoLabel(source.repoId) ||
                source.sourceType === 'dingtalk' ||
                source.sourceType === 'dingtalk_todo') && (
                <div className={styles.detailSourceAuth}>
                  {repoLabel(source.repoId) && (
                    <Tag icon={<GithubOutlined />} bordered={false} color="blue">
                      {repoLabel(source.repoId)}
                    </Tag>
                  )}
                  {(source.sourceType === 'dingtalk' || source.sourceType === 'dingtalk_todo') &&
                    renderSourceDwsTag(source)}
                </div>
              )}
              <div
                className={
                  options.panel
                    ? `${styles.detailSourceActions} ${styles.detailSourceActionsPanel}`
                    : styles.detailSourceActions
                }
              >
                <Tag className={styles.detailSourceFrequencyTag} icon={<ClockCircleOutlined />} bordered={false}>
                  {getCronDisplayText(source.cronExpr, t)}
                </Tag>
                {source.lastScanTime && (
                  <span className={styles.detailSourceTime}>
                    {t('source.lastScanAt', { time: dayjs(source.lastScanTime).format('MM-DD HH:mm') })}
                  </span>
                )}
                {/* 大面板内从扫描按钮开始换行，避免渠道信息和操作挤在同一行。 */}
                <div className={styles.detailSourceButtonGroup}>
                  <Button
                    type="link"
                    size="small"
                    icon={<ReloadOutlined spin={scanningId === source.sourceId} />}
                    loading={scanningId === source.sourceId}
                    onClick={() => handleTriggerScan(source.sourceId)}
                  >
                    {t('source.scan')}
                  </Button>
                  <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => handleViewLogs(source)}>
                    {t('source.logs')}
                  </Button>
                  {/* 创建者:可编辑/删除;非创建者:只读查看(复用弹窗,disabled + 无确定按钮)。 */}
                  {isSourceCreator(source) ? (
                    <>
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditSource(source)}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteSource(source)}
                      >
                        {t('common.delete')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="link"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => handleEditSource(source, true)}
                    >
                      {t('common.view')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      )}
    </Spin>
  );

  const handleCloseChannelPanel = () => {
    setChannelPanelOpen(false);
    clearDetailPanel?.();
  };

  const handleToggleChannelPanel = () => {
    if (channelPanelOpen) {
      handleCloseChannelPanel();
      return;
    }
    setChannelPanelOpen(true);
    void fetchSources();
  };

  const handleTabChange = (nextTab: string) => {
    if (nextTab !== 'requirements' && channelPanelOpen) {
      // 渠道配置大面板只服务需求页签；切换到其他页签时立即移除右侧覆盖层。
      handleCloseChannelPanel();
    }
    if (nextTab !== 'integration' && integrationConfigOpen) {
      // 集成测试配置大面板只服务集成测试页签；切换到其他页签时立即移除右侧覆盖层。
      handleCloseIntegrationConfig();
    }
    setActiveTab(nextTab);
  };

  const renderChannelPanel = () => (
    <div className={styles.detailChannelPanel}>
      <div className={styles.detailChannelPanelHeader}>
        <div className={styles.detailChannelPanelTitle}>
          <h3>{t('channel.title')}</h3>
          <p>{t('channel.count', { count: sources.length })}</p>
        </div>
        <div className={styles.detailChannelPanelActions}>
          <Tooltip title={t('channel.add')} placement="top">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openAddSourceModal()}>
              {t('channel.add')}
            </Button>
          </Tooltip>
          <Tooltip title={t('common.close')} placement="top">
            <Button icon={<CloseOutlined />} onClick={handleCloseChannelPanel} />
          </Tooltip>
        </div>
      </div>
      <div className={styles.detailChannelPanelBody}>{renderSourceList(t('channel.empty'), { panel: true })}</div>
    </div>
  );

  useEffect(() => {
    if (!channelPanelOpen) return;
    // 先声明成变量，避免对象字面量在不同分支的 DetailPanelOptions 类型上触发 excess property check。
    const overlayDetailPanelOptions = { overlay: true } as NonNullable<
      Parameters<NonNullable<typeof setDetailPanel>>[1]
    > & { overlay: boolean };
    setDetailPanel?.(renderChannelPanel(), overlayDetailPanelOptions);
  }, [
    channelPanelOpen,
    dwsAuthed,
    dwsExpired,
    dwsExpiresAt,
    project?.projectName,
    repos,
    scanningId,
    setDetailPanel,
    sources,
    sourcesLoading,
    t,
  ]);

  useEffect(() => {
    return () => {
      if (channelPanelOpen) {
        clearDetailPanel?.();
      }
    };
  }, [channelPanelOpen, clearDetailPanel]);

  useEffect(() => {
    if (!channelPanelOpen || activeTab === 'requirements') return;
    // 除点击页签外，启动任务等流程也会直接切换 activeTab；这里兜底关闭渠道配置覆盖层。
    setChannelPanelOpen(false);
    clearDetailPanel?.();
  }, [activeTab, channelPanelOpen, clearDetailPanel]);

  useEffect(() => {
    if (!integrationConfigOpen) return;
    // 与渠道面板同一模式：集成测试配置内容多，用右侧覆盖层承载。
    const overlayDetailPanelOptions = { overlay: true } as NonNullable<
      Parameters<NonNullable<typeof setDetailPanel>>[1]
    > & { overlay: boolean };
    setDetailPanel?.(renderIntegrationConfigPanel(), overlayDetailPanelOptions);
  }, [integrationConfigOpen, setDetailPanel, t]);

  useEffect(() => {
    return () => {
      if (integrationConfigOpen) {
        clearDetailPanel?.();
      }
    };
  }, [integrationConfigOpen, clearDetailPanel]);

  useEffect(() => {
    if (!integrationConfigOpen || activeTab === 'integration') return;
    // 兜底：非点击页签的 activeTab 切换也要关闭集成测试配置覆盖层。
    setIntegrationConfigOpen(false);
    clearDetailPanel?.();
  }, [activeTab, integrationConfigOpen, clearDetailPanel]);

  // 需求列表保持紧凑，完整字段统一在右侧抽屉展示。
  const renderRequirementDetailDrawer = () => {
    if (!detailReq) return null;
    const detail = parseScoreDetail(detailReq.scoreDetail);
    // 内部扫描来源始终为 manual；manualSourceType 保存表单中选定的业务来源。
    const sourceLabel = getSourceLabel(detailReq.manualSourceType || detailReq.sourceType, t);
    const scored = detailReq.score !== null && detailReq.score !== undefined;
    const createTime = detailReq.createTime ? dayjs(detailReq.createTime).format('YYYY-MM-DD HH:mm') : '-';
    const productContent = detail.summary || detailReq.productContent || t('common.emptyValue');
    const originalContent =
      detailReq.originalContent ||
      detailReq.content ||
      detailReq.description ||
      detailReq.summary ||
      t('common.emptyValue');
    return (
      <Drawer
        title={t('requirement.detail.title')}
        className={styles.requirementDetailDrawer}
        open={!!detailReq}
        onClose={() => setDetailReq(null)}
        width={640}
      >
        <div className={styles.requirementDetailDrawerContent}>
          <div className={styles.requirementDetailTitleRow}>
            <div className={styles.requirementDetailTitle}>{detailReq.title}</div>
          </div>

          <section className={styles.requirementDetailSection}>
            <h3>{t('requirement.detail.basicInfo')}</h3>
            <div className={styles.requirementDetailInfoGrid}>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.id')}</label>
                <span>{detailReq.itemId || t('common.emptyValue')}</span>
              </div>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.taskStatus')}</label>
                <span>{t(detailReq.sessionId ? 'requirement.started' : 'requirement.notStarted')}</span>
              </div>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.sourceType')}</label>
                <span>{sourceLabel}</span>
              </div>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.sourceName')}</label>
                <span>{detailReq.sourceName || t('common.emptyValue')}</span>
              </div>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.sourceRecord')}</label>
                <span>{detailReq.originId || t('common.emptyValue')}</span>
              </div>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.createdAt')}</label>
                <span>{createTime}</span>
              </div>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.session')}</label>
                <span>{detailReq.sessionId || t('common.emptyValue')}</span>
              </div>
              <div className={styles.requirementDetailInfoItem}>
                <label>{t('requirement.detail.action')}</label>
                <span>{detailReq.action || t('common.emptyValue')}</span>
              </div>
              {detailReq.originUrl && (
                <div className={`${styles.requirementDetailInfoItem} ${styles.requirementDetailInfoItemFull}`}>
                  <label>{t('requirement.detail.sourceLink')}</label>
                  <a href={detailReq.originUrl} target="_blank" rel="noreferrer">
                    {detailReq.originUrl}
                  </a>
                </div>
              )}
            </div>
          </section>

          <section className={styles.requirementDetailSection}>
            <h3>{t('requirement.detail.productContent')}</h3>
            <div className={styles.requirementDetailText}>{productContent}</div>
          </section>

          <section className={styles.requirementDetailSection}>
            <h3>{t('requirement.detail.originalContent')}</h3>
            <div className={styles.requirementDetailText}>{originalContent}</div>
          </section>

          {scored && (
            <section className={styles.requirementDetailSection}>
              <h3>{t('requirement.detail.scoreDimensions')}</h3>
              <div className={styles.detailScoreDimGrid}>
                {SCORE_DIMENSIONS.map((d) => (
                  <div key={d.key} className={styles.detailScoreDimItem}>
                    <span>{t(d.labelId)}</span>
                    <strong>
                      +{detail[d.key] ?? 0} / {d.max}
                    </strong>
                  </div>
                ))}
                {detail.risk !== null && detail.risk !== undefined && detail.risk !== 0 && (
                  <div className={styles.detailScoreDimItem}>
                    <span>{t('requirement.score.risk')}</span>
                    <strong className={styles.detailScoreRisk}>{detail.risk}</strong>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </Drawer>
    );
  };

  const renderRequirements = () => (
    <div className={styles.detailRequirementsPanel}>
      <div className={styles.detailRequirementsToolbar}>
        <button type="button" className={styles.detailChannelEntry} onClick={handleToggleChannelPanel}>
          <AntdIcon type="icon-chajian" className={styles.detailChannelEntryIcon} />
          <span>
            <strong>{t('channel.requirementConfiguration')}</strong>
          </span>
          {/* 渠道配置覆盖会话区后沿用工作中心入口的返回箭头语义。 */}
          {channelPanelOpen ? <LeftOutlined /> : <RightOutlined />}
        </button>
        <div className={styles.detailRequirementHeader}>
          <div className={`${styles.searchInput} ${styles.detailRequirementSearch}`}>
            <Input
              allowClear
              placeholder={t('requirement.searchPlaceholder')}
              suffix={<SearchOutlined onClick={handleRequirementSearchSubmit} />}
              value={requirementSearchKeyword}
              onChange={(event) => handleRequirementSearchChange(event.target.value)}
              onPressEnter={handleRequirementSearchSubmit}
            />
          </div>
          <Space size={6}>
            <Tooltip title={t('manualRequirement.title')} placement="top">
              <Button
                aria-label={t('manualRequirement.title')}
                size="small"
                className={`${styles.detailHeaderActionButton} ${styles.detailManualRequirementAddButton}`}
                icon={<PlusOutlined />}
                onClick={openManualRequirementModal}
              />
            </Tooltip>
            <Tooltip title={t('common.refresh')} placement="top">
              <Button
                aria-label={t('common.refresh')}
                size="small"
                className={`${styles.detailHeaderActionButton} ${styles.detailRequirementRefreshButton}`}
                icon={<ReloadOutlined />}
                loading={requirementsRefreshLoading}
                disabled={requirementsRefreshLoading}
                onClick={handleRefreshRequirements}
              />
            </Tooltip>
          </Space>
        </div>
      </div>
      {/* 仅需求列表滚动，渠道配置和统计操作始终置顶。 */}
      <div className={styles.detailRequirementScroll} onScroll={handleRequirementListScroll}>
        {/* 手动刷新由按钮反馈；非手动查询才在已有需求列表上显示单一遮罩。 */}
        <Spin spinning={requirementsLoading && hasRequirementVisibleData && !requirementsRefreshLoading}>
          {requirements.length ? (
            <div className={styles.detailRequirementList}>
              {visibleRequirements.map((item) => {
                const isStarting = startingRequirementIds.has(item.itemId);
                const isStarted = item.sessionId !== undefined && item.sessionId !== null;
                // 只有未启动且未处于启动请求中的手工需求可编辑，扫描渠道需求继续保持只读。
                const canOperateManualRequirement = isManualRequirement(item) && !isStarted && !isStarting;
                const isManualRequirementActionOpen = openManualRequirementActionId === `${item.itemId}`;
                const detailText = getRequirementDetailText(item, t);
                const manualRequirementActionItems: MenuProps['items'] = [
                  {
                    key: 'edit',
                    icon: <EditOutlined />,
                    label: t('manualRequirement.action.edit'),
                  },
                  ...(isProjectCreator
                    ? [
                      {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: t('manualRequirement.action.delete'),
                        danger: true,
                      },
                    ]
                    : []),
                ];

                return (
                  <div
                    key={item.itemId}
                    className={`${styles.detailRequirementItem} ${
                      canOperateManualRequirement ? styles.detailRequirementItemWithAction : ''
                    }`}
                    // 卡片点击直接打开右侧详情，列表项始终保持固定高度。
                    onClick={() => setDetailReq(item)}
                  >
                    <div className={styles.detailRequirementSummary}>
                      {/* 需求名称和描述与会话列表保持一致，直接展示且不附加悬停提示。 */}
                      <span className={styles.detailRequirementIcon}>
                        <FileTextOutlined />
                      </span>
                      <div className={styles.detailRequirementMain}>
                        <strong>{item.title}</strong>
                        <span>{detailText}</span>
                      </div>
                      <div
                        className={`${styles.detailRequirementActions} ${
                          isManualRequirementActionOpen ? styles.detailRequirementActionsOpen : ''
                        }`}
                      >
                        {isStarted ? (
                          <Button
                            size="small"
                            className={`${styles.detailRequirementAction} ${styles.detailRequirementStartedAction}`}
                            disabled
                            onClick={(event) => event.stopPropagation()}
                          >
                            {t('requirement.started')}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            className={`${styles.detailRequirementAction} ${styles.detailRequirementStartAction}`}
                            loading={isStarting}
                            disabled={isStarting}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleStartTask(item);
                            }}
                          >
                            {t(isStarting ? 'requirement.starting' : 'requirement.start')}
                          </Button>
                        )}
                        {canOperateManualRequirement && (
                          <Dropdown
                            trigger={['hover']}
                            placement="bottomRight"
                            onOpenChange={(open) =>
                              setOpenManualRequirementActionId(open ? `${item.itemId}` : undefined)
                            }
                            menu={{
                              items: manualRequirementActionItems,
                              onClick: ({ key, domEvent }) => {
                                domEvent.preventDefault();
                                domEvent.stopPropagation();
                                setOpenManualRequirementActionId(undefined);
                                if (key === 'edit') {
                                  openEditManualRequirementModal(item);
                                } else if (key === 'delete') {
                                  handleDeleteManualRequirement(item);
                                }
                              },
                            }}
                          >
                            <Button
                              type="text"
                              size="small"
                              aria-label={t('manualRequirement.action.more')}
                              className={`${styles.detailRequirementMoreAction} ${
                                isManualRequirementActionOpen ? styles.detailRequirementMoreActionOpen : ''
                              }`}
                              icon={<EllipsisOutlined />}
                              loading={deletingManualRequirementId === item.itemId}
                              disabled={deletingManualRequirementId === item.itemId}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onMouseDown={(event) => event.stopPropagation()}
                            />
                          </Dropdown>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {hasMoreRequirements ? (
                <div className={styles.detailRequirementMore}>{t('requirement.loadMore')}</div>
              ) : (
                // 所有需求分段均已展示后，复用数字员工小列表的到底提示。
                !requirementsTabLoading && <ListEndMessage />
              )}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.empty')} />
          )}
        </Spin>
      </div>
      {renderRequirementDetailDrawer()}
    </div>
  );

  // 集成测试演示 mock 数据:环境 + 测试用例集(右侧配置面板与左侧概览共用)。
  const integrationEnvList = [
    {
      id: 'env-aliyun',
      name: '阿里云集成测试环境',
      address: 'https://it-integration.internal:8443',
      branchStrategy: '关联当前任务分支,清库重来',
      status: 'ready' as const,
      middlewares: ['PostgreSQL', 'Redis', 'Kafka', 'MinIO'],
    },
  ];

  // 测试用例集:每个套件是一个独立工程(pytest 的 python 工程 / Playwright 的 node 工程等)。
  const integrationSuiteList: TestSuite[] = [
    {
      id: 'suite-api',
      name: '后端接口回归',
      runner: 'pytest',
      sourceType: 'git',
      source: 'git@git.internal:qa/byclaw-api-e2e.git',
      branch: 'main',
      runCommand: 'pytest -q --maxfail=1 --junitxml=report/junit.xml',
      workdir: '.',
      reportPath: 'report/junit.xml',
      caseCount: 42,
      enabled: true,
    },
    {
      id: 'suite-web',
      name: '前端端到端(UI)',
      runner: 'playwright',
      sourceType: 'git',
      source: 'git@git.internal:qa/byclaw-web-e2e.git',
      branch: 'main',
      runCommand: 'npx playwright test --reporter=junit',
      workdir: '.',
      reportPath: 'results/junit.xml',
      caseCount: 18,
      enabled: true,
    },
    {
      id: 'suite-smoke',
      name: '冒烟用例(共享空间)',
      runner: 'jest',
      sourceType: 'shared',
      source: '/by/testcases/smoke/',
      branch: '',
      runCommand: 'pnpm test:smoke',
      workdir: '.',
      reportPath: 'junit.xml',
      caseCount: 6,
      enabled: false,
    },
    {
      id: 'suite-manual',
      name: '人工验收(无法自动化)',
      runner: 'manual',
      sourceType: 'shared',
      source: '',
      branch: '',
      runCommand: '',
      workdir: '',
      reportPath: '',
      caseCount: 3,
      enabled: true,
      manualCases: [
        {
          id: 'mc-pay',
          title: '微信扫码支付到账',
          steps: '1. 下单选微信支付\n2. 用真机微信扫二维码\n3. 完成支付',
          expected: '订单状态变为「已支付」,后台可见到账流水',
        },
        {
          id: 'mc-print',
          title: '小票打印机出票',
          steps: '1. 订单完成后点「打印小票」\n2. 观察连接的热敏打印机',
          expected: '打印机正常出票,内容与订单一致',
        },
        {
          id: 'mc-sms',
          title: '短信验证码送达',
          steps: '1. 用真实手机号注册\n2. 等待接收短信',
          expected: '60s 内收到验证码,可正常完成注册',
        },
      ],
    },
  ];

  const integrationHistoryList = [
    { runId: 'run-1-12-3', version: 'v1.12.3', passRate: '18/18', result: 'pass' as const, time: '2026-07-27 09:41', round: 3, kickbackTo: '', reason: '' },
    {
      runId: 'run-1-12-2',
      version: 'v1.12.2',
      passRate: '15/18',
      result: 'reject' as const,
      time: '2026-07-26 17:08',
      round: 2,
      kickbackTo: 'coder',
      reason: '登录用例 3 条失败:跨模块调用鉴权头丢失',
    },
    { runId: 'run-1-12-1', version: 'v1.12.1', passRate: '18/18', result: 'pass' as const, time: '2026-07-26 10:22', round: 1, kickbackTo: '', reason: '' },
  ];

  // 结果详情 mock:按 runId 取一次运行的完整结果(status.json + 各套件明细 + 失败截图)。
  const integrationResultMap: Record<string, IntegrationRunResult> = {
    'run-1-12-2': {
      runId: 'run-1-12-2',
      version: 'v1.12.2',
      status: 'failed',
      round: 2,
      branch: 'feature/login-sso',
      commit: 'a3f9c21',
      envName: '阿里云集成测试环境',
      startedAt: '2026-07-26 17:02:14',
      finishedAt: '2026-07-26 17:08:37',
      durationSec: 383,
      totals: { total: 18, passed: 15, failed: 3, skipped: 0 },
      kickbackTo: 'coder',
      reason: '登录用例 3 条失败:跨模块调用鉴权头丢失',
      resultDir: '/opt/byclaw/ci/e2e-results/feature-login-sso/round-2',
      suites: [
        {
          suiteId: 'suite-api', name: '接口回归(pytest)', status: 'passed',
          total: 8, passed: 8, failed: 0, durationSec: 96,
          reportPath: 'reports/suite-api.xml', logPath: 'logs/suite-api.log', failedCases: [],
        },
        {
          suiteId: 'suite-web', name: 'Web 端到端(playwright)', status: 'failed',
          total: 6, passed: 3, failed: 3, durationSec: 214,
          reportPath: 'reports/suite-web.xml', logPath: 'logs/suite-web.log',
          failedCases: [
            { caseId: 'test_login_sso', message: 'AssertionError: 期望跳转工作台,实际停留登录页(鉴权头缺失)', artifacts: ['artifacts/suite-web/test_login_sso.png', 'artifacts/suite-web/test_login_sso.webm'] },
            { caseId: 'test_login_remember', message: 'TimeoutError: 等待 #dashboard 超时 30s', artifacts: ['artifacts/suite-web/test_login_remember.png'] },
            { caseId: 'test_login_logout', message: 'AssertionError: 登出后 session 未清除', artifacts: ['artifacts/suite-web/test_login_logout.png'] },
          ],
        },
        {
          suiteId: 'suite-smoke', name: '冒烟(jest)', status: 'passed',
          total: 4, passed: 4, failed: 0, durationSec: 73,
          reportPath: 'reports/suite-smoke.xml', logPath: 'logs/suite-smoke.log', failedCases: [],
        },
      ],
    },
    'run-1-12-3': {
      runId: 'run-1-12-3',
      version: 'v1.12.3',
      status: 'passed',
      round: 3,
      branch: 'feature/login-sso',
      commit: 'b7e0d55',
      envName: '阿里云集成测试环境',
      startedAt: '2026-07-27 09:35:02',
      finishedAt: '2026-07-27 09:41:18',
      durationSec: 376,
      totals: { total: 18, passed: 18, failed: 0, skipped: 0 },
      kickbackTo: '',
      reason: '',
      resultDir: '/opt/byclaw/ci/e2e-results/feature-login-sso/round-3',
      suites: [
        { suiteId: 'suite-api', name: '接口回归(pytest)', status: 'passed', total: 8, passed: 8, failed: 0, durationSec: 92, reportPath: 'reports/suite-api.xml', logPath: 'logs/suite-api.log', failedCases: [] },
        { suiteId: 'suite-web', name: 'Web 端到端(playwright)', status: 'passed', total: 6, passed: 6, failed: 0, durationSec: 209, reportPath: 'reports/suite-web.xml', logPath: 'logs/suite-web.log', failedCases: [] },
        { suiteId: 'suite-smoke', name: '冒烟(jest)', status: 'passed', total: 4, passed: 4, failed: 0, durationSec: 71, reportPath: 'reports/suite-smoke.xml', logPath: 'logs/suite-smoke.log', failedCases: [] },
      ],
    },
  };

  const openIntegrationResult = (runId: string) => {
    const result = integrationResultMap[runId];
    if (!result) {
      message.info(t('integration.result.notReady'));
      return;
    }
    setIntegrationResult(result);
    setIntegrationResultOpen(true);
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

  // 环境卡片:查看/修改复用「关联环境」弹框(查看态只读),删除走确认弹框(当前演示态仅提示)。
  const openEnvModal = (env: (typeof integrationEnvList)[number], readOnly: boolean) => {
    setIntegrationEnvForm((prev) => ({
      ...prev,
      name: env.name,
      address: env.address,
    }));
    setIntegrationEnvReadOnly(readOnly);
    setIntegrationEnvTab('basic');
    setIntegrationEnvModalOpen(true);
  };

  const handleDeleteEnv = (env: (typeof integrationEnvList)[number]) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('integration.env.deleteConfirm', { name: env.name }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      zIndex: 1200,
      onOk: () => {
        message.info(t('integration.envModal.demoHint'));
      },
    });
  };

  // 用例集卡片:查看/修改复用「新增用例集」弹框(查看态只读),删除走确认弹框(当前演示态仅提示)。
  const openSuiteModal = (suite: TestSuite, readOnly: boolean) => {
    setIntegrationSuiteForm({
      name: suite.name,
      runner: suite.runner,
      sourceType: suite.sourceType,
      source: suite.source,
      branch: suite.branch,
      runCommand: suite.runCommand,
      workdir: suite.workdir,
      reportPath: suite.reportPath,
      manualCases: suite.manualCases ?? [],
    });
    setIntegrationSuiteReadOnly(readOnly);
    setIntegrationSuiteModalOpen(true);
  };

  const handleDeleteSuite = (suite: TestSuite) => {
    Modal.confirm({
      title: t('common.deleteConfirmTitle'),
      content: t('integration.suite.deleteConfirm', { name: suite.name }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      zIndex: 1200,
      onOk: () => {
        message.info(t('integration.envModal.demoHint'));
      },
    });
  };

  // 打开手动测试执行面板:初始化每条用例的空记录。
  const openManualRun = (suite: TestSuite) => {
    const init: typeof manualRunRecords = {};
    (suite.manualCases ?? []).forEach((c) => {
      init[c.id] = { result: '', remark: '', shots: [] };
    });
    setManualRunRecords(init);
    setManualRunSuite(suite);
    setManualRunOpen(true);
  };

  const setManualRecord = (
    caseId: string,
    patch: Partial<{ result: 'pass' | 'fail' | 'skip' | ''; remark: string; shots: string[] }>,
  ) => setManualRunRecords((prev) => ({ ...prev, [caseId]: { ...prev[caseId], ...patch } }));

  const handleCloseIntegrationConfig = () => {
    setIntegrationConfigOpen(false);
    clearDetailPanel?.();
  };

  const handleToggleIntegrationConfig = () => {
    if (integrationConfigOpen) {
      handleCloseIntegrationConfig();
      return;
    }
    setIntegrationConfigOpen(true);
  };

  const phaseLabelOf = (key: string) =>
    integrationFlowPhases.find((p) => p.key === key)?.label ?? key;

  // 左侧集成测试概览:入口按钮(打开右侧配置面板) + 闭环流程条 + 历次结果。内容多的配置移到右侧,避免左栏挤压。
  const renderIntegration = () => (
    <div className={styles.integrationPanel}>
      <button type="button" className={styles.detailChannelEntry} onClick={handleToggleIntegrationConfig}>
        <FundProjectionScreenOutlined className={styles.detailChannelEntryIcon} />
        <span>
          <strong>{t('integration.configEntry')}</strong>
        </span>
        {integrationConfigOpen ? <LeftOutlined /> : <RightOutlined />}
      </button>

      {/* 研发闭环流程条:直观展示 E2E 集成测试环节的位置与"失败打回 coder"的回路。 */}
      <div className={styles.integrationSection}>
        <div className={styles.integrationSectionHeader}>
          <span className={styles.integrationSectionTitle}>{t('integration.flow.title')}</span>
        </div>
        <div className={styles.integrationFlow}>
          {integrationFlowPhases.map((phase, idx) => (
            <React.Fragment key={phase.key}>
              <div className={`${styles.integrationFlowNode} ${styles[`integrationFlowNode_${phase.state}`]}`}>
                <span className={styles.integrationFlowDot}>{phase.state === 'done' ? '✓' : idx + 1}</span>
                <span className={styles.integrationFlowLabel}>
                  {phase.label}
                  {phase.isNew ? (
                    <Tag color="orange" className={styles.integrationFlowNewTag}>
                      {t('integration.flow.newTag')}
                    </Tag>
                  ) : null}
                </span>
              </div>
              {idx < integrationFlowPhases.length - 1 ? <span className={styles.integrationFlowArrow}>→</span> : null}
            </React.Fragment>
          ))}
        </div>
        <div className={styles.integrationFlowKickback}>{t('integration.flow.kickbackHint')}</div>
      </div>

      <div className={styles.integrationSection}>
        <div className={styles.integrationSectionHeader}>
          <span className={styles.integrationSectionTitle}>{t('integration.history.title')}</span>
        </div>
        <List
          size="small"
          bordered
          dataSource={integrationHistoryList}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Tag key="result" color={item.result === 'pass' ? 'success' : 'error'}>
                  {t(item.result === 'pass' ? 'integration.history.pass' : 'integration.history.reject')}
                </Tag>,
                <Button
                  key="view"
                  type="link"
                  size="small"
                  onClick={() => openIntegrationResult(item.runId)}
                >
                  {t('integration.history.viewResult')}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <span>
                    {item.version}
                    <span className={styles.integrationHistoryRound}>
                      {t('integration.history.round', { round: item.round })}
                    </span>
                  </span>
                }
                description={
                  <div>
                    <span className={styles.detailSourceTime}>
                      {t('integration.history.passRate', { rate: item.passRate })} · {item.time}
                    </span>
                    {item.result === 'reject' && item.kickbackTo ? (
                      <div className={styles.integrationHistoryKickback}>
                        {t('integration.history.kickback', { phase: phaseLabelOf(item.kickbackTo) })}
                        {item.reason ? ` · ${item.reason}` : ''}
                      </div>
                    ) : null}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </div>

      <div className={styles.integrationNote}>{t('integration.note')}</div>
    </div>
  );

  // 右侧集成测试配置面板:环境信息 + 测试用例集,空间充足可容纳复杂配置。
  const renderIntegrationConfigPanel = () => (
    <div className={styles.detailChannelPanel}>
      <div className={styles.detailChannelPanelHeader}>
        <div className={styles.detailChannelPanelTitle}>
          <h3>{t('integration.configEntry')}</h3>
          <p>{t('integration.configSubtitle')}</p>
        </div>
        <div className={styles.detailChannelPanelActions}>
          <Tooltip title={t('common.close')} placement="top">
            <Button icon={<CloseOutlined />} onClick={handleCloseIntegrationConfig} />
          </Tooltip>
        </div>
      </div>
      <div className={styles.detailChannelPanelBody}>
        <div className={styles.integrationPanel}>
          {/* 环境信息配置 */}
          <div className={styles.integrationSection}>
            <div className={styles.integrationSectionHeader}>
              <span className={styles.integrationSectionTitle}>{t('integration.env.title')}</span>
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
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
              <div className={styles.detailSourceCard} key={env.id}>
                <div className={styles.detailSourceHeader}>
                  <span className={styles.detailSourceIcon}>
                    <FundProjectionScreenOutlined />
                  </span>
                  <div className={styles.detailSourceTitle}>
                    <strong>{env.name}</strong>
                    <span>{env.address}</span>
                  </div>
                  <Tag color={env.status === 'ready' ? 'success' : 'default'}>
                    {t(env.status === 'ready' ? 'integration.env.statusReady' : 'integration.env.statusUnknown')}
                  </Tag>
                </div>
                <div className={styles.integrationCardBody}>
                  <div className={styles.integrationField}>
                    <span className={styles.integrationFieldLabel}>{t('integration.env.branchStrategy')}</span>
                    <span className={styles.integrationFieldValue}>{env.branchStrategy}</span>
                  </div>
                  <div className={styles.integrationField}>
                    <span className={styles.integrationFieldLabel}>{t('integration.env.middlewares')}</span>
                    <span className={styles.integrationFieldValue}>
                      {env.middlewares.map((m) => (
                        <Tag key={m} className={styles.integrationMwTag}>
                          {m}
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
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteEnv(env)}>
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
                onClick={() => {
                  setIntegrationSuiteReadOnly(false);
                  setIntegrationSuiteModalOpen(true);
                }}
              >
                {t('integration.suite.add')}
              </Button>
            </div>
            <div className={styles.integrationCardGrid}>
            {integrationSuiteList.map((suite) => (
              <div className={styles.detailSourceCard} key={suite.id}>
                <div className={styles.detailSourceHeader}>
                  <span className={styles.detailSourceIcon}>
                    <FileTextOutlined />
                  </span>
                  <div className={styles.detailSourceTitle}>
                    <strong>{suite.name}</strong>
                    <span>
                      {suite.source}
                      {suite.branch ? ` · ${suite.branch}` : ''}
                    </span>
                  </div>
                  <Tag color="processing">{suite.runner}</Tag>
                  <Tag color={suite.enabled ? 'success' : 'default'}>
                    {t(suite.enabled ? 'integration.suite.enabled' : 'integration.suite.disabled')}
                  </Tag>
                </div>
                <div className={styles.integrationCardBody}>
                  {suite.runner === 'manual' ? (
                    <div className={styles.integrationField}>
                      <span className={styles.integrationFieldLabel}>{t('integration.suite.manualCases')}</span>
                      <span className={styles.integrationFieldValue}>
                        {t('integration.suite.caseCount', { count: suite.caseCount })}
                        {' · '}
                        {t('integration.suite.manualHint')}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className={styles.integrationField}>
                        <span className={styles.integrationFieldLabel}>{t('integration.suite.sourceType')}</span>
                        <span className={styles.integrationFieldValue}>
                          {t(suite.sourceType === 'git' ? 'integration.suite.sourceGit' : 'integration.suite.sourceShared')}
                          {' · '}
                          {t('integration.suite.caseCount', { count: suite.caseCount })}
                        </span>
                      </div>
                      <div className={styles.integrationField}>
                        <span className={styles.integrationFieldLabel}>{t('integration.suite.runCommand')}</span>
                        <span className={`${styles.integrationFieldValue} ${styles.integrationMono}`}>{suite.runCommand}</span>
                      </div>
                      <div className={styles.integrationField}>
                        <span className={styles.integrationFieldLabel}>{t('integration.suite.reportPath')}</span>
                        <span className={`${styles.integrationFieldValue} ${styles.integrationMono}`}>{suite.reportPath}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className={styles.integrationCardActions}>
                  {suite.runner === 'manual' ? (
                    <Button type="link" size="small" icon={<PlayCircleOutlined />} onClick={() => openManualRun(suite)}>
                      {t('integration.suite.runManual')}
                    </Button>
                  ) : null}
                  <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openSuiteModal(suite, true)}>
                    {t('common.view')}
                  </Button>
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openSuiteModal(suite, false)}>
                    {t('common.edit')}
                  </Button>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteSuite(suite)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCodeChanges = () => {
    if (!isDevelopProject) return null;
    const empty = (id: string, values?: Record<string, string | number>) => (
      <div className={styles.codeChangeEmpty}>
        {taskChangesLoading ? (
          <Spin size="small" />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(id, values)} />
        )}
      </div>
    );

    let body: React.ReactNode;
    const status = taskChanges?.status;
    if (!currentResourceSession?.sessionId) {
      body = empty('codeChanges.selectSession');
    } else if (taskChangesLoading && !taskChanges) {
      body = empty('codeChanges.loading');
    } else if (!taskChanges || status === 'http_error') {
      body = taskChanges?.message ? (
        <div className={styles.codeChangeEmpty}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={taskChanges.message} />
        </div>
      ) : (
        empty('codeChanges.unavailable')
      );
    } else if (status === 'no_repo') {
      body = empty('codeChanges.noRepository');
    } else if (status === 'no_token') {
      body = empty('codeChanges.noToken');
    } else if (status === 'branch_not_found') {
      body = empty('codeChanges.branchNotFound', { branch: taskChanges.headBranch || '-' });
    } else if (!taskChanges.files?.length) {
      body = empty('codeChanges.noChanges');
    } else {
      body = (
        <div className={styles.codeChangeList}>
          {taskChanges.files.map((file) => {
            const meta = getFileChangeMeta(file.status);
            const { name, dir } = splitFilePath(file.filename);
            const renamedFrom =
              file.status?.toLowerCase() === 'renamed' && file.previousFilename ? file.previousFilename : '';
            // 本地变更点行看 diff(弹 modal);远程变更(有 blobUrl)整行超链到 GitHub 文件页。
            const isLocal = taskChanges?.source === 'local';
            const inner = (
              <>
                <span className={`${styles.codeChangeBadge} ${styles[meta.className]}`} title={t(meta.labelId)}>
                  {meta.letter}
                </span>
                <div className={styles.codeChangeInfo}>
                  <strong className={styles.codeChangeName}>{name}</strong>
                  {/* 深层目录路径:整段展示并挂 title,过长时 CSS 头部省略(rtl)保留尾部目录名,hover 看全路径。 */}
                  <span
                    className={styles.codeChangePath}
                    title={renamedFrom ? `${renamedFrom} → ${file.filename}` : file.filename}
                  >
                    {renamedFrom ? `${renamedFrom} → ${file.filename}` : dir || file.filename}
                  </span>
                </div>
                <div className={styles.codeChangeStat}>
                  {file.additions > 0 && <span className={styles.codeChangeAdd}>+{file.additions}</span>}
                  {file.deletions > 0 && <span className={styles.codeChangeDel}>-{file.deletions}</span>}
                </div>
              </>
            );
            if (file.blobUrl) {
              return (
                <a
                  className={`${styles.codeChangeItem} ${styles.codeChangeItemLink}`}
                  key={file.filename}
                  href={file.blobUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {inner}
                </a>
              );
            }
            if (isLocal) {
              return (
                <button
                  type="button"
                  className={`${styles.codeChangeItem} ${styles.codeChangeItemLink} ${styles.codeChangeItemButton}`}
                  key={file.filename}
                  onClick={() => openFileDiff(file.filename)}
                >
                  {inner}
                </button>
              );
            }
            return (
              <div className={styles.codeChangeItem} key={file.filename}>
                {inner}
              </div>
            );
          })}
        </div>
      );
    }

    const branchLabel = taskChanges?.headBranch || currentResourceSession?.sessionName || '';
    return (
      <div className={styles.codeChangeCard}>
        <div className={styles.codeChangeHeader}>
          <div className={styles.codeChangeHeaderMain}>
            <strong>{t('codeChanges.title')}</strong>
            {branchLabel ? (
              // 分支名即 GitHub 入口:有 compareUrl 就超链到整体比对页,否则纯文本展示。
              taskChanges?.compareUrl ? (
                <a
                  className={`${styles.codeChangeBranch} ${styles.codeChangeBranchLink}`}
                  href={taskChanges.compareUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={t('codeChanges.openInGitHub')}
                >
                  {branchLabel}
                </a>
              ) : (
                <span className={styles.codeChangeBranch}>{branchLabel}</span>
              )
            ) : null}
          </div>
          {status === 'ok' && taskChanges?.files?.length ? (
            <span className={styles.codeChangeCount}>{taskChanges.files.length}</span>
          ) : null}
          <button
            type="button"
            className={styles.codeChangeRefresh}
            onClick={() => void fetchTaskChanges(currentResourceSession?.sessionId)}
            aria-label="refresh"
          >
            <ReloadOutlined spin={taskChangesLoading} />
          </button>
        </div>
        {body}
      </div>
    );
  };

  // 文件 diff modal:逐行渲染 unified diff,行首 +/-/@@ 分别着色,像 git 客户端。
  const renderFileDiffModal = () => {
    const open = !!diffModalFile;
    const lines = parseDiffLines(diffModalData?.diff);
    const status = diffModalData?.status;
    const hasDiff = status === 'ok' && lines.some((l) => l.type === 'add' || l.type === 'del');
    const fileName = diffModalFile ? splitFilePath(diffModalFile).name : '';
    return (
      <Modal
        open={open}
        onCancel={closeFileDiff}
        footer={null}
        width={900}
        title={
          <div className={styles.diffModalTitle}>
            <span className={styles.diffModalName}>{fileName}</span>
            {diffModalFile ? <span className={styles.diffModalPath}>{diffModalFile}</span> : null}
          </div>
        }
        className={styles.diffModal}
      >
        {diffModalLoading ? (
          <div className={styles.diffModalEmpty}>
            <Spin />
          </div>
        ) : !diffModalData || status !== 'ok' ? (
          <div className={styles.diffModalEmpty}>{diffModalData?.message || t('codeChanges.diffUnavailable')}</div>
        ) : !hasDiff ? (
          <div className={styles.diffModalEmpty}>{t('codeChanges.diffEmpty')}</div>
        ) : (
          <div className={styles.diffModalBody}>
            {lines.map((line, idx) => {
              if (line.type === 'meta') return null;
              const cls =
                line.type === 'add'
                  ? styles.diffLineAdd
                  : line.type === 'del'
                    ? styles.diffLineDel
                    : line.type === 'hunk'
                      ? styles.diffLineHunk
                      : styles.diffLineContext;
              return (
                <div className={`${styles.diffLine} ${cls}`} key={idx}>
                  {line.text || ' '}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    );
  };

  const renderResources = () => {
    const currentSessionFiles = currentResourceSession?.sessionId
      ? sessionFilesMap[`${currentResourceSession.sessionId}`] || []
      : [];
    // 项目资源 Tab 仅展示会话和文件树，不展示“几个文件”的统计文本。
    const sessionGroups = (() => {
      if (resourceFileScope === 'all') {
        return projectSessions.map((session) => {
          const sessionResourceId = `${session.sessionId}`;
          const files = sessionFilesMap[sessionResourceId] || [];
          const sessionName = getSessionResourceName(session, t);
          return {
            key: sessionResourceId,
            title: sessionName,
            titleText: sessionName,
            currentPath: getSessionFilePath(sessionResourceId),
            items: files,
            loading: !!sessionFilesLoadingMap[sessionResourceId],
            emptyText: t('resource.emptySessionFiles'),
          };
        });
      }

      if (!currentResourceSession) return [];
      return [
        {
          key: `${currentResourceSession.sessionId}`,
          title: getSessionResourceName(currentResourceSession, t),
          titleText: getSessionResourceName(currentResourceSession, t),
          currentPath: getSessionFilePath(`${currentResourceSession.sessionId}`),
          items: currentSessionFiles,
          loading: !!sessionFilesLoadingMap[`${currentResourceSession.sessionId}`],
          emptyText: t('resource.emptySessionFiles'),
        },
      ];
    })();

    return (
      <div className={styles.detailResourcePanel}>
        <FileSpaceBlock
          title={t('resource.sharedSpace')}
          loading={sharedFilesLoading}
          items={sharedFiles}
          currentPath={SHARED_FILE_PATH}
          emptyText={t('resource.emptySharedFiles')}
          compactTreePadding
          resourceEmptyStyle
          childrenByPath={resourceChildrenByPath}
          expandedKeys={resourceExpandedKeys}
          showActions={!!projectId}
          onRefresh={() => void fetchSharedResourceFiles()}
          onExpand={setResourceExpandedKeys}
          onLoadData={loadResourceTreeNode}
          onNodeClick={handleResourceItemClick}
          onNodeDoubleClick={handleResourceItemDoubleClick}
          getActionItems={getSharedResourceFileActionItems}
          onAction={handleSharedResourceFileAction}
        />
        <FileSpaceBlock
          title={t('resource.sessionSpace')}
          emptyText={t(resourceFileScope === 'all' ? 'resource.emptySessions' : 'resource.emptyCurrentSession')}
          groups={sessionGroups}
          resourceEmptyStyle
          childrenByPath={resourceChildrenByPath}
          expandedKeys={resourceExpandedKeys}
          switchValue={resourceFileScope}
          defaultGroupsCollapsed={resourceFileScope === 'all'}
          // “全部会话”只允许展开一个会话，避免多个文件树同时撑开资源卡片。
          accordionGroups={resourceFileScope === 'all'}
          groupCollapseResetKey={resourceFileScope}
          showActions={!!fileResourceId}
          onRefresh={refreshSessionResourceFiles}
          switchOptions={[
            { label: t('resource.scope.current'), value: 'current' },
            { label: t('resource.scope.all'), value: 'all' },
          ]}
          onSwitchChange={(value) => setResourceFileScope(value as ResourceFileScope)}
          onExpand={setResourceExpandedKeys}
          onLoadData={loadResourceTreeNode}
          onNodeClick={handleResourceItemClick}
          onNodeDoubleClick={handleResourceItemDoubleClick}
          getActionItems={getSessionResourceFileActionItems}
          onAction={handleResourceFileAction}
        />
        {renderCodeChanges()}
        {renderFileDiffModal()}
      </div>
    );
  };

  const renderTasks = () => (
    <div className={styles.detailTaskPanel}>
      <div className={styles.detailTaskHeader}>
        <div className={styles.detailTaskSearchRow}>
          <div className={`${styles.searchInput} ${styles.detailTaskSearch}`}>
            <Input
              allowClear
              placeholder={t('task.searchPlaceholder')}
              suffix={<SearchOutlined onClick={handleTaskSearchSubmit} />}
              value={taskSearchKeyword}
              onChange={(event) => handleTaskSearchChange(event.target.value)}
              onPressEnter={handleTaskSearchSubmit}
            />
          </div>
          {/* 刷新操作固定在搜索框右侧，重载当前筛选条件下的任务第一页。 */}
          <Tooltip title={t('common.refresh')} placement="top">
            <Button
              aria-label={t('common.refresh')}
              size="small"
              className={`${styles.detailHeaderActionButton} ${styles.detailTaskRefreshButton}`}
              icon={<ReloadOutlined />}
              loading={tasksRefreshLoading}
              disabled={tasksLoading}
              onClick={handleRefreshTasks}
            />
          </Tooltip>
        </div>
        {/* 普通项目任务按会话展示，仅隐藏研发项目专用的日期筛选和任务视图入口。 */}
        {isDevelopProject && (
          <div className={styles.detailTaskHeaderActions}>
            <DatePicker.RangePicker
              size="small"
              allowClear
              value={taskDateRange}
              placeholder={[t('task.dateStartPlaceholder'), t('task.dateEndPlaceholder')]}
              presets={taskDatePresets}
              onChange={(dates) => {
                void fetchTasks({ pageNum: 1, dateRange: dates as TaskDateRange });
              }}
            />
            {/* 研发项目始终保留任务视图入口，筛选无结果时仍可查看空态看板。 */}
            <Tooltip title={t('task.viewTooltip')} placement="top">
              <Button
                aria-label={t('task.viewTooltip')}
                size="small"
                className={`${styles.detailHeaderActionButton} ${styles.detailTaskViewButton}`}
                icon={<AppstoreOutlined />}
                onClick={() => setTaskKanbanOpen(true)}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {/* 任务列表独立滚动，研发项目的日期筛选和任务视图入口始终固定在顶部。 */}
      <div className={styles.detailTaskScroll} onScroll={handleTaskListScroll}>
        {/* 手动刷新由按钮反馈，普通搜索才遮罩列表，分页追加只显示底部 loading。 */}
        <Spin spinning={tasksLoading && tasks.length > 0 && !tasksLoadingMore && !tasksRefreshLoading}>
          {tasks.length ? (
            <>
              <div className={styles.detailTaskList}>
                {tasks.map((task) => {
                  const taskAssignee = task.assignee || task.assigneeName || task.agentName || '-';
                  const taskCreateTime = task.createTime ? dayjs(task.createTime).format('MM-DD HH:mm') : '-';
                  // 优先按用户 ID 判断处理人；历史数据缺失 ID 时再用用户名兜底，避免同名用户误判。
                  const isCurrentUserAssignee = isCurrentUserTaskAssignee(task, userInfo);
                  // 非研发项目的任务即会话，第二行直接展示会话摘要；研发项目保留负责人和创建时间。
                  const taskDescription = isDevelopProject
                    ? `${taskAssignee} · ${taskCreateTime}`
                    : `${task.sessionContent || ''}`;
                  const taskStatusMeta = getTaskStatusMeta(task.status || task.taskStatus || task.currentStatus);
                  // 下拉菜单展开时维持状态标签的让位，防止悬浮菜单遮挡右侧内容。
                  const isTaskActionOpen = openTaskActionId === `${task.taskId}`;
                  const isTaskSelected = selectedTaskId === `${task.taskId}`;

                  return (
                    <div
                      key={task.taskId}
                      className={`${styles.detailTaskCard} ${isTaskSelected ? styles.detailTaskCardActive : ''}`}
                      onClick={() => {
                        setSelectedTaskId(`${task.taskId}`);
                        // 研发项目仅允许处理人进入会话，其他成员打开只读任务详情。
                        if (isDevelopProject && !isCurrentUserAssignee) {
                          handleOpenTaskDetail(task);
                          return;
                        }
                        handleOpenTaskSession(task);
                      }}
                    >
                      {isDevelopProject ? (
                        <div className={styles.detailTaskIcon}>
                          {/* 研发任务保持绿色研发图标，区别于普通会话。 */}
                          <FundProjectionScreenOutlined />
                        </div>
                      ) : (
                        <ChatAvatar session={normalizeTaskSession(task, projectId, t)} size={32} />
                      )}
                      <div
                        className={`${styles.detailTaskCardHeader} ${
                          isDevelopProject ? styles.detailTaskCardHeaderWithAction : ''
                        } ${isTaskActionOpen ? styles.detailTaskCardHeaderWithActionOpen : ''}`}
                      >
                        <div className={styles.detailTaskMain}>
                          <div className={styles.detailTaskTitleRow}>
                            <h4 className={styles.detailTaskTitle}>{task.title || t('task.unnamed')}</h4>
                          </div>
                          {/* 任务名称和描述仅用于列表扫读，不显示悬停提示。 */}
                          <p className={styles.detailTaskDescription}>{taskDescription}</p>
                        </div>
                        {/* 非研发项目的任务按普通会话展示，不显示研发任务状态。 */}
                        {isDevelopProject && (
                          <Tag
                            bordered={false}
                            className={`${styles.detailTaskStatusTag} ${
                              styles[`detailTaskStatus${taskStatusMeta.className}`]
                            }`}
                          >
                            {t(taskStatusMeta.labelId)}
                          </Tag>
                        )}
                        {isDevelopProject && (
                          <Dropdown
                            trigger={['hover']}
                            placement="bottomRight"
                            onOpenChange={(open) => setOpenTaskActionId(open ? `${task.taskId}` : undefined)}
                            menu={{
                              items: [{ key: 'view-detail', label: t('task.viewDetail') }],
                              onClick: ({ domEvent }) => {
                                domEvent.preventDefault();
                                domEvent.stopPropagation();
                                setSelectedTaskId(`${task.taskId}`);
                                setOpenTaskActionId(undefined);
                                handleOpenTaskDetail(task);
                              },
                            }}
                          >
                            {/* 研发任务详情改为辅助操作，卡片主点击始终进入任务会话。 */}
                            <Button
                              type="text"
                              size="small"
                              className={`${styles.detailTaskMoreAction} ${
                                isTaskActionOpen ? styles.detailTaskMoreActionOpen : ''
                              }`}
                              icon={<EllipsisOutlined />}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onMouseDown={(event) => event.stopPropagation()}
                            />
                          </Dropdown>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 后端分页没有下一页时展示到底提示，避免任务列表末尾留白。 */}
              {!hasMoreTasks && !tasksLoading && <ListEndMessage />}
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.empty')} />
          )}
          {tasksLoadingMore && tasks.length > 0 && (
            <div className={styles.detailTaskLoadingMore}>
              <Spin size="small" />
            </div>
          )}
        </Spin>
      </div>

      <SessionOverviewDrawer
        open={taskKanbanOpen}
        onClose={() => setTaskKanbanOpen(false)}
        projectId={projectId}
        // 整体任务视图沿用任务列表的处理人校验和进入会话逻辑。
        canEnterSession={(task) => isCurrentUserTaskAssignee(task, userInfo)}
        onEnterSession={(task) => {
          handleOpenTaskSession(task);
          setTaskKanbanOpen(false);
        }}
      />

      <TaskDetailDrawer
        task={detailTask}
        onClose={() => setDetailTask(null)}
        canEnterSession={canEnterDetailTaskSession}
        onEnterSession={(task) => {
          handleOpenTaskSession(task);
          setDetailTask(null);
        }}
        onViewSession={(task) => {
          handleOpenReadonlySession(task);
          setDetailTask(null);
        }}
      />
    </div>
  );

  const renderTabContent = () => {
    if (activeTab === 'requirements' && !showRequirementsTab) {
      return renderTasks();
    }
    if (activeTab === 'tasks') {
      return renderTasks();
    }
    if (activeTab === 'resources') return renderResources();
    if (activeTab === 'integration') {
      if (showRequirementsTab) return renderIntegration();
      return renderTasks();
    }
    if (activeTab === 'members') {
      if (showMembersTab) {
        return (
          <div className={styles.detailEmbeddedContent}>
            <ProjectMemberList
              projectId={projectId}
              creatorId={project?.createBy}
              onMembersChange={handleMembersChange}
              onCurrentUserRemoved={handleCurrentUserRemoved}
            />
          </div>
        );
      }
      return renderTasks();
    }
    return renderRequirements();
  };

  const renderAddSourceModal = () => (
    <Modal
      title={t(sourceModalReadonly ? 'source.viewTitle' : editingSource ? 'source.editTitle' : 'source.addTitle')}
      open={sourceModalOpen}
      onOk={handleSaveSource}
      confirmLoading={sourceSaving}
      onCancel={() => {
        setSourceModalOpen(false);
        setEditingSource(null);
        setSourceModalReadonly(false);
        setGroupOptions([]);
      }}
      okText={t(editingSource ? 'common.save' : 'common.add')}
      // 新增和编辑渠道共用更宽的双列表单空间，仓库选择器不会挤压扫描频率。
      width={760}
      className={styles.sourceModal}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <CancelBtn />
          {/* 只读查看时隐藏确定按钮,仅保留关闭。 */}
          {!sourceModalReadonly && <OkBtn />}
        </Space>
      )}
    >
      <div className={styles.formGrid}>
        <div className={styles.formField}>
          <label>{t('source.field.type')}</label>
          <Select
            value={sourceForm.type}
            disabled={!!editingSource || sourceModalReadonly}
            onChange={(type) => setSourceForm((prev) => ({ ...prev, type }))}
            options={[
              { value: 'github_issue', label: t('source.type.githubIssue') },
              { value: 'dingtalk', label: t('source.type.dingtalkGroup') },
              { value: 'dingtalk_todo', label: t('source.type.dingtalkTodo') },
            ]}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('source.field.name')}</label>
          <Input
            placeholder={t('source.placeholder.name')}
            value={sourceForm.name}
            disabled={sourceModalReadonly}
            onChange={(event) => setSourceForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('source.field.repository')}</label>
          <Space.Compact className={styles.sourceRepoCompact}>
            <Select
              className={styles.sourceRepoSelect}
              placeholder={t('source.placeholder.repository')}
              value={sourceForm.repoId}
              allowClear
              disabled={sourceModalReadonly}
              onChange={(repoId) => setSourceForm((prev) => ({ ...prev, repoId }))}
              options={repos.map((repo) => ({
                value: repo.repoId,
                label: repo.repoFullName || repo.repoUrl || String(repo.repoId),
              }))}
              notFoundContent={repos.length ? undefined : t('source.noRepositories')}
            />
            {!sourceModalReadonly && (
              <Button
                className={styles.sourceRepoAddButton}
                icon={<PlusOutlined />}
                onClick={() => {
                  setRepoModalTarget('source');
                  setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
                  setRepoModalOpen(true);
                }}
              >
                {t('common.add')}
              </Button>
            )}
          </Space.Compact>
        </div>
        <div className={styles.formField}>
          <label>{t('source.field.scanFrequency')}</label>
          <Select
            value={sourceForm.cron}
            disabled={sourceModalReadonly}
            onChange={(cron) => setSourceForm((prev) => ({ ...prev, cron }))}
            options={cronPresets.map((preset) => ({ value: preset.value, label: t(preset.labelId) }))}
            popupClassName={styles.sourceSelectPopup}
          />
        </div>
        <div className={styles.formFieldFull}>
          <div className={styles.formField}>
            <label>{t('source.field.confirmRule')}</label>
            <Radio.Group
              value={sourceForm.confirmMode}
              disabled={sourceModalReadonly}
              onChange={(event) => setSourceForm((prev) => ({ ...prev, confirmMode: event.target.value }))}
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: 'manual', label: t('source.confirm.manual') },
                { value: 'auto', label: t('source.confirm.auto') },
                { value: 'score', label: t('source.confirm.score') },
              ]}
            />
            {sourceForm.confirmMode === 'score' && (
              <div className={styles.sourceScoreRule}>
                {t('source.confirm.scorePrefix')}
                <InputNumber
                  min={0}
                  max={100}
                  value={sourceForm.scoreThreshold}
                  disabled={sourceModalReadonly}
                  onChange={(value) => setSourceForm((prev) => ({ ...prev, scoreThreshold: value ?? 70 }))}
                  className={styles.sourceScoreRuleInput}
                />
                {t('source.confirm.scoreSuffix')}
              </div>
            )}
            <div className={styles.sourceConfirmHint}>
              {sourceForm.confirmMode === 'auto'
                ? t('source.confirm.autoHint')
                : sourceForm.confirmMode === 'score'
                  ? t('source.confirm.scoreHint')
                  : t('source.confirm.manualHint')}
            </div>
          </div>
        </div>
        {!sourceModalReadonly && (sourceForm.type === 'dingtalk' || sourceForm.type === 'dingtalk_todo') && (
          <>
            {!dwsAuthed && (
              <div className={styles.formFieldFull}>
                <div className={styles.formField}>
                  <label>{t('dws.authorization')}</label>
                  {dwsDeviceInfo ? (
                    <div>
                      <p className={styles.dwsAuthorizationInstruction}>{t('dws.authorizationInstruction')}</p>
                      <a href={dwsDeviceInfo.verificationUrl} target="_blank" rel="noreferrer">
                        {dwsDeviceInfo.verificationUrl}
                      </a>
                      <p className={styles.dwsAuthorizationDeviceCode}>
                        {t('dws.deviceCode')}: <strong>{dwsDeviceInfo.userCode}</strong>
                      </p>
                      {dwsAuthPolling && <Spin size="small" />}
                    </div>
                  ) : (
                    <Button
                      type="primary"
                      icon={<DingdingOutlined />}
                      loading={dwsAuthLoading}
                      onClick={handleStartDwsAuth}
                    >
                      {t('dws.authorizeScan')}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {dwsAuthed && (
              <div className={styles.formField}>
                <label>{t('dws.authorization')}</label>
                <Tag color="green">{t('dws.status.authorized')}</Tag>
              </div>
            )}
          </>
        )}
        {sourceForm.type === 'dingtalk' && (
          <>
            <div className={styles.formField}>
              <label>{t('source.field.dingtalkGroup')}</label>
              <Select
                showSearch
                filterOption={false}
                placeholder={t('source.placeholder.groupSearch')}
                value={sourceForm.chatId || undefined}
                disabled={sourceModalReadonly}
                onSearch={handleGroupSearch}
                onChange={(chatId, option) => {
                  const chatName = Array.isArray(option) ? '' : (option?.label as string) || '';
                  setSourceForm((prev) => ({ ...prev, chatId, chatName }));
                }}
                options={groupOptions}
                loading={groupSearching}
                notFoundContent={groupSearching ? <Spin size="small" /> : t('source.groupSearchHint')}
              />
            </div>
            <div className={styles.formField}>
              <label>{t('source.field.keyword')}</label>
              <Input
                placeholder={t('source.placeholder.defaultKeyword')}
                value={sourceForm.keywords}
                disabled={sourceModalReadonly}
                onChange={(event) => setSourceForm((prev) => ({ ...prev, keywords: event.target.value }))}
              />
            </div>
            <div className={styles.formField}>
              <label>{t('source.field.lookbackHours')}</label>
              <Select
                value={sourceForm.lookbackHours}
                disabled={sourceModalReadonly}
                onChange={(lookbackHours) => setSourceForm((prev) => ({ ...prev, lookbackHours }))}
                popupClassName={styles.sourceSelectPopup}
                options={[
                  { value: '6', label: t('source.lookback.hours', { hours: 6 }) },
                  { value: '12', label: t('source.lookback.hours', { hours: 12 }) },
                  { value: '24', label: t('source.lookback.defaultHours', { hours: 24 }) },
                  { value: '48', label: t('source.lookback.hours', { hours: 48 }) },
                  { value: '72', label: t('source.lookback.hours', { hours: 72 }) },
                  { value: '168', label: t('source.lookback.days', { days: 7 }) },
                ]}
              />
            </div>
          </>
        )}
        {sourceForm.type === 'dingtalk_todo' && (
          <>
            <div className={styles.formField}>
              <label>{t('source.field.keyword')}</label>
              <Input
                placeholder={t('source.placeholder.todoKeyword')}
                value={sourceForm.keywords}
                disabled={sourceModalReadonly}
                onChange={(event) => setSourceForm((prev) => ({ ...prev, keywords: event.target.value }))}
              />
            </div>
            <div className={styles.formField}>
              <label>{t('source.field.todoPriority')}</label>
              <Select
                mode="multiple"
                allowClear
                placeholder={t('source.placeholder.todoPriority')}
                value={sourceForm.todoPriority}
                disabled={sourceModalReadonly}
                onChange={(todoPriority) => setSourceForm((prev) => ({ ...prev, todoPriority }))}
                options={[
                  { value: '40', label: t('source.todoPriority.urgent') },
                  { value: '30', label: t('source.todoPriority.high') },
                  { value: '20', label: t('source.todoPriority.normal') },
                  { value: '10', label: t('source.todoPriority.low') },
                ]}
              />
            </div>
          </>
        )}
        {sourceForm.type === 'github_issue' && (
          <>
            {!hasPatSaved && (
              <div className={styles.formField}>
                <label>{t('source.field.githubPat')}</label>
                <Input.Password
                  placeholder={t('source.placeholder.githubPat')}
                  value={sourceForm.pat}
                  disabled={sourceModalReadonly}
                  onChange={(event) => setSourceForm((prev) => ({ ...prev, pat: event.target.value }))}
                />
              </div>
            )}
            <div className={styles.formField}>
              <label>{t('source.field.labelFilter')}</label>
              <Input
                placeholder={t('source.placeholder.labelFilter')}
                value={sourceForm.labels}
                disabled={sourceModalReadonly}
                onChange={(event) => setSourceForm((prev) => ({ ...prev, labels: event.target.value }))}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );

  const renderManualRequirementModal = () => (
    <Modal
      title={
        <div className={styles.manualRequirementTitle}>
          <h3>{t(editingManualRequirement ? 'manualRequirement.editTitle' : 'manualRequirement.title')}</h3>
          <p>{t(editingManualRequirement ? 'manualRequirement.editDescription' : 'manualRequirement.description')}</p>
        </div>
      }
      open={manualRequirementOpen}
      onCancel={() => {
        if (!manualRequirementSubmittingRef.current) {
          setManualRequirementOpen(false);
          setEditingManualRequirement(null);
          setManualRequirementForm(getDefaultManualRequirementForm());
        }
      }}
      onOk={handleManualRequirementSubmit}
      confirmLoading={manualRequirementSubmitting}
      closable={!manualRequirementSubmitting}
      okText={t('manualRequirement.submit')}
      cancelText={t('common.cancel')}
      width={720}
      centered
      className={styles.manualRequirementModal}
    >
      <div className={styles.manualRequirementForm}>
        {/* 原始来源占第一行左侧 50%，影响分支与关联仓库在下一行并排各占 50%。 */}
        <div className={`${styles.formField} ${styles.manualRequirementSourceField}`}>
          <label>{t('manualRequirement.field.sourceType')}</label>
          <Radio.Group
            className={styles.manualRequirementSourceType}
            value={manualRequirementForm.sourceType}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, sourceType: event.target.value }))}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'manual', label: t('manualRequirement.source.manual') },
              { value: 'customer_feedback', label: t('manualRequirement.source.customerFeedback') },
              { value: 'internal_proposal', label: t('manualRequirement.source.internalProposal') },
            ]}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('manualRequirement.field.branch')}</label>
          <Input
            placeholder={t('manualRequirement.placeholder.branch')}
            value={manualRequirementForm.branch}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, branch: event.target.value }))}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('manualRequirement.field.repository')}</label>
          {/* 手工需求与渠道共用项目仓库列表，新增仓库后自动回填当前需求表单。 */}
          <Space.Compact className={styles.manualRequirementRepoCompact}>
            <Select
              className={styles.manualRequirementRepoSelect}
              placeholder={t('manualRequirement.placeholder.repository')}
              value={manualRequirementForm.repoId}
              allowClear
              onChange={(repoId) => setManualRequirementForm((prev) => ({ ...prev, repoId }))}
              options={repos.map((repo) => ({
                value: repo.repoId,
                label: repo.repoFullName || repo.repoUrl || String(repo.repoId),
              }))}
              notFoundContent={repos.length ? undefined : t('manualRequirement.noRepositories')}
            />
            <Button
              className={styles.sourceRepoAddButton}
              icon={<PlusOutlined />}
              onClick={() => {
                setRepoModalTarget('manualRequirement');
                setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
                setRepoModalOpen(true);
              }}
            >
              {t('common.add')}
            </Button>
          </Space.Compact>
        </div>
        <div className={`${styles.formField} ${styles.manualRequirementFormFull}`}>
          <label>{t('manualRequirement.field.title')}</label>
          <Input
            placeholder={t('manualRequirement.placeholder.title')}
            value={manualRequirementForm.title}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>
        <div className={`${styles.formField} ${styles.manualRequirementFormFull}`}>
          <label>{t('manualRequirement.field.originalContent')}</label>
          <div className={styles.manualRequirementTextArea}>
            <span className={styles.manualRequirementTextCount}>
              {manualRequirementForm.originalContent.length}/{MANUAL_REQUIREMENT_CONTENT_MAX_LENGTH}
            </span>
            <Input.TextArea
              maxLength={MANUAL_REQUIREMENT_CONTENT_MAX_LENGTH}
              placeholder={t('manualRequirement.placeholder.originalContent')}
              rows={4}
              value={manualRequirementForm.originalContent}
              onChange={(event) =>
                setManualRequirementForm((prev) => ({ ...prev, originalContent: event.target.value }))
              }
            />
          </div>
        </div>
        <div className={`${styles.formField} ${styles.manualRequirementFormFull}`}>
          <label>{t('manualRequirement.field.productContent')}</label>
          <div className={styles.manualRequirementTextArea}>
            <span className={styles.manualRequirementTextCount}>
              {manualRequirementForm.productContent.length}/{MANUAL_REQUIREMENT_CONTENT_MAX_LENGTH}
            </span>
            <Input.TextArea
              maxLength={MANUAL_REQUIREMENT_CONTENT_MAX_LENGTH}
              placeholder={t('manualRequirement.placeholder.productContent')}
              rows={4}
              value={manualRequirementForm.productContent}
              onChange={(event) =>
                setManualRequirementForm((prev) => ({ ...prev, productContent: event.target.value }))
              }
            />
          </div>
        </div>
      </div>
    </Modal>
  );

  const renderRepoModal = () => (
    <Modal
      title={t('repository.modalTitle')}
      open={repoModalOpen}
      onCancel={() => setRepoModalOpen(false)}
      footer={<Button onClick={() => setRepoModalOpen(false)}>{t('common.close')}</Button>}
      width={560}
      // 仓库弹窗可从渠道或需求弹窗内打开，需要始终覆盖在父弹窗上方。
      zIndex={1100}
    >
      <div className={styles.formField}>
        <label>{t('repository.field.existing')}</label>
        {repos.length ? (
          <List
            size="small"
            bordered
            dataSource={repos}
            renderItem={(repo) => (
              <List.Item
                actions={[
                  <Button
                    key="delete"
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteRepo(repo)}
                  >
                    {t('common.delete')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={repo.repoFullName}
                  description={
                    <span className={styles.repoDescription}>
                      {repo.repoUrl || '-'}
                      {repo.defaultBranch ? ` · ${repo.defaultBranch}` : ''}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('repository.empty')} />
        )}
      </div>
      <div className={styles.repoModalDivider} />
      <div className={styles.formField}>
        <label>{t('repository.field.fullName')}</label>
        <Input
          placeholder={t('repository.placeholder.fullName')}
          value={repoForm.repoFullName}
          onChange={(event) => setRepoForm((prev) => ({ ...prev, repoFullName: event.target.value }))}
        />
      </div>
      <div className={styles.formField}>
        <label>{t('repository.field.url')}</label>
        <Input
          placeholder={t('repository.placeholder.url')}
          value={repoForm.repoUrl}
          onChange={(event) => setRepoForm((prev) => ({ ...prev, repoUrl: event.target.value }))}
        />
      </div>
      <div className={styles.formField}>
        <label>{t('repository.field.defaultBranch')}</label>
        <Input
          placeholder="main"
          value={repoForm.defaultBranch}
          onChange={(event) => setRepoForm((prev) => ({ ...prev, defaultBranch: event.target.value }))}
        />
      </div>
      <Button type="primary" icon={<PlusOutlined />} loading={repoSaving} onClick={handleCreateRepo}>
        {t('repository.create')}
      </Button>
    </Modal>
  );

  // 集成测试「关联环境」弹框：收集环境地址 + 编排方式 + 按类型的差异字段(静态演示,暂不落库)。
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
    const updateCase = (id: string, patch: Partial<ManualCase>) =>
      setIntegrationSuiteForm((prev) => ({
        ...prev,
        manualCases: prev.manualCases.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    const removeCase = (id: string) =>
      setIntegrationSuiteForm((prev) => ({
        ...prev,
        manualCases: prev.manualCases.filter((c) => c.id !== id),
      }));
    const addCase = () =>
      setIntegrationSuiteForm((prev) => ({
        ...prev,
        manualCases: [...prev.manualCases, { id: `mc-${Date.now()}`, title: '', steps: '', expected: '' }],
      }));
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
                <Button
                  key="save"
                  type="primary"
                  onClick={() => {
                    message.info(t('integration.envModal.demoHint'));
                    setIntegrationSuiteModalOpen(false);
                  }}
                >
                  {t('integration.envModal.save')}
                </Button>,
              ]),
        ]}
        width={560}
        zIndex={1100}
      >
        {/* 查看态:整块表单禁用,只读展示。 */}
        <ConfigProvider componentDisabled={integrationSuiteReadOnly}>
        <div className={styles.formField}>
          <label>{t('integration.suiteModal.name')}</label>
          <Input
            placeholder={t('integration.suiteModal.namePlaceholder')}
            value={integrationSuiteForm.name}
            onChange={(e) => setField('name', e.target.value)}
          />
        </div>
        <div className={styles.integrationConnRow}>
          <div className={styles.formField} style={{ flex: 1 }}>
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
            <div className={styles.formField} style={{ flex: 1 }}>
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
        <div className={styles.formField}>
          <label>
            {t(integrationSuiteForm.sourceType === 'git' ? 'integration.suiteModal.gitUrl' : 'integration.suiteModal.sharedPath')}
          </label>
          <Input
            placeholder={
              integrationSuiteForm.sourceType === 'git' ? 'git@git.internal:qa/byclaw-api-e2e.git' : '/by/testcases/smoke/'
            }
            value={integrationSuiteForm.source}
            onChange={(e) => setField('source', e.target.value)}
          />
        </div>
        {integrationSuiteForm.sourceType === 'git' && (
          <div className={styles.formField}>
            <label>{t('integration.suiteModal.branch')}</label>
            <Input
              placeholder="main"
              value={integrationSuiteForm.branch}
              onChange={(e) => setField('branch', e.target.value)}
            />
          </div>
        )}
        <div className={styles.formField}>
          <label>{t('integration.suiteModal.workdir')}</label>
          <Input
            placeholder="."
            value={integrationSuiteForm.workdir}
            onChange={(e) => setField('workdir', e.target.value)}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('integration.suite.runCommand')}</label>
          <Input.TextArea
            className={styles.integrationStageScript}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="pytest -q --junitxml=report/junit.xml"
            value={integrationSuiteForm.runCommand}
            onChange={(e) => setField('runCommand', e.target.value)}
          />
        </div>
        <div className={styles.formField}>
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

        {/* 手动测试:人工检查清单编辑,每条含 标题/步骤/预期。执行时测试人逐条记录结果。 */}
        {isManual && (
          <>
            <div className={styles.integrationSectionHeader}>
              <span className={styles.integrationSectionTitle}>{t('integration.suiteModal.manualCasesTitle')}</span>
              <Button type="link" size="small" icon={<PlusOutlined />} onClick={addCase}>
                {t('integration.suiteModal.addCase')}
              </Button>
            </div>
            <div className={styles.integrationNote}>{t('integration.suiteModal.manualCasesHint')}</div>
            {integrationSuiteForm.manualCases.map((c, idx) => (
              <div className={styles.integrationStageCard} key={c.id}>
                <div className={styles.integrationStageHead}>
                  <span className={styles.integrationStageIdx}>{idx + 1}</span>
                  <Input
                    className={styles.integrationStageName}
                    placeholder={t('integration.suiteModal.caseTitle')}
                    value={c.title}
                    onChange={(e) => updateCase(c.id, { title: e.target.value })}
                  />
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeCase(c.id)}
                  />
                </div>
                <div className={styles.formField}>
                  <label>{t('integration.suiteModal.caseSteps')}</label>
                  <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    placeholder={t('integration.suiteModal.caseStepsPlaceholder')}
                    value={c.steps}
                    onChange={(e) => updateCase(c.id, { steps: e.target.value })}
                  />
                </div>
                <div className={styles.formField}>
                  <label>{t('integration.suiteModal.caseExpected')}</label>
                  <Input.TextArea
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    placeholder={t('integration.suiteModal.caseExpectedPlaceholder')}
                    value={c.expected}
                    onChange={(e) => updateCase(c.id, { expected: e.target.value })}
                  />
                </div>
              </div>
            ))}
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
                <Button
                  key="save"
                  type="primary"
                  onClick={() => {
                    message.info(t('integration.envModal.demoHint'));
                    setIntegrationEnvModalOpen(false);
                  }}
                >
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
        <div className={styles.formField}>
          <label>{t('integration.envModal.name')}</label>
          <Input
            placeholder={t('integration.envModal.namePlaceholder')}
            value={integrationEnvForm.name}
            onChange={(e) => setField('name', e.target.value)}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('integration.envModal.address')}</label>
          <Input
            placeholder="https://it-integration.internal:8443"
            value={integrationEnvForm.address}
            onChange={(e) => setField('address', e.target.value)}
          />
        </div>
        <div className={styles.formField}>
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
            <div className={styles.formField}>
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
                  <div className={styles.formField} style={{ flex: 2 }}>
                    <label>{t('integration.envModal.connHost')}</label>
                    <Input
                      placeholder="10.0.12.34"
                      value={integrationEnvForm.connHost}
                      onChange={(e) => setField('connHost', e.target.value)}
                    />
                  </div>
                  <div className={styles.formField} style={{ flex: 1 }}>
                    <label>{t('integration.envModal.connPort')}</label>
                    <Input
                      placeholder="22"
                      value={integrationEnvForm.connPort}
                      onChange={(e) => setField('connPort', e.target.value)}
                    />
                  </div>
                  <div className={styles.formField} style={{ flex: 1 }}>
                    <label>{t('integration.envModal.connUser')}</label>
                    <Input
                      placeholder="deploy"
                      value={integrationEnvForm.connUser}
                      onChange={(e) => setField('connUser', e.target.value)}
                    />
                  </div>
                </div>
                <div className={styles.integrationConnRow}>
                  <div className={styles.formField} style={{ flex: 1 }}>
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
                  <div className={styles.formField} style={{ flex: 2 }}>
                    <label>{t('integration.envModal.connCredentialRef')}</label>
                    <Input
                      placeholder="it-integration-ssh-key"
                      value={integrationEnvForm.connCredentialRef}
                      onChange={(e) => setField('connCredentialRef', e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
            <div className={styles.formField}>
              <label>{t('integration.envModal.connWorkdir')}</label>
              <Input
                placeholder="/opt/byclaw/ci"
                value={integrationEnvForm.connWorkdir}
                onChange={(e) => setField('connWorkdir', e.target.value)}
              />
            </div>

            {/* 生命周期阶段:每阶段一段完整脚本 */}
            <div className={styles.repoModalDivider} />
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
              <div className={styles.formField} style={{ flex: 1 }}>
                <label>{t('integration.envModal.accRole')}</label>
                <Input
                  placeholder={t('integration.envModal.accRolePlaceholder')}
                  value={acc.role}
                  onChange={(e) => updateAccount(acc.id, { role: e.target.value })}
                />
              </div>
              <div className={styles.formField} style={{ flex: 1 }}>
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
              <div className={styles.formField} style={{ flex: 1 }}>
                <label>{t('integration.envModal.accUsername')}</label>
                <Input
                  placeholder="qa_admin"
                  value={acc.username}
                  onChange={(e) => updateAccount(acc.id, { username: e.target.value })}
                />
              </div>
              <div className={styles.formField} style={{ flex: 1 }}>
                <label>{t('integration.envModal.accCredentialRef')}</label>
                <Input
                  placeholder="it-integration-e2e-admin"
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
    const cases = suite?.manualCases ?? [];
    const decided = cases.filter((c) => manualRunRecords[c.id]?.result).length;
    const hasFail = cases.some((c) => manualRunRecords[c.id]?.result === 'fail');
    const allDecided = cases.length > 0 && decided === cases.length;
    return (
      <Modal
        title={suite ? t('integration.manualRun.title', { name: suite.name }) : t('integration.manualRun.title', { name: '' })}
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
                  onRemove={(file) =>
                    setManualRecord(c.id, { shots: rec.shots.filter((n) => n !== file.name) })
                  }
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
    const statusColor: Record<IntegrationRunResult['status'], string> = {
      passed: 'success',
      failed: 'error',
      error: 'error',
      timeout: 'warning',
    };
    return (
      <Modal
        title={r ? t('integration.result.title', { version: r.version }) : t('integration.result.title', { version: '' })}
        open={integrationResultOpen}
        onCancel={() => setIntegrationResultOpen(false)}
        footer={[
          <Button key="close" onClick={() => setIntegrationResultOpen(false)}>
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
              <Tag color={statusColor[r.status]} className={styles.integrationResultStatusTag}>
                {t(`integration.result.status.${r.status}`)}
              </Tag>
              <span className={styles.integrationResultTotals}>
                {t('integration.result.passOf', { passed: r.totals.passed, total: r.totals.total })}
                {r.totals.failed > 0 ? ` · ${t('integration.result.failCount', { count: r.totals.failed })}` : ''}
              </span>
              <span className={styles.integrationResultDuration}>
                {t('integration.result.duration', { sec: r.durationSec })}
              </span>
            </div>

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

  const renderDwsAuthModal = () => (
    <Modal
      title={t('dws.detailTitle')}
      open={dwsAuthDetailVisible}
      onCancel={() => setDwsAuthDetailVisible(false)}
      footer={[
        <Button
          key="reauth"
          type="primary"
          danger
          onClick={() => {
            setDwsAuthDetailVisible(false);
            handleStartDwsAuth();
          }}
        >
          {t('dws.reauthorize')}
        </Button>,
        <Button key="close" onClick={() => setDwsAuthDetailVisible(false)}>
          {t('common.close')}
        </Button>,
      ]}
    >
      {dwsAuthDetail ? (
        <div className={styles.dwsAuthDetail}>
          <p>
            <strong>{t('dws.field.authStatus')}</strong>
            {dwsAuthDetail.tokenValid ? (
              <Tag color="green">{t('dws.status.valid')}</Tag>
            ) : (
              <Tag color="red">{t('dws.status.invalid')}</Tag>
            )}
          </p>
          <p>
            <strong>{t('dws.field.organizationName')}</strong>
            {dwsAuthDetail.corpName || '-'}
          </p>
          <p>
            <strong>{t('dws.field.userName')}</strong>
            {dwsAuthDetail.userName || '-'}
          </p>
          <p>
            <strong>{t('dws.field.organizationId')}</strong>
            {dwsAuthDetail.corpId || '-'}
          </p>
          <p>
            <strong>{t('dws.field.accessTokenExpiresAt')}</strong>
            {dwsAuthDetail.expiresAt ? dayjs(dwsAuthDetail.expiresAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </p>
          <p>
            <strong>{t('dws.field.refreshTokenStatus')}</strong>
            {dwsAuthDetail.refreshTokenValid ? (
              <Tag color="green">{t('dws.status.valid')}</Tag>
            ) : (
              <Tag color="red">{t('dws.status.expired')}</Tag>
            )}
          </p>
          <p>
            <strong>{t('dws.field.refreshTokenExpiresAt')}</strong>
            {dwsAuthDetail.refreshExpiresAt ? dayjs(dwsAuthDetail.refreshExpiresAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </p>
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dws.emptyAuthorization')} />
      )}
    </Modal>
  );

  const renderLogDrawer = () => (
    <Drawer
      title={t('log.title', { name: logModalSource?.sourceName || '' })}
      open={logDrawerOpen}
      onClose={() => setLogDrawerOpen(false)}
      width={420}
    >
      <Spin spinning={logLoading}>
        {logList.length ? (
          <List
            dataSource={logList}
            renderItem={(log) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <span>
                      {dayjs(log.scanTime).format('YYYY-MM-DD HH:mm:ss')}{' '}
                      <Tag color={log.status === 'success' ? 'green' : log.status === 'failed' ? 'red' : 'blue'}>
                        {t(
                          log.status === 'success'
                            ? 'log.status.success'
                            : log.status === 'failed'
                              ? 'log.status.failed'
                              : 'log.status.running'
                        )}
                      </Tag>
                    </span>
                  }
                  description={
                    log.status === 'success'
                      ? t('log.summary', { found: log.foundCount, created: log.createdCount })
                      : log.errorMsg || ''
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('log.empty')} />
        )}
      </Spin>
    </Drawer>
  );

  const detailActionItems: MenuProps['items'] = [
    ...(showRequirementsTab ? [{ key: 'add-source', label: t('source.addTitle') }] : []),
    ...(onEditProject ? [{ key: 'edit-project', label: t('project.edit') }] : []),
    ...(onDeleteProject ? [{ key: 'delete-project', label: t('project.delete'), danger: true }] : []),
  ];

  const handleDetailAction = ({ key }: { key: string }) => {
    if (key === 'add-source') {
      handleHeaderAdd();
      return;
    }
    if (key === 'edit-project' && project) {
      onEditProject?.(project);
      return;
    }
    if (key === 'delete-project' && project) {
      onDeleteProject?.(project);
    }
  };

  // 文件资源树保留滚动条；其余三个紧凑列表仅隐藏滚动条外观，仍可正常滚动。
  const hideDetailBodyScrollbar = ['requirements', 'tasks', 'members'].includes(activeTab);
  const isRequirementsTab = activeTab === 'requirements';
  const isTasksTab = activeTab === 'tasks' || (activeTab === 'requirements' && !showRequirementsTab);
  const isMembersTab = activeTab === 'members' && showMembersTab;

  return (
    <div className={`${styles.projectDetailPanel} ${detailPanelTabCountClass}`}>
      <div className={styles.detailPanelHeader}>
        <Button className={styles.detailBackButton} icon={<LeftOutlined />} onClick={onBack} />
        <div className={styles.detailPanelTitle}>
          {/* 左侧详情头部仅保留项目名称，避免描述占用会话列表空间。 */}
          <h3>{project?.projectName || t('project.detailTitle')}</h3>
          {projectScene && (
            <Tag
              bordered={false}
              className={`${styles.projectTag} ${styles[`projectTag${projectScene.classSuffix}`]} ${
                styles.detailProjectSceneTag
              }`}
            >
              {projectScene.text}
            </Tag>
          )}
        </div>
        <div className={styles.detailPanelActions}>
          {/* 项目操作集中到悬停展开的三个点菜单，避免详情页头部按钮过多。 */}
          {detailActionItems.length > 0 && (
            <Dropdown trigger={['hover']} menu={{ items: detailActionItems, onClick: handleDetailAction }}>
              <Button className={styles.detailIconButton} icon={<EllipsisOutlined />} />
            </Dropdown>
          )}
        </div>
      </div>
      <div className={styles.detailTabsWrap}>
        <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} />
      </div>
      <Spin spinning={detailSpinning} wrapperClassName={styles.detailSpin}>
        <div
          className={`${styles.detailBodyPanel} ${
            hideDetailBodyScrollbar ? styles.detailBodyPanelScrollbarHidden : ''
          } ${isRequirementsTab ? styles.detailRequirementsBodyPanel : ''} ${
            isTasksTab ? styles.detailTasksBodyPanel : ''
          } ${isMembersTab ? styles.detailMembersBodyPanel : ''}`}
        >
          {renderTabContent()}
        </div>
      </Spin>
      {renderAddSourceModal()}
      {renderManualRequirementModal()}
      {renderRepoModal()}
      {renderIntegrationEnvModal()}
      {renderIntegrationSuiteModal()}
      {renderIntegrationResultModal()}
      {renderManualRunModal()}
      {renderDwsAuthModal()}
      {renderLogDrawer()}
      <RenameModal
        open={resourceRenameOpen}
        currentName={resourceRenameTarget?.name || ''}
        loading={resourceRenameLoading}
        onOk={handleResourceRenameOk}
        onCancel={() => {
          if (resourceRenameLoading) return;
          setResourceRenameOpen(false);
          setResourceRenameTarget(null);
        }}
      />
    </div>
  );
};

export default ProjectDetailPanel;
