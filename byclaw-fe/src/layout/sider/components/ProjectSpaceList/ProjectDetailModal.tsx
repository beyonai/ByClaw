import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
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
  message,
  type MenuProps,
} from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CommentOutlined,
  DeleteOutlined,
  DingdingOutlined,
  EditOutlined,
  EllipsisOutlined,
  EyeOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  GithubOutlined,
  IdcardOutlined,
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
  createOperationAccount,
  createOperationRequirement,
  checkGitHubPat,
  createManualRequirement,
  createProjectRepo,
  createScanSource,
  createTask,
  deleteManualRequirement,
  deleteOperationAccount,
  deleteOperationRequirement,
  deleteProjectSpaceFile,
  deleteProjectRepo,
  deleteScanSource,
  getOperationRequirement,
  getProject,
  getTaskChanges,
  getTaskFileDiff,
  listProjectMembers,
  listOperationAccounts,
  loginOperationAccount,
  listOperationRequirements,
  listOperationTasks,
  listProjectSpaceFiles,
  listProjectSessionsByQo,
  listRequirementsByProject,
  listScanLogs,
  listScanSources,
  listTasks,
  removeProjectMember,
  saveGitHubPat,
  saveProjectFileToSpace,
  renameProjectSpaceFile,
  searchDingtalkGroups,
  startDwsDeviceAuth,
  startOperationRequirement,
  toggleScanSource,
  triggerScan,
  updateManualRequirement,
  updateOperationAccount,
  updateOperationRequirement,
  updateScanSource,
  executeOperationTask,
  type DevloopProjectSpaceFile,
  type DevloopTaskChanges,
  type DevloopTaskFileDiff,
} from '@/service/devloop';
import { deleteFiles, listFiles, renameFile, type FileBrowserItem } from '@/service/fileBrowser';
import { queryMyCreatedAndSubscribedAgentsV2 } from '@/service/digitalEmployees';
import { getResourceListByPage as listKnowledgeBases } from '@/service/knowledgeCenter';
import { listOntologyBases } from '@/service/ontology';
import { getSandboxInfo, launchSandboxByUserCode, navigateSandboxBrowser, type SandboxInfo } from '@/service/sandbox';
import SessionOverviewDrawer from './SessionOverviewDrawer';
import MarkdownField from './components/MarkdownField';
import TaskDetailDrawer from './TaskDetailDrawer';
import {
  OperationAccountPanel,
  OperationRequirementStartModal,
  OperationTaskFormModal,
  OperationWorkflowTimeline,
  type OperationAccount,
  type OperationAccountFormValues,
  type OperationAgentOption,
  type OperationIdentifier,
  type OperationRequirementStartTask,
  type OperationSelectOption,
  type OperationTaskFormValues,
  type OperationTaskType,
  type OperationWorkOption,
  type OperationWorkflowStatus,
  type OperationWorkflowStep,
} from './operation';
import { isCurrentUserTaskAssignee } from './taskAccess';
import { getTaskDateRangePresets, type TaskDateRange } from './taskDatePresets';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import { getArrayData, normalizeProjectSession } from '@/pages/projectSpace/utils';
import AntdIcon from '@/components/AntdIcon';
import ChatAvatar from '@/components/ChatAvatar';
import RenameModal from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import useAppStore from '@/models/common/useAppStore';
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
import { getVNCUrl } from '@/utils/chat';
import { sessionHandler } from '@/utils/session';
import type { ISession } from '@/typescript/session';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { ResourceTypeMap } from '@/constants/resource';
import ProjectMemberList from './ProjectMemberList';
import Integration from './Integration';
import ProjectDefaultAgentPanel from '@/pages/projectSpace/components/ProjectDefaultAgentPanel';
import RequirementSplitModal from './RequirementSplitModal';
import type { SplitTaskDraft } from './RequirementSplitModal/types';
import ListEndMessage from './ListEndMessage';
import styles from './index.module.less';
import operationStyles from './operation/index.module.less';

type SourceType = 'dingtalk' | 'dingtalk_todo' | 'github_issue';

// 四个平台复用采集沙箱中的浏览器，登录入口只维护平台地址，不再创建独立 Recorder 会话。
const OPERATION_PLATFORM_LOGIN_URLS: Record<string, string> = {
  WeChatAccount: 'https://mp.weixin.qq.com/',
  wechat: 'https://mp.weixin.qq.com/',
  Xiaohongshu: 'https://creator.xiaohongshu.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  WeChatChannels: 'https://channels.weixin.qq.com/',
  video: 'https://channels.weixin.qq.com/',
  Douyin: 'https://creator.douyin.com/',
  douyin: 'https://creator.douyin.com/',
};

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

type ChannelSourcePageState = {
  pageNum: number;
  total: number;
};

type ChannelSearchInputProps = {
  keyword: string;
  placeholder: string;
  onKeywordChange: (value: string) => void;
};

const ChannelSearchInput: React.FC<ChannelSearchInputProps> = ({ keyword, placeholder, onKeywordChange }) => {
  const [inputValue, setInputValue] = useState(keyword);

  useEffect(() => {
    setInputValue(keyword);
  }, [keyword]);

  return (
    <Input
      allowClear
      className={styles.detailChannelPanelSearch}
      suffix={<SearchOutlined />}
      placeholder={placeholder}
      value={inputValue}
      onChange={(event) => {
        const value = event.target.value;
        // 输入框在右侧面板内部维护状态，避免每次按键都重新设置整块详情面板而中断中文输入法。
        setInputValue(value);
        onKeywordChange(value);
      }}
    />
  );
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
  if (['待确认', 'confirm', 'waiting_confirmation'].includes(normalizedStatus)) {
    return { labelId: 'task.status.waitingConfirmation', className: 'Paused' };
  }
  if (['失败', 'failed', 'error'].includes(normalizedStatus)) {
    return { labelId: 'task.status.failed', className: 'Failed' };
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

type OperationProjectDetailData = {
  operationAccounts?: unknown[];
  operationChannels?: unknown[];
  accounts?: unknown[];
};

// 个别服务版本会在返回值外包一层 data，统一优先取第一个非空数组，避免表单选项因响应形态不同丢失。
const getFirstOperationArray = (...candidates: unknown[]): any[] => {
  const arrayCandidates = candidates.filter(Array.isArray);
  return arrayCandidates.find((candidate) => candidate.length > 0) || arrayCandidates[0] || [];
};

// 运营账号接口还在联调阶段，这里集中兼容项目详情已返回的三种字段名。
const getOperationAccountSource = (detail?: OperationProjectDetailData | null): Record<string, any>[] => {
  return getFirstOperationArray(detail?.operationAccounts, detail?.operationChannels, detail?.accounts).filter(
    (item): item is Record<string, any> => !!item && typeof item === 'object'
  );
};

// 后端当前有多种登录状态表达，统一为账号卡片使用的固定状态枚举。
const normalizeOperationLoginStatus = (account: Record<string, any>): OperationAccount['loginStatus'] => {
  const status = `${account.loginStatus || account.status || ''}`.trim().toLowerCase();
  if (['logged_in', 'online', 'connected'].includes(status) || account.loggedIn === true) return 'logged_in';
  if (['expired', 'invalid'].includes(status)) return 'expired';
  if (['logged_out', 'offline', 'disconnected'].includes(status) || account.loggedIn === false) return 'logged_out';
  return 'unknown';
};

// 项目详情返回的账号结构未完全统一，依次解析已知的同义字段，保证账号管理和任务表单使用同一数据。
const normalizeOperationAccounts = (detail?: OperationProjectDetailData | null): OperationAccount[] => {
  return getOperationAccountSource(detail)
    .map((item, index) => ({
      id: item.id ?? item.operationAccountId ?? item.accountPkId ?? item.accountId ?? `operation-account-${index}`,
      platformId: `${item.platformId ?? item.platformCode ?? item.platform ?? item.channelId ?? ''}`,
      accountName: item.accountName || item.name || '',
      // 新接口的 accountId 是系统主键，平台侧标识优先读取 accountCode，避免卡片误展示数字主键。
      accountId: `${item.accountCode ?? item.platformAccountId ?? item.platformAccountCode ?? item.accountId ?? ''}`,
      avatar: item.avatar,
      loginStatus: normalizeOperationLoginStatus(item),
      metrics: {
        followers: item.metrics?.followers ?? item.followers,
        works: item.metrics?.works ?? item.worksCount,
        views: item.metrics?.views ?? item.metrics?.reads ?? item.views,
        interactions: item.metrics?.interactions ?? item.interactions,
        followerGrowth: item.metrics?.followerGrowth ?? item.metrics?.growth,
      },
      canEdit: item.canEdit,
    }))
    .filter((item) => item.platformId && item.accountName);
};

// 列表和详情需兼容后端的旧枚举值，前端统一显示三类运营任务。
const normalizeOperationTaskType = (task: any): OperationTaskType => {
  const taskType = `${task?.taskType || task?.operationType || task?.type || ''}`.trim().toLowerCase();
  if (['content', 'publish', 'content_creation', 'content_publish'].includes(taskType)) return 'content';
  if (['analyze', 'analysis', 'analytics', 'data_analysis'].includes(taskType)) return 'analyze';
  return 'collect';
};

// 工作流的运行状态来源不同，下方统一映射给时间轴的状态枚举。
const normalizeOperationWorkflowStatus = (status?: string): OperationWorkflowStatus => {
  const normalizedStatus = `${status || ''}`.trim().toLowerCase();
  if (['doing', 'running', 'in_progress'].includes(normalizedStatus)) return 'in_progress';
  if (['confirm', 'waiting_confirmation', 'paused'].includes(normalizedStatus)) return 'waiting_confirmation';
  if (['done', 'completed', 'success'].includes(normalizedStatus)) return 'completed';
  if (['failed', 'error'].includes(normalizedStatus)) return 'failed';
  return 'pending';
};

// 任务工作流在新老接口中位置不同，按已知字段依次查找并归一化步骤。
const normalizeOperationWorkflow = (task: any): OperationWorkflowStep[] => {
  const workflowCandidates = [
    task?.workflow,
    task?.workflowSteps,
    task?.stages,
    task?.taskState?.stages,
    task?.state?.stages,
  ];
  const workflow = workflowCandidates.find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(workflow)) return [];

  return workflow
    .filter((step) => !!step && typeof step === 'object')
    .map((step: Record<string, any>, index) => ({
      id: step.id ?? step.stageId ?? step.stepId ?? index,
      name: step.name || step.stageName || step.title || `${index + 1}`,
      agentName: step.agentName || step.agent || step.executorName,
      status: normalizeOperationWorkflowStatus(step.status || step.state),
      summary: step.summary || step.detail || step.resultSummary || step.activity,
      startedAt: step.startedAt || step.startTime,
      completedAt: step.completedAt || step.finishTime,
    }));
};

// 运营任务配置可能以 JSON 字符串或对象返回，只接受普通对象避免数组被误当配置读取。
const parseOperationConfig = (rawConfig: unknown): Record<string, any> => {
  if (!rawConfig) return {};
  if (typeof rawConfig === 'object' && !Array.isArray(rawConfig)) return rawConfig as Record<string, any>;
  if (typeof rawConfig !== 'string') return {};
  try {
    const parsedConfig = JSON.parse(rawConfig);
    return parsedConfig && typeof parsedConfig === 'object' && !Array.isArray(parsedConfig) ? parsedConfig : {};
  } catch {
    return {};
  }
};

// 任务详情既可直接返回分类配置，也可把三种配置收在统一对象中，这里优先读取当前任务类型的配置。
const getOperationTaskConfig = (task: any, taskType: OperationTaskType): Record<string, any> => {
  const rootConfig = parseOperationConfig(task?.operationConfig || task?.config);
  const configKey =
    taskType === 'collect' ? 'collectConfig' : taskType === 'content' ? 'contentConfig' : 'analyzeConfig';
  return parseOperationConfig(task?.[configKey] || rootConfig[configKey] || rootConfig);
};

// 运营需求接口以扁平字段加 config 返回；编辑时恢复为表单的三类嵌套配置，避免直接依赖接口响应形态。
const getOperationTaskInitialValues = (task: any): Partial<OperationTaskFormValues> => {
  const taskType = normalizeOperationTaskType(task);
  const config = getOperationTaskConfig(task, taskType);
  const toValidDate = (value?: string) => {
    const date = dayjs(value);
    return date.isValid() ? date : null;
  };
  const toDateRange = (start?: string, end?: string) => {
    const startDate = toValidDate(start);
    const endDate = toValidDate(end);
    return startDate || endDate ? ([startDate, endDate] as [dayjs.Dayjs | null, dayjs.Dayjs | null]) : null;
  };

  return {
    taskName: task?.title || task?.taskName || task?.requirementName || '',
    description: task?.description || '',
    taskType,
    assigneeId: task?.assigneeId ?? task?.assignee,
    dueTime: toValidDate(task?.dueTime || task?.due || task?.deadline),
    collectConfig:
      taskType === 'collect'
        ? {
          ...config,
          channel: config.channel ?? config.collectSource,
          accountOrAddress: config.accountOrAddress ?? config.collectAccount,
          topic: config.topic ?? config.collectTopic,
          dateRange: toDateRange(config.startTime ?? config.collectStart, config.endTime ?? config.collectEnd),
          mode: config.mode ?? config.collectMethod,
          schedule: config.schedule ?? config.collectSchedule,
          organize: Boolean(config.organize ?? config.knowledgeOrganization),
          organizeTemplateId: config.organizeTemplateId ?? config.knowledgeOrganization?.templateId,
          knowledgeOrganization: config.knowledgeOrganization
            ? {
              ...config.knowledgeOrganization,
              // 旧数据只有 templateId，新版弹窗需要显式模式才能正确回显为已有本体。
              mode: config.knowledgeOrganization.mode || 'existing',
              templateId: config.knowledgeOrganization.templateId ?? config.organizeTemplateId,
            }
            : config.organizeTemplateId
              ? { mode: 'existing', templateId: config.organizeTemplateId }
              : undefined,
        }
        : undefined,
    contentConfig:
      taskType === 'content'
        ? {
          ...config,
          topic: config.topic ?? config.publishTopic,
        }
        : undefined,
    analyzeConfig:
      taskType === 'analyze'
        ? {
          ...config,
          platformId: config.platformId ?? config.analysisChannel,
          accountId: config.accountId ?? config.analysisAccountId,
          scope: config.scope ?? config.analysisType,
          workIds: config.workIds ?? config.selectedWorks ?? config.selectedWorkIds,
        }
        : undefined,
  };
};

// 执行数字员工可能以单值、逗号分隔字符串或数组返回，统一为数组后再进行名称匹配。
const normalizeOperationIdentifierList = (rawValue: unknown): OperationIdentifier[] => {
  if (Array.isArray(rawValue)) {
    return rawValue.filter(
      (value): value is OperationIdentifier =>
        (typeof value === 'string' || typeof value === 'number') && `${value}`.trim() !== ''
    );
  }
  if (typeof rawValue === 'number') return [rawValue];
  if (typeof rawValue !== 'string' || !rawValue.trim()) return [];

  try {
    const parsedValue = JSON.parse(rawValue);
    if (Array.isArray(parsedValue)) return normalizeOperationIdentifierList(parsedValue);
  } catch {
    // 非 JSON 字符串继续按逗号分隔格式处理。
  }
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

type ResourceFileScope = 'current' | 'all';
// 资源 Tab 的一级分类统一由顶部切换控制，避免共享文件、会话文件和代码变更被拆成多个卡片。
type ResourceView = 'shared' | 'sessionCurrent' | 'sessionAll' | 'changes';
type ProjectResourceSession = NonNullable<ProjectSpace['sessions']>[number];
type ProjectSpaceFileItem = FileBrowserItem &
  DevloopProjectSpaceFile & {
    isProjectSpaceFile: true;
  };

type Props = {
  project?: ProjectSpace;
  projects?: ProjectSpace[];
  onSwitchProject?: (projectId: string | number) => void;
  onBack: () => void;
  onEditProject?: (project: ProjectSpace) => void;
  onDeleteProject?: (project: ProjectSpace) => void;
  onProjectSharedChange?: (projectId: string | number) => void;
  onCurrentUserRemoved?: (projectId: number) => void;
  developProjectEnabled?: boolean;
  operationProjectEnabled?: boolean;
};

const REQUIREMENT_PAGE_SIZE = 20;
// 任务列表固定页大小，取消分页器后按此值触底追加。
const TASK_PAGE_SIZE = 20;
// 渠道配置大面板按后端分页加载，单页与项目下拉统一为 30 条。
const CHANNEL_SOURCE_PAGE_SIZE = 30;
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

// unified diff 行类型：git diff 输出按行首字符分类，供右侧抽屉逐行着色展示。
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

const isProjectSpaceFile = (item: FileBrowserItem): item is ProjectSpaceFileItem =>
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
  projects,
  onSwitchProject,
  onBack,
  onEditProject,
  onDeleteProject,
  onProjectSharedChange,
  onCurrentUserRemoved,
  developProjectEnabled = false,
  operationProjectEnabled = false,
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
  const [activeTab, setActiveTab] = useState('tasks');
  const [sources, setSources] = useState<ScanSourceItem[]>([]);
  // 每个钉钉/待办源的授权状态(查各自创建者),键为 sourceId。替代旧的全局 dwsAuthed 单一状态。
  const [sourceDwsStatusMap, setSourceDwsStatusMap] = useState<Record<number, SourceDwsStatus>>({});
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  // 运营需求独立于研发扫描需求，启动后才会拆解为运营任务。
  const [operationRequirements, setOperationRequirements] = useState<any[]>([]);
  const [operationRequirementsLoading, setOperationRequirementsLoading] = useState(false);
  const [operationRequirementsRefreshing, setOperationRequirementsRefreshing] = useState(false);
  // 运营需求使用独立详情数据，避免复用研发扫描需求字段后展示无关的来源和评分信息。
  const [operationRequirementDetail, setOperationRequirementDetail] = useState<any>(null);
  const [operationRequirementDetailLoading, setOperationRequirementDetailLoading] = useState(false);
  const [requirementSearchKeyword, setRequirementSearchKeyword] = useState('');
  const [visibleRequirementCount, setVisibleRequirementCount] = useState(REQUIREMENT_PAGE_SIZE);
  const [detailReq, setDetailReq] = useState<RequirementItem | null>(null);
  const [startingRequirementIds, setStartingRequirementIds] = useState<Set<number>>(() => new Set());
  // 拆单弹窗:点「启动」先弹此窗确认多仓库任务拆分,确认后再走真实启动(演示态)。
  const [splitRequirement, setSplitRequirement] = useState<RequirementItem | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [hasMoreTasks, setHasMoreTasks] = useState(false);
  const [taskDateRange, setTaskDateRange] = useState<TaskDateRange>(null);
  const [taskSearchKeyword, setTaskSearchKeyword] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  // 运营任务表单依赖的账号、作品、知识库、数字员工均由详情容器统一加载和归一化。
  const [operationAccounts, setOperationAccounts] = useState<OperationAccount[]>([]);
  const [operationWorks, setOperationWorks] = useState<OperationWorkOption[]>([]);
  const [operationAccountsLoading, setOperationAccountsLoading] = useState(false);
  const [operationKnowledgeBases, setOperationKnowledgeBases] = useState<OperationSelectOption[]>([]);
  const [operationOrganizeTemplates, setOperationOrganizeTemplates] = useState<OperationSelectOption[]>([]);
  const [operationAgents, setOperationAgents] = useState<OperationAgentOption[]>([]);
  const [operationOptionsLoading, setOperationOptionsLoading] = useState(false);
  const [operationAccountSaving, setOperationAccountSaving] = useState(false);
  const [operationAccountDeletingId, setOperationAccountDeletingId] = useState<OperationIdentifier | null>(null);
  // 账号登录复用采集沙箱的远程桌面，面板内仅保留完成登录确认状态。
  const [operationAccountLoginTarget, setOperationAccountLoginTarget] = useState<OperationAccount | null>(null);
  const [operationAccountLoginPreparingId, setOperationAccountLoginPreparingId] = useState<OperationIdentifier | null>(
    null
  );
  const [operationAccountLoginConfirming, setOperationAccountLoginConfirming] = useState(false);
  const operationAccountLoginSandboxIdRef = useRef('');
  const [operationTaskSaving, setOperationTaskSaving] = useState(false);
  const [operationRequirementStartTarget, setOperationRequirementStartTarget] = useState<any>(null);
  const [operationRequirementStarting, setOperationRequirementStarting] = useState(false);
  // 运营任务执行先复用研发任务的多仓库拆分确认弹窗，承接成员绑定的数字员工直接作为执行编排。
  const [operationTaskSplitTarget, setOperationTaskSplitTarget] = useState<any>(null);
  const [operationTaskExecuting, setOperationTaskExecuting] = useState(false);
  const [resourceView, setResourceView] = useState<ResourceView>('shared');
  // 会话资源范围由二级 Tab 决定，避免内容区再次出现重复的“当前/全部”筛选。
  const resourceFileScope: ResourceFileScope = resourceView === 'sessionAll' ? 'all' : 'current';
  const isSessionResourceView = resourceView === 'sessionCurrent' || resourceView === 'sessionAll';
  const [sharedFiles, setSharedFiles] = useState<FileBrowserItem[]>([]);
  const [sharedFilesLoading, setSharedFilesLoading] = useState(false);
  const [resourceSessions, setResourceSessions] = useState<ProjectResourceSession[]>([]);
  const [sessionFilesMap, setSessionFilesMap] = useState<Record<string, FileBrowserItem[]>>({});
  const [sessionFilesLoadingMap, setSessionFilesLoadingMap] = useState<Record<string, boolean>>({});
  const [resourceChildrenByPath, setResourceChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [resourceExpandedKeys, setResourceExpandedKeys] = useState<React.Key[]>([]);
  // 资源 Tab 的代码变更视图按当前会话（任务）拉取远程分支相对基线的文件变更。
  const [taskChanges, setTaskChanges] = useState<DevloopTaskChanges | null>(null);
  const [taskChangesLoading, setTaskChangesLoading] = useState(false);
  // 代码变更文件预览：点文件行拉取 unified diff，并在右侧抽屉中逐行渲染。
  const [diffDrawerFile, setDiffDrawerFile] = useState<string | null>(null);
  const [diffDrawerData, setDiffDrawerData] = useState<DevloopTaskFileDiff | null>(null);
  const [diffDrawerLoading, setDiffDrawerLoading] = useState(false);
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
  // 运营账号信息较多，沿用渠道配置的覆盖式大面板，避免挤压左侧项目详情。
  const [operationAccountPanelOpen, setOperationAccountPanelOpen] = useState(false);
  // 运营任务使用独立表单弹窗，和账号大面板不能同时打开。
  const [operationTaskModalOpen, setOperationTaskModalOpen] = useState(false);
  // 运营需求未启动前允许修改；保存时根据该状态决定调用新增还是编辑接口。
  const [editingOperationTask, setEditingOperationTask] = useState<any>(null);
  const [channelSearchKeyword, setChannelSearchKeyword] = useState('');
  const [channelSources, setChannelSources] = useState<ScanSourceItem[]>([]);
  const [channelSourcesLoading, setChannelSourcesLoading] = useState(false);
  const [channelSourcePage, setChannelSourcePage] = useState<ChannelSourcePageState>({ pageNum: 0, total: 0 });
  const [taskKanbanOpen, setTaskKanbanOpen] = useState(false);
  // 研发任务通过更多操作打开环节详情抽屉，不必先经整体视图。
  const [detailTask, setDetailTask] = useState<any>(null);
  // 记录任务列表最近一次点击项，详情打开或进入会话后仍保留选中反馈。
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  // 菜单展开时保持研发任务的更多操作可见，避免鼠标移入菜单后图标闪动。
  const [openTaskActionId, setOpenTaskActionId] = useState<string>();
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  // 仓库弹窗被渠道、手工需求共用，创建完成后按打开来源回填对应表单。
  // manage: 从详情三个点菜单打开的独立仓库管理入口,建完仓库无需回填任何表单。
  const [repoModalTarget, setRepoModalTarget] = useState<
    'source' | 'manualRequirement' | 'manage' | 'requirementSplit'
  >('source');
  const [repoForm, setRepoForm] = useState({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
  const [repoSaving, setRepoSaving] = useState(false);
  // 仓库弹窗默认看列表,点「新增仓库」再弹出表单(嵌套弹窗),避免列表和表单混在一屏。
  const [repoFormOpen, setRepoFormOpen] = useState(false);
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
  const channelSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelSourceRequestIdRef = useRef(0);
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
  // 状态更新前先占用同步锁，避免运营任务表单双击时重复调用创建接口。
  const operationTaskSubmittingRef = useRef(false);
  // 二次确认弹窗由 Promise 控制 loading，同步标记额外拦截重复触发删除请求。
  const deletingOperationTaskIdRef = useRef<number | null>(null);
  // 删除确认弹窗返回 Promise 时会展示 loading；同步锁用于拦截重复确认。
  const deletingManualRequirementIdRef = useRef<number | null>(null);
  const resourceClickTimerRef = useRef<number | null>(null);
  const requirementQueryVersionRef = useRef(0);
  // 连续点击不同运营需求时仅接收最后一次详情请求，防止慢请求覆盖当前抽屉内容。
  const operationRequirementDetailRequestRef = useRef(0);
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
  const projectScenes = useMemo(() => {
    if (!project) return null;
    if (projectType === 'default') {
      return [{ classSuffix: 'Default', text: intl.formatMessage({ id: 'projectSpace.scene.default' }) }];
    }
    if (projectType === 'develop') {
      return [{ classSuffix: 'Development', text: intl.formatMessage({ id: 'projectSpace.scene.development' }) }];
    }
    if (projectType === 'operation') {
      // 运营标签优先于共享范围展示，详情头部只保留一个项目类型标签。
      return [{ classSuffix: 'Operation', text: intl.formatMessage({ id: 'projectSpace.scene.operation' }) }];
    }
    if (project.sharedFlag) {
      return [{ classSuffix: 'Shared', text: intl.formatMessage({ id: 'projectSpace.scene.shared' }) }];
    }
    return [{ classSuffix: 'Personal', text: intl.formatMessage({ id: 'projectSpace.scene.personal' }) }];
  }, [intl, project, projectType]);
  // 未配置研发项目时，即使存在历史 develop 数据也不展示研发闭环能力。
  const isDevelopProject = developProjectEnabled && projectType === 'develop';
  // 运营能力与项目类型静态参数共用开关，避免未启用的环境误展示运营工作台。
  const isOperationProject = operationProjectEnabled && projectType === 'operation';
  const fileResourceId = activeSiderAgent.resourceId || (project?.resourceId ? `${project.resourceId}` : '');
  const { handlePreview: handleResourcePreview, handleDownload: handleResourceDownload } = useFilePreviewActions({
    resourceId: fileResourceId,
    EventEmitter,
    previewClassName: fileSiderStyles.previewContent,
  });
  // 研发项目展示扫描需求；运营项目展示独立运营需求，两者共用需求页签但数据链路隔离。
  const showRequirementsTab = isDevelopProject || isOperationProject;
  // 集成测试依赖研发仓库和代码任务，运营项目不展示该入口。
  const showIntegrationTab = isDevelopProject;
  const showMembersTab = isDevelopProject || isOperationProject || !!project?.sharedFlag;
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
      if (operationAccountPanelOpen) {
        // 账号管理与任务详情都占用右侧大区域，打开任务详情前先移除账号管理覆盖层。
        setOperationAccountPanelOpen(false);
        clearDetailPanel?.();
      }
      setDetailTask(task);
    },
    [channelPanelOpen, clearDetailPanel, operationAccountPanelOpen]
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
      const sourcePage = await listScanSources({ projectId, pageNum: 1, pageSize: CHANNEL_SOURCE_PAGE_SIZE });
      const sourceList = getArrayData(sourcePage);
      setSources(sourceList);
      void fetchSourceDwsStatuses(sourceList as ScanSourceItem[]);
      return sourceList as ScanSourceItem[];
    } finally {
      setSourcesLoading(false);
    }
  }, [projectId, fetchSourceDwsStatuses]);

  const fetchChannelSources = useCallback(
    async (options: { append?: boolean; keyword?: string; pageNum?: number } = {}) => {
      if (!projectId) return [];
      const { append = false, keyword = channelSearchKeyword, pageNum = 1 } = options;
      const requestId = ++channelSourceRequestIdRef.current;
      setChannelSourcesLoading(true);
      try {
        // 渠道名称搜索和分页均由后端执行，前端只合并已经加载的页数据。
        const sourcePage = await listScanSources({
          projectId,
          keyword: keyword.trim() || undefined,
          pageNum,
          pageSize: CHANNEL_SOURCE_PAGE_SIZE,
        });
        const nextSources = getArrayData(sourcePage) as ScanSourceItem[];
        if (requestId !== channelSourceRequestIdRef.current) return nextSources;
        let mergedSources = nextSources;
        setChannelSources((previousSources) => {
          if (!append) return nextSources;
          const sourceMap = new Map(previousSources.map((source) => [source.sourceId, source]));
          nextSources.forEach((source) => sourceMap.set(source.sourceId, source));
          mergedSources = Array.from(sourceMap.values());
          return mergedSources;
        });
        setChannelSourcePage({
          pageNum: Number(sourcePage?.pageNum ?? pageNum),
          total: Number(sourcePage?.total ?? nextSources.length),
        });
        void fetchSourceDwsStatuses(mergedSources);
        return mergedSources;
      } finally {
        if (requestId === channelSourceRequestIdRef.current) {
          setChannelSourcesLoading(false);
        }
      }
    },
    [channelSearchKeyword, fetchSourceDwsStatuses, projectId]
  );

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

  // 运营需求使用专表和专用接口查询，不能与研发扫描需求混用同一份列表数据。
  const fetchOperationRequirements = useCallback(
    async (keyword = '') => {
      if (!projectId || !isOperationProject) return;
      setOperationRequirementsLoading(true);
      try {
        const page = await listOperationRequirements({
          projectId,
          keyword: keyword.trim() || undefined,
          pageNum: 1,
          pageSize: TASK_PAGE_SIZE,
        });
        const items = Array.isArray(page?.list) ? page.list : [];
        setOperationRequirements(items);
      } finally {
        setOperationRequirementsLoading(false);
      }
    },
    [isOperationProject, projectId]
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
        // 运营任务只读取运营任务表；研发与普通项目仍沿用既有任务/会话接口。
        const taskPage = isOperationProject
          ? await listOperationTasks({
            projectId,
            pageNum: queryState.pageNum,
            pageSize: queryState.pageSize,
            keyword: queryState.taskName || undefined,
            onlyMine: false,
            createTimeStart: queryState.dateRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
            createTimeEnd: queryState.dateRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
          })
          : await listTasks({
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
        // 返回本次查询结果，详情首次加载时据此决定是否自动切换到需求页签。
        return taskList;
      } finally {
        if (append && taskAppendingVersionRef.current === queryVersion) {
          taskAppendingVersionRef.current = null;
          setTasksLoadingMore(false);
        }
        taskRequestCountRef.current = Math.max(0, taskRequestCountRef.current - 1);
        setTasksLoading(taskRequestCountRef.current > 0);
      }
    },
    [isOperationProject, projectId]
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
      if (channelSearchTimerRef.current) clearTimeout(channelSearchTimerRef.current);
    },
    []
  );

  const fetchRepos = useCallback(async () => {
    if (!projectId) return;
    // 仓库仍由项目详情接口提供；运营账号改为专用接口读取，避免依赖未稳定的详情扩展字段。
    const detail = await getProject(projectId);
    setRepos(detail?.repos || []);
  }, [projectId]);

  const fetchOperationAccounts = useCallback(async () => {
    if (!projectId || !isOperationProject) return;
    setOperationAccountsLoading(true);
    try {
      const accountList = await listOperationAccounts(projectId);
      const normalizedAccounts = normalizeOperationAccounts({
        operationAccounts: Array.isArray(accountList) ? accountList : [],
      });
      setOperationAccounts(normalizedAccounts);
      // 作品同步接口尚未接入时不保留上一项目的作品缓存，避免分析任务错误选择跨项目作品。
      setOperationWorks([]);
    } finally {
      setOperationAccountsLoading(false);
    }
  }, [isOperationProject, projectId]);

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

  const fetchOperationAgents = useCallback(async () => {
    try {
      const res = await queryMyCreatedAndSubscribedAgentsV2({ pageNum: 1, pageSize: 100 });
      // 请求封装通常直接返回 list，部分环境仍会保留一层 data，这里兼容两种响应形态。
      const agentList = getFirstOperationArray(res?.list, res?.data?.list);
      setOperationAgents(
        agentList
          .map((agent: any) => ({
            value: agent.resourceId ?? agent.agentId ?? agent.id,
            label: agent.agentName || agent.resourceName || agent.name || '',
            avatar: agent.avatar || agent.avatarUrl,
            description: agent.description || agent.resourceDesc,
            keywords: [agent.agentName, agent.resourceName, agent.name, agent.description].filter(Boolean).join(' '),
          }))
          .filter(
            (agent: OperationAgentOption) =>
              agent.value !== undefined && agent.value !== null && `${agent.value}` !== '' && !!agent.label
          )
      );
    } catch (error) {
      console.error('Failed to load operation agents:', error);
      setOperationAgents([]);
    }
  }, []);

  const fetchOperationKnowledgeBases = useCallback(async () => {
    setOperationOptionsLoading(true);
    try {
      const res = await listKnowledgeBases({
        pageNum: 1,
        pageSize: 100,
        // 与知识库列表页使用相同的业务类型，避免把数字员工等其它资源混入采集知识库选择。
        resourceBizTypeList: [
          ResourceTypeMap.knowledgeBase,
          ResourceTypeMap.knowledgeBaseQa,
          ResourceTypeMap.knowledgeBaseTerm,
        ],
      });
      // 知识库接口在不同版本中使用 rows 或 list，统一归一后再提供给运营任务表单。
      const knowledgeBaseList = getFirstOperationArray(res?.rows, res?.list, res?.data?.rows, res?.data?.list);
      setOperationKnowledgeBases(
        knowledgeBaseList
          .map((knowledgeBase: any) => ({
            value:
              knowledgeBase.resourceId ??
              knowledgeBase.resourceSourcePkId ??
              knowledgeBase.datasetId ??
              knowledgeBase.id,
            label: knowledgeBase.resourceName || knowledgeBase.datasetName || knowledgeBase.name || '',
          }))
          .filter(
            (knowledgeBase: OperationSelectOption) =>
              knowledgeBase.value !== undefined &&
              knowledgeBase.value !== null &&
              `${knowledgeBase.value}` !== '' &&
              !!knowledgeBase.label
          )
      );
    } catch (error) {
      console.error('Failed to load operation knowledge bases:', error);
      setOperationKnowledgeBases([]);
    } finally {
      setOperationOptionsLoading(false);
    }
  }, []);

  const fetchOperationOrganizeTemplates = useCallback(async () => {
    try {
      const res = await listOntologyBases();
      // 本体列表接口可能直接返回数组或包在 data/list 中，统一转换为整理模板下拉选项。
      const ontologyList = getFirstOperationArray(res, res?.list, res?.data, res?.data?.list);
      setOperationOrganizeTemplates(
        ontologyList
          .map((ontology: any) => ({
            value: ontology.baseId ?? ontology.resourceId ?? ontology.id,
            label: ontology.displayName || ontology.resourceName || ontology.name || '',
          }))
          .filter(
            (ontology: OperationSelectOption) =>
              ontology.value !== undefined && ontology.value !== null && `${ontology.value}` !== '' && !!ontology.label
          )
      );
    } catch (error) {
      console.error('Failed to load operation organize templates:', error);
      setOperationOrganizeTemplates([]);
    }
  }, []);

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

  // 运营任务负责人只能从当前项目成员中选择，避免把无项目权限的用户写入任务。
  const operationAssigneeOptions = useMemo<OperationSelectOption[]>(
    () =>
      members
        .map((member) => ({
          value: member.userId ?? member.targetId ?? member.id,
          label: member.userName || member.targetName || member.name || '',
        }))
        .filter(
          (member) => member.value !== undefined && member.value !== null && `${member.value}` !== '' && !!member.label
        ),
    [members]
  );

  // 只有当前登录用户已加入项目时才作为默认负责人和承接成员，避免下拉框出现无效选中值。
  const defaultProjectAssigneeId = useMemo(() => {
    const currentUserId = userInfo?.userId ?? userInfo?.id;
    return operationAssigneeOptions.find((member) => `${member.value}` === `${currentUserId ?? ''}`)?.value;
  }, [operationAssigneeOptions, userInfo?.id, userInfo?.userId]);

  // 将异步加载的数据收敛为需求表单唯一选项入口；数字员工用于执行后的工作流展示，执行时由承接成员绑定关系自动映射。
  const operationTaskOptions = useMemo(
    () => ({
      assignees: operationAssigneeOptions,
      knowledgeBases: operationKnowledgeBases,
      organizeTemplates: operationOrganizeTemplates,
      accounts: operationAccounts,
      works: operationWorks,
    }),
    [operationAccounts, operationAssigneeOptions, operationKnowledgeBases, operationOrganizeTemplates, operationWorks]
  );

  // 关闭账号登录时同步收起全局远程桌面，避免切换账号或项目后保留旧平台页面。
  const handleCloseOperationAccountRemoteDesktop = useCallback(() => {
    operationAccountLoginSandboxIdRef.current = '';
    setOperationAccountLoginTarget(null);
    setOperationAccountLoginPreparingId(null);
    setOperationAccountLoginConfirming(false);
    EventEmitter.emit('beyond-main-driver-open-type', '');
  }, [EventEmitter]);

  // 覆盖式账号面板关闭时必须同时清理右侧详情容器和远程桌面，避免遗留遮罩层。
  const handleCloseOperationAccountPanel = useCallback(() => {
    handleCloseOperationAccountRemoteDesktop();
    setOperationAccountPanelOpen(false);
    setOperationAccountDeletingId(null);
    clearDetailPanel?.();
  }, [clearDetailPanel, handleCloseOperationAccountRemoteDesktop]);

  // 账号管理只服务运营项目；打开前关闭需求详情、任务详情和整体视图，防止多个大面板重叠。
  const handleOpenOperationAccountPanel = useCallback(() => {
    if (!isOperationProject) return;
    // 从项目更多菜单进入账号页面时先切回需求页，确保覆盖式账号面板不会被其它页签的副作用关闭。
    setActiveTab('requirements');
    operationRequirementDetailRequestRef.current += 1;
    setOperationRequirementDetail(null);
    setOperationRequirementDetailLoading(false);
    setDetailTask(null);
    setTaskKanbanOpen(false);
    setOperationTaskModalOpen(false);
    setOperationAccountPanelOpen(true);
  }, [isOperationProject]);

  // 账号管理与新增运营需求共用同一账号接口，保存成功后统一刷新，避免本地草稿与服务端数据不一致。
  const handleSaveOperationAccount = useCallback(
    async (values: OperationAccountFormValues, account?: OperationAccount | null) => {
      if (!projectId) return;
      setOperationAccountSaving(true);
      try {
        const payload = {
          projectId,
          platformCode: values.platformId,
          accountCode: values.accountId,
          accountName: values.accountName,
        };
        if (account) {
          await updateOperationAccount({ ...payload, accountId: account.id });
        } else {
          await createOperationAccount(payload);
        }
        await fetchOperationAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.saveSuccess' }));
      } finally {
        setOperationAccountSaving(false);
      }
    },
    [fetchOperationAccounts, intl, projectId]
  );

  // 删除账号使用后端软删除；若账号正在登录，先关闭远程桌面避免继续操作已失效账号。
  const handleDeleteOperationAccount = useCallback(
    async (account: OperationAccount) => {
      setOperationAccountDeletingId(account.id);
      try {
        await deleteOperationAccount(account.id);
        if (`${operationAccountLoginTarget?.id ?? ''}` === `${account.id}`) {
          handleCloseOperationAccountRemoteDesktop();
        }
        await fetchOperationAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.deleteSuccess' }));
      } finally {
        setOperationAccountDeletingId(null);
      }
    },
    [fetchOperationAccounts, handleCloseOperationAccountRemoteDesktop, intl, operationAccountLoginTarget?.id]
  );

  // 优先复用采集流程已经启动的沙箱；首次使用尚无沙箱时按当前用户启动默认 openclaw 沙箱。
  const resolveOperationAccountSandbox = useCallback(async (): Promise<SandboxInfo> => {
    const currentSandboxes = await getSandboxInfo({});
    const runningSandbox =
      currentSandboxes.find((sandbox) => sandbox.status === 'RUNNING' && !!sandbox.sandboxId) ||
      currentSandboxes.find((sandbox) => !!sandbox.sandboxId);
    if (runningSandbox) {
      useAppStore.setState({ sandboxesInfo: runningSandbox });
      return runningSandbox;
    }
    if (!userInfo?.userCode) throw new Error('missing_user_code');
    const launchedSandbox = await launchSandboxByUserCode({ userCode: userInfo.userCode, serviceKey: 'openclaw' });
    const sandboxInfo: SandboxInfo = {
      ...launchedSandbox,
      userCode: userInfo.userCode,
      sandboxType: 'byclaw',
      status: 'RUNNING',
    };
    useAppStore.setState({ sandboxesInfo: sandboxInfo });
    return sandboxInfo;
  }, [userInfo?.userCode]);

  // 沙箱准备完成后立即打开远程桌面，再异步导航登录页，避免导航等待期间用户看不到扫码入口。
  const handleLoginOperationAccount = useCallback(
    async (account: OperationAccount) => {
      const loginUrl = OPERATION_PLATFORM_LOGIN_URLS[account.platformId];
      if (!loginUrl || operationAccountLoginPreparingId !== null) return;
      setOperationAccountLoginPreparingId(account.id);
      try {
        const sandboxInfo = await resolveOperationAccountSandbox();
        operationAccountLoginSandboxIdRef.current = sandboxInfo.sandboxId;
        setOperationAccountLoginTarget(account);
        EventEmitter.emit('beyond-main-driver-open-type', {
          drawerType: 'vnc',
          title: intl.formatMessage({ id: 'projectSpace.operation.accountLogin.remoteDesktop' }),
          canClose: true,
          // 账号管理页保持原位，远程桌面只覆盖右侧区域，不参与主页面宽度计算。
          overlay: true,
          width: '50vw',
        });
        EventEmitter.emit('beyond-main-driver-message', {
          url: getVNCUrl(sandboxInfo),
        });
        try {
          await navigateSandboxBrowser({
            sandboxId: sandboxInfo.sandboxId,
            targetUrl: loginUrl,
            sessionKey: `operation-account-${account.id}`,
          });
        } catch {
          // 导航失败时保留远程桌面，用户仍可在沙箱浏览器中手工进入对应平台完成登录。
          message.warning(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.navigateFailed' }));
        }
      } catch {
        message.error(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.startFailed' }));
      } finally {
        setOperationAccountLoginPreparingId(null);
      }
    },
    [EventEmitter, intl, operationAccountLoginPreparingId, resolveOperationAccountSandbox]
  );

  const handleConfirmOperationAccountLogin = useCallback(async () => {
    const sandboxId = operationAccountLoginSandboxIdRef.current;
    if (!operationAccountLoginTarget || !sandboxId || operationAccountLoginConfirming) return;
    setOperationAccountLoginConfirming(true);
    try {
      await loginOperationAccount(operationAccountLoginTarget.id, sandboxId);
      await fetchOperationAccounts();
      message.success(intl.formatMessage({ id: 'projectSpace.operation.account.loginSuccess' }));
      handleCloseOperationAccountRemoteDesktop();
    } catch {
      message.error(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.confirmFailed' }));
    } finally {
      setOperationAccountLoginConfirming(false);
    }
  }, [
    fetchOperationAccounts,
    handleCloseOperationAccountRemoteDesktop,
    intl,
    operationAccountLoginConfirming,
    operationAccountLoginTarget,
  ]);

  // 新增运营需求时重新读取关联资源，确保成员、账号和知识库均为最新数据。
  const handleOpenOperationTaskModal = useCallback(() => {
    if (!isOperationProject) return;
    // 从任意页签新增运营需求时切回需求页，保证需求表单组件已经挂载。
    setActiveTab('requirements');
    if (operationAccountPanelOpen) handleCloseOperationAccountPanel();
    setEditingOperationTask(null);
    setOperationTaskModalOpen(true);
    // 数字员工改到任务执行阶段选择，需求表单只刷新当前原型要求的关联资源。
    void Promise.allSettled([
      fetchRepos(),
      fetchOperationAccounts(),
      fetchOperationKnowledgeBases(),
      fetchOperationOrganizeTemplates(),
    ]);
  }, [
    fetchRepos,
    fetchOperationAccounts,
    fetchOperationKnowledgeBases,
    fetchOperationOrganizeTemplates,
    handleCloseOperationAccountPanel,
    isOperationProject,
    operationAccountPanelOpen,
  ]);

  // 只有尚未启动的运营需求可以编辑；任务已拆解后需求配置需保持稳定以便追溯。
  const handleOpenEditOperationTaskModal = useCallback(
    (task: any) => {
      if (!isOperationProject || task?.status !== 'todo') return;
      setDetailTask(null);
      setEditingOperationTask(task);
      setOperationTaskModalOpen(true);
      // 编辑旧需求时也重新读取已有本体，确保整理模板名称能正确回显。
      void fetchOperationOrganizeTemplates();
    },
    [fetchOperationOrganizeTemplates, isOperationProject]
  );

  // 运营需求提交前统一序列化日期，并将页面字段转换为运营需求接口约定的三类配置结构。
  const handleSubmitOperationTask = useCallback(
    async (values: OperationTaskFormValues) => {
      if (!projectId || operationTaskSubmittingRef.current) return;
      const editingOperationTaskId = Number(editingOperationTask?.itemId ?? editingOperationTask?.taskId);
      const isEditingOperationTask = Number.isFinite(editingOperationTaskId) && editingOperationTaskId > 0;

      // 表单保存 Dayjs，接口只接收标准时间字符串；开始、结束时间按整天边界计算。
      const serializeDateRange = (dateRange?: NonNullable<OperationTaskFormValues['collectConfig']>['dateRange']) => ({
        startTime: dateRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
        endTime: dateRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
      });
      const collectDateRange = serializeDateRange(values.collectConfig?.dateRange);
      // 页面内部字段保留在配置中，同时补齐接口文档中的稳定字段名，后端执行能力可直接按该结构读取。
      const config =
        values.taskType === 'collect'
          ? {
            ...values.collectConfig,
            dateRange: undefined,
            ...collectDateRange,
            collectSource: values.collectConfig?.channel,
            collectAccount: values.collectConfig?.accountOrAddress,
            collectTopic: values.collectConfig?.topic,
            collectStart: collectDateRange.startTime?.slice(0, 10),
            collectEnd: collectDateRange.endTime?.slice(0, 10),
            collectMethod: values.collectConfig?.mode,
            collectSchedule: values.collectConfig?.schedule,
            // 兼容旧执行服务读取 templateId，同时完整保存新增本体的整理需求和结构化要求。
            organizeTemplateId: values.collectConfig?.knowledgeOrganization?.templateId,
            knowledgeOrganization: values.collectConfig?.organize
              ? values.collectConfig?.knowledgeOrganization || null
              : null,
          }
          : values.taskType === 'content'
            ? {
              ...values.contentConfig,
              publishTopic: values.contentConfig?.topic,
            }
            : {
              ...values.analyzeConfig,
              analysisChannel: values.analyzeConfig?.platformId,
              analysisAccountId: values.analyzeConfig?.accountId,
              analysisType: values.analyzeConfig?.scope,
              // selectedWorks 是运营需求接口约定字段；同时保留旧字段兼容后续执行服务的历史读取逻辑。
              selectedWorks: values.analyzeConfig?.workIds || [],
              selectedWorkIds: values.analyzeConfig?.workIds || [],
            };

      operationTaskSubmittingRef.current = true;
      setOperationTaskSaving(true);
      try {
        const operationRequirementPayload = {
          requirementName: values.taskName.trim(),
          description: values.description?.trim() || undefined,
          operationType: values.taskType === 'content' ? 'publish' : values.taskType,
          assignee: values.assigneeId,
          dueTime: values.dueTime?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
          // 编辑时保留当前状态与进度，避免只修改标题后意外重置运营需求状态。
          status: isEditingOperationTask ? editingOperationTask.status : undefined,
          progress: isEditingOperationTask ? editingOperationTask.progress : undefined,
          config,
        };
        if (isEditingOperationTask) {
          await updateOperationRequirement({ itemId: editingOperationTaskId, ...operationRequirementPayload });
        } else {
          await createOperationRequirement({ projectId, ...operationRequirementPayload });
        }
        message.success(
          intl.formatMessage({
            id: isEditingOperationTask
              ? 'projectSpace.operation.requirement.updateSuccess'
              : 'projectSpace.operation.requirement.createSuccess',
          })
        );
        setOperationTaskModalOpen(false);
        setEditingOperationTask(null);
        await fetchOperationRequirements(requirementSearchKeyword.trim());
      } catch (error: any) {
        message.error(
          error?.message ||
            intl.formatMessage({
              id: isEditingOperationTask
                ? 'projectSpace.operation.requirement.updateFailed'
                : 'projectSpace.operation.requirement.createFailed',
            })
        );
      } finally {
        operationTaskSubmittingRef.current = false;
        setOperationTaskSaving(false);
      }
    },
    [editingOperationTask, fetchOperationRequirements, intl, projectId, requirementSearchKeyword]
  );

  // 删除成功后先同步移除本地卡片，再异步刷新第一页，保证确认弹窗关闭后列表立即反馈结果。
  const handleDeleteOperationTask = useCallback(
    (task: any) => {
      const itemId = Number(task?.itemId ?? task?.taskId);
      if (
        !Number.isFinite(itemId) ||
        itemId <= 0 ||
        task?.status !== 'todo' ||
        deletingOperationTaskIdRef.current !== null
      ) {
        return;
      }

      Modal.confirm({
        title: intl.formatMessage({ id: 'projectSpace.operation.requirement.deleteConfirmTitle' }),
        content: intl.formatMessage(
          { id: 'projectSpace.operation.requirement.deleteConfirm' },
          { name: task?.title || task?.taskName || task?.requirementName || '' }
        ),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: async () => {
          if (deletingOperationTaskIdRef.current !== null) return;
          deletingOperationTaskIdRef.current = itemId;
          try {
            await deleteOperationRequirement(itemId);
            message.success(intl.formatMessage({ id: 'projectSpace.operation.requirement.deleteSuccess' }));
            if (`${detailTask?.itemId ?? detailTask?.taskId}` === `${itemId}`) setDetailTask(null);
            setOperationRequirements((currentTasks) =>
              currentTasks.filter((currentTask) => `${currentTask.itemId ?? currentTask.taskId}` !== `${itemId}`)
            );
            void fetchOperationRequirements(requirementSearchKeyword.trim()).catch(() => {
              // 删除接口已成功，刷新失败时保留本地移除结果，避免向用户误报删除失败。
            });
          } catch (error: any) {
            message.error(
              error?.message || intl.formatMessage({ id: 'projectSpace.operation.requirement.deleteFailed' })
            );
            throw error;
          } finally {
            deletingOperationTaskIdRef.current = null;
          }
        },
      });
    },
    [detailTask, fetchOperationRequirements, intl, requirementSearchKeyword, t]
  );

  // 启动前先提供可编辑的默认拆解结果；运营需求和运营任务分表保存，避免把需求直接当任务执行。
  const getOperationRequirementStartTasks = useCallback(
    (requirement: any): OperationRequirementStartTask[] => {
      const operationType = normalizeOperationTaskType(requirement);
      const taskKeys =
        operationType === 'collect'
          ? ['collect', 'organize', 'archive']
          : operationType === 'content'
            ? ['create', 'review', 'publish']
            : ['collect', 'analyze', 'report'];
      const assignee = requirement?.assigneeId ?? requirement?.assignee;
      return taskKeys.map((key) => ({
        title: intl.formatMessage(
          { id: `projectSpace.operation.requirementStart.template.${operationType}.${key}.title` },
          { name: requirement?.title || '' }
        ),
        description: intl.formatMessage(
          { id: `projectSpace.operation.requirementStart.template.${operationType}.${key}.description` },
          { name: requirement?.title || '' }
        ),
        assignee,
      }));
    },
    [intl]
  );

  // 运营需求只允许从待启动状态进入拆解确认，避免重复生成运营任务。
  const handleOpenOperationRequirementStart = useCallback((requirement: any) => {
    if (requirement?.status !== 'todo') return;
    setOperationRequirementStartTarget(requirement);
  }, []);

  const closeOperationRequirementDetail = useCallback(() => {
    operationRequirementDetailRequestRef.current += 1;
    setOperationRequirementDetail(null);
    setOperationRequirementDetailLoading(false);
  }, []);

  // 点击运营需求后先用列表数据立即打开抽屉，再读取详情接口补齐最新配置和状态。
  const handleOpenOperationRequirementDetail = useCallback(
    async (requirement: any) => {
      const requirementId = Number(requirement?.itemId ?? requirement?.taskId);
      if (!Number.isFinite(requirementId) || requirementId <= 0) return;
      const requestId = ++operationRequirementDetailRequestRef.current;
      setOperationRequirementDetail(requirement);
      setOperationRequirementDetailLoading(true);
      try {
        const detail = await getOperationRequirement(requirementId);
        if (requestId !== operationRequirementDetailRequestRef.current) return;
        setOperationRequirementDetail({ ...requirement, ...(detail || {}) });
      } catch (error) {
        if (requestId !== operationRequirementDetailRequestRef.current) return;
        console.error('Failed to load operation requirement detail:', error);
        message.error(intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.loadFailed' }));
      } finally {
        if (requestId === operationRequirementDetailRequestRef.current) {
          setOperationRequirementDetailLoading(false);
        }
      }
    },
    [intl]
  );

  const handleSubmitOperationRequirementStart = useCallback(
    async (tasksToStart: OperationRequirementStartTask[]) => {
      const requirementId = Number(operationRequirementStartTarget?.itemId);
      if (!Number.isFinite(requirementId) || requirementId <= 0) return;
      setOperationRequirementStarting(true);
      try {
        await startOperationRequirement({
          requirementId,
          tasks: tasksToStart.map((task) => ({
            title: task.title.trim(),
            description: task.description?.trim() || undefined,
            assignee: task.assignee!,
            dueTime: operationRequirementStartTarget?.dueTime,
          })),
        });
        message.success(intl.formatMessage({ id: 'projectSpace.operation.requirementStart.success' }));
        setOperationRequirementStartTarget(null);
        closeOperationRequirementDetail();
        setActiveTab('tasks');
        await Promise.all([fetchOperationRequirements(requirementSearchKeyword.trim()), fetchTasks({ pageNum: 1 })]);
      } catch (error: any) {
        message.error(
          error?.message || intl.formatMessage({ id: 'projectSpace.operation.requirementStart.submitFailed' })
        );
      } finally {
        setOperationRequirementStarting(false);
      }
    },
    [
      fetchOperationRequirements,
      fetchTasks,
      intl,
      closeOperationRequirementDetail,
      operationRequirementStartTarget,
      requirementSearchKeyword,
    ]
  );

  // 运营任务执行入口先进入与研发项目一致的多仓库拆分确认流程。
  const handleOpenOperationTaskExecute = useCallback((task: any) => {
    if (!task || task.sessionId || task.status !== 'todo') return;
    setOperationTaskSplitTarget(task);
  }, []);

  // 多仓库拆分确认后仅提交承接成员；服务端实时查询成员绑定的数字员工，再以 @ 数字员工的方式发起任务会话。
  const handleConfirmOperationTaskSplit = useCallback(
    async (splitTasks: SplitTaskDraft[]) => {
      const task = operationTaskSplitTarget;
      if (!task) return;
      const assigneeIds = Array.from(
        new Set(
          splitTasks
            .map((splitTask) => splitTask.assigneeId)
            .filter((assigneeId): assigneeId is string | number => assigneeId !== undefined && assigneeId !== null)
        )
      );

      const taskId = Number(task.taskId);
      if (!Number.isFinite(taskId) || taskId <= 0 || !assigneeIds.length) return;
      setOperationTaskExecuting(true);
      try {
        const executeResult = await executeOperationTask({ taskId, assigneeIds });
        message.success(intl.formatMessage({ id: 'projectSpace.operation.execute.success' }));
        setOperationTaskSplitTarget(null);
        setDetailTask(null);
        // 执行接口返回前已创建任务会话；确认后立即进入该会话，列表和数字员工数据在后台刷新即可。
        if (executeResult?.sessionId) {
          handleOpenTaskSession({ ...task, sessionId: executeResult.sessionId, status: 'doing' });
        }
        void Promise.all([fetchTasks({ pageNum: 1 }), fetchOperationAgents()]);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.operation.execute.submitFailed' }));
      } finally {
        setOperationTaskExecuting(false);
      }
    },
    [fetchOperationAgents, fetchTasks, handleOpenTaskSession, intl, operationTaskSplitTarget]
  );

  const handleExitProject = useCallback(() => {
    if (!projectId || isProjectCreator) return;

    Modal.confirm({
      title: t('project.exit'),
      content: t('project.exitConfirm'),
      okText: t('project.exit'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      // 返回 Promise 后确认按钮自动进入 loading，避免重复提交退出请求。
      onOk: async () => {
        const currentUserId = userInfo?.userId ?? userInfo?.id;
        let currentMember = members.find(
          (member) =>
            `${member?.userId ?? ''}` === `${currentUserId ?? ''}` ||
            (!!userInfo?.userCode && `${member?.userCode ?? ''}` === `${userInfo.userCode}`)
        );

        if (!currentMember?.memberId) {
          // 详情初始化尚未完成时重新查询成员，确保退出操作仍能定位当前用户的成员记录。
          const res = await listProjectMembers(projectId);
          const memberList = Array.isArray(res) ? res : [];
          currentMember = memberList.find(
            (member) =>
              `${member?.userId ?? ''}` === `${currentUserId ?? ''}` ||
              (!!userInfo?.userCode && `${member?.userCode ?? ''}` === `${userInfo.userCode}`)
          );
        }

        const memberId = Number(currentMember?.memberId);
        if (!Number.isFinite(memberId) || memberId <= 0) {
          message.error(t('project.exitMemberNotFound'));
          return;
        }

        try {
          // 退出项目复用成员移除接口，由后端校验只能移除当前登录用户本人。
          await removeProjectMember(memberId);
          message.success(t('project.exitSuccess'));
          handleCurrentUserRemoved();
        } catch (error: any) {
          message.error(error?.message || t('project.exitFailed'));
          throw error;
        }
      },
    });
  }, [
    handleCurrentUserRemoved,
    isProjectCreator,
    members,
    projectId,
    t,
    userInfo?.id,
    userInfo?.userCode,
    userInfo?.userId,
  ]);

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

  // 点变更文件行后打开右侧预览抽屉，并拉取该文件的本地 unified diff。
  const openFileDiff = useCallback(
    async (filePath: string) => {
      const sessionId = currentResourceSession?.sessionId;
      if (!sessionId) return;
      setDiffDrawerFile(filePath);
      setDiffDrawerData(null);
      setDiffDrawerLoading(true);
      try {
        const res = await getTaskFileDiff(Number(sessionId), filePath);
        setDiffDrawerData(res || null);
      } catch (error) {
        console.error('Failed to load file diff:', error);
        setDiffDrawerData(null);
      } finally {
        setDiffDrawerLoading(false);
      }
    },
    [currentResourceSession?.sessionId]
  );

  const closeFileDiff = useCallback(() => {
    setDiffDrawerFile(null);
    setDiffDrawerData(null);
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
        rename: 'fileBrowser.action.rename',
        delete: 'fileBrowser.action.delete',
      };
      const actionKeys: Array<keyof typeof labelIdMap> = [
        'quote',
        ...(canPreviewFile(item) ? ['preview' as const] : []),
        'download',
        // 项目创建者可管理共享文件，普通成员仍保留引用、预览、下载能力。
        ...(isProjectCreator ? (['rename', 'delete'] as const) : []),
      ];

      // 项目共享文件来自 listSpaceFiles，引用操作与文件树双击共用同一个处理函数。
      return actionKeys.map((key) => ({
        key,
        danger: key === 'delete',
        label: <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: labelIdMap[key] })}</div>,
      }));
    },
    [intl, isProjectCreator]
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
      if (isProjectSpaceFile(item)) {
        if (!projectId) return;
        try {
          // 共享文件删除走项目维度接口，避免将 fileUrl 误当作普通文件浏览器路径。
          await deleteProjectSpaceFile({ projectId, fileId: item.fileId });
          message.success(intl.formatMessage({ id: 'fileBrowser.delete.success' }));
          await fetchSharedResourceFiles();
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.delete.failed' }));
        }
        return;
      }
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
    [fetchSharedResourceFiles, fileResourceId, intl, projectId, pruneResourceDirectoryCache, refreshResourceDirectory]
  );

  const handleResourceRenameOk = useCallback(
    async (newName: string) => {
      if (!resourceRenameTarget) return;
      if (isProjectSpaceFile(resourceRenameTarget)) {
        if (!projectId) return;
        setResourceRenameLoading(true);
        try {
          // 共享文件重命名只修改项目空间的文件名称，不复用普通文件浏览接口。
          await renameProjectSpaceFile({ projectId, fileId: resourceRenameTarget.fileId, fileName: newName });
          message.success(intl.formatMessage({ id: 'fileBrowser.rename.success' }));
          setResourceRenameOpen(false);
          setResourceRenameTarget(null);
          await fetchSharedResourceFiles();
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.rename.failed' }));
        } finally {
          setResourceRenameLoading(false);
        }
        return;
      }
      if (!fileResourceId) return;
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
    [
      fetchSharedResourceFiles,
      fileResourceId,
      intl,
      projectId,
      pruneResourceDirectoryCache,
      refreshResourceDirectory,
      resourceRenameTarget,
    ]
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
      } else if (key === 'rename') {
        setResourceRenameTarget(item);
        setResourceRenameOpen(true);
      } else if (key === 'delete') {
        Modal.confirm({
          title: intl.formatMessage({ id: 'fileBrowser.delete.confirm' }),
          content: intl.formatMessage({ id: 'fileBrowser.delete.confirmName' }, { name: item.name }),
          okButtonProps: { danger: true },
          // 返回 Promise 后确认按钮会自动进入 loading，避免重复删除同一个共享文件。
          onOk: () => handleDeleteResourceFile(item),
        });
      }
    },
    [
      handleDeleteResourceFile,
      handleResourceItemDoubleClick,
      handleSharedResourceDownload,
      handleSharedResourcePreview,
      intl,
    ]
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
    const requirementPromise = isOperationProject
      ? fetchOperationRequirements('')
      : showRequirementsTab
        ? fetchSources().then((sourceList) => fetchRequirements(sourceList, ''))
        : Promise.resolve();
    const memberPromise = showMembersTab ? fetchMembers() : Promise.resolve();
    const [, initialTasks] = await Promise.all([
      requirementPromise,
      fetchTasks(),
      memberPromise,
      fetchRepos(),
      fetchOperationAccounts(),
    ]);
    return initialTasks;
  }, [
    fetchMembers,
    fetchOperationAccounts,
    fetchOperationRequirements,
    fetchRepos,
    fetchRequirements,
    fetchSources,
    fetchTasks,
    isOperationProject,
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
    setOperationAccountPanelOpen(false);
    setOperationAccountLoginTarget(null);
    setOperationAccountLoginPreparingId(null);
    setOperationAccountLoginConfirming(false);
    if (operationAccountLoginSandboxIdRef.current) {
      EventEmitter.emit('beyond-main-driver-open-type', '');
    }
    operationAccountLoginSandboxIdRef.current = '';
    setOperationTaskModalOpen(false);
    setOperationAccounts([]);
    setOperationAgents([]);
    setOperationKnowledgeBases([]);
    setOperationWorks([]);
    setOperationRequirements([]);
    setOperationRequirementsRefreshing(false);
    operationRequirementDetailRequestRef.current += 1;
    setOperationRequirementDetail(null);
    setOperationRequirementDetailLoading(false);
    setOperationRequirementStartTarget(null);
    // 切换项目时关闭运营任务拆分弹窗，并清理可能残留的执行状态。
    setOperationTaskSplitTarget(null);
    setOperationTaskExecuting(false);
    setDetailTask(null);
    // 项目详情页签顺序以任务开头，切换项目后也始终回到第一个任务页签。
    setActiveTab('tasks');
    setDetailReq(null);
    setRequirementSearchKeyword('');
    setVisibleRequirementCount(REQUIREMENT_PAGE_SIZE);
    startingRequirementIdsRef.current.clear();
    setStartingRequirementIds(new Set());
    if (!isDevelopProject) {
      setSources([]);
      setRequirements([]);
      setLastLog(null);
    }
    void fetchDetailData().then((initialTasks) => {
      if (!showRequirementsTab || !Array.isArray(initialTasks) || initialTasks.length > 0) return;
      // 仅在用户仍停留在默认任务页签时自动跳转，避免覆盖用户加载期间的主动切换。
      setActiveTab((currentTab) => (currentTab === 'tasks' ? 'requirements' : currentTab));
    });
  }, [EventEmitter, fetchDetailData, isDevelopProject, showRequirementsTab]);

  useEffect(() => {
    // 切换项目后默认回到共享文件，避免运营项目沿用研发项目的代码变更视图。
    setResourceView('shared');
    closeFileDiff();
    setSharedFiles([]);
    setResourceSessions([]);
    setSessionFilesMap({});
    setSessionFilesLoadingMap({});
    setResourceChildrenByPath({});
    setResourceExpandedKeys([]);
    setResourceRenameOpen(false);
    setResourceRenameTarget(null);
    setResourceRenameLoading(false);
  }, [closeFileDiff, fileResourceId, projectId]);

  useEffect(() => {
    // 代码变更仅研发项目提供；项目类型异步切换完成后兜底回到共享文件视图。
    if (!isDevelopProject && resourceView === 'changes') setResourceView('shared');
  }, [isDevelopProject, resourceView]);

  useEffect(() => {
    if (activeTab !== 'resources' && activeTab !== 'repos') return;
    void fetchProjectResourceSessions();
  }, [activeTab, fetchProjectResourceSessions]);

  useEffect(() => {
    if (activeTab !== 'resources') return;
    void fetchSharedResourceFiles();
  }, [activeTab, fetchSharedResourceFiles]);

  // 代码变更只跟当前会话（任务）走；仅在切到对应二级 Tab 时拉取，避免共享文件视图产生无效请求。
  useEffect(() => {
    if (activeTab !== 'resources' || resourceView !== 'changes' || !isDevelopProject) return;
    void fetchTaskChanges(currentResourceSession?.sessionId);
  }, [activeTab, currentResourceSession?.sessionId, fetchTaskChanges, isDevelopProject, resourceView]);

  useEffect(() => {
    // 当前会话和全部会话按二级 Tab 懒加载，切换到共享文件时不重复请求会话目录。
    if (activeTab !== 'resources' || !isSessionResourceView || !fileResourceId) return;
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
    isSessionResourceView,
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

  const hasRequirementVisibleData = isOperationProject
    ? operationRequirements.length > 0
    : sources.length > 0 || requirements.length > 0 || !!lastLog;
  const requirementsTabLoading = isOperationProject
    ? operationRequirementsLoading
    : sourcesLoading || requirementsLoading;
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
      !(isOperationProject ? operationRequirementsRefreshing : requirementsRefreshLoading)) ||
    (activeTab === 'tasks' && tasksLoading && !tasks.length && !tasksRefreshLoading);

  const tabItems = useMemo(
    () => [
      { key: 'tasks', label: t('tabs.tasks') },
      { key: 'resources', label: t('tabs.resources') },
      ...(showRequirementsTab ? [{ key: 'requirements', label: t('tabs.requirements') }] : []),
      // 数字员工与集成测试都是研发闭环能力,仅研发项目可见;数字员工排在成员前。
      ...(isDevelopProject ? [{ key: 'digitalAgents', label: t('tabs.digitalAgents') }] : []),
      ...(showMembersTab ? [{ key: 'members', label: t('tabs.members') }] : []),
      ...(showIntegrationTab ? [{ key: 'integration', label: t('tabs.integration') }] : []),
    ],
    [isDevelopProject, showIntegrationTab, showMembersTab, showRequirementsTab, t]
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
    if (isOperationProject) {
      if (operationRequirementsRefreshing) return;
      setOperationRequirementsRefreshing(true);
      try {
        await fetchOperationRequirements(requirementSearchKeyword.trim());
      } catch (error) {
        console.error('Failed to refresh operation requirements:', error);
        message.error(intl.formatMessage({ id: 'projectSpace.operation.requirement.refreshFailed' }));
      } finally {
        setOperationRequirementsRefreshing(false);
      }
      return;
    }
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
  }, [
    fetchOperationRequirements,
    fetchRequirements,
    fetchSources,
    intl,
    isOperationProject,
    operationRequirementsRefreshing,
    requirementSearchKeyword,
    requirementsRefreshLoading,
    showRequirementsTab,
    t,
  ]);

  const handleRequirementSearchChange = useCallback(
    (value: string) => {
      setRequirementSearchKeyword(value);
      setVisibleRequirementCount(REQUIREMENT_PAGE_SIZE);
      if (requirementSearchTimerRef.current) clearTimeout(requirementSearchTimerRef.current);

      // 与会话、任务列表统一在输入停顿后查询，避免每个字符都请求需求接口。
      requirementSearchTimerRef.current = setTimeout(() => {
        if (isOperationProject) {
          void fetchOperationRequirements(value.trim());
        } else {
          void fetchRequirements(undefined, value.trim());
        }
        requirementSearchTimerRef.current = null;
      }, 300);
    },
    [fetchOperationRequirements, fetchRequirements, isOperationProject]
  );

  const handleRequirementSearchSubmit = useCallback(() => {
    if (requirementSearchTimerRef.current) {
      clearTimeout(requirementSearchTimerRef.current);
      requirementSearchTimerRef.current = null;
    }
    if (isOperationProject) {
      void fetchOperationRequirements(requirementSearchKeyword.trim());
    } else {
      void fetchRequirements(undefined, requirementSearchKeyword.trim());
    }
  }, [fetchOperationRequirements, fetchRequirements, isOperationProject, requirementSearchKeyword]);

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

  // 聊天录入:开一个绑定当前项目的新会话,用户边聊边贴图沉淀需求,聊完再回需求 tab 定稿。
  // 与侧栏 handleNewChat 一致——项目归属只靠 navigate state 传递,首轮发送时 useChat 会据此 emit
  // projectSpace-session-pending 完成绑定;新会话此刻无 sessionId,不能走 -session-context(会被空 id 拦掉)。
  const openChatRequirementEntry = () => {
    if (!projectId) {
      message.warning(t('message.selectProjectFirst'));
      return;
    }
    setSessionId?.('');
    onBack();
    navigate('/chat', {
      state: {
        keepSiderActiveKey: 'sessions',
        from: 'projectSpace',
        projectId,
        projectName: project?.projectName,
      },
    });
  };

  const requirementAddMenuItems: MenuProps['items'] = [
    {
      key: 'manual',
      icon: <EditOutlined />,
      label: (
        <div className={styles.requirementAddMenuItem}>
          <span className={styles.requirementAddMenuLabel}>{t('requirement.addMenu.manual')}</span>
          <span className={styles.requirementAddMenuDesc}>{t('requirement.addMenu.manualDesc')}</span>
        </div>
      ),
    },
    {
      key: 'chat',
      icon: <CommentOutlined />,
      label: (
        <div className={styles.requirementAddMenuItem}>
          <span className={styles.requirementAddMenuLabel}>{t('requirement.addMenu.chat')}</span>
          <span className={styles.requirementAddMenuDesc}>{t('requirement.addMenu.chatDesc')}</span>
        </div>
      ),
    },
  ];

  const handleRequirementAddMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'manual') {
      openManualRequirementModal();
      return;
    }
    if (key === 'chat') {
      openChatRequirementEntry();
    }
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
      await Promise.all([
        fetchRequirements(sourceList, requirementSearchKeyword.trim()),
        channelPanelOpen ? fetchChannelSources({ keyword: channelSearchKeyword, pageNum: 1 }) : Promise.resolve(),
      ]);
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
      // 建仓成功即关表单:manage 场景退回列表,source/manualRequirement 场景回到各自表单。
      setRepoFormOpen(false);
      await fetchRepos();
      if (repoModalTarget === 'manualRequirement') {
        setManualRequirementForm((prev) => ({ ...prev, repoId: res.repoId }));
      } else if (repoModalTarget === 'source') {
        setSourceForm((prev) => ({ ...prev, repoId: res.repoId }));
      }
      // manage 和 requirementSplit 入口仅刷新仓库列表，拆分弹窗会用刷新后的数据重新生成可选项。
    } catch {
      message.error(t('repository.createFailed'));
    } finally {
      setRepoSaving(false);
    }
  };

  const handleDeleteRepo = (repo: RepoOption) => {
    // 仓库被渠道或需求引用时不允许删除,否则这些引用会指向失效仓库。前端先拦一道,后端仍应校验。
    const referencedBySource = sources.some((source) => source.repoId === repo.repoId);
    const referencedByRequirement = requirements.some((requirement) => requirement.repoId === repo.repoId);
    if (referencedBySource || referencedByRequirement) {
      message.warning(t('repository.deleteInUse', { name: `${repo.repoFullName || repo.repoUrl || repo.repoId}` }));
      return;
    }
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
        await Promise.all([
          fetchRequirements(sourceList, requirementSearchKeyword.trim()),
          channelPanelOpen ? fetchChannelSources({ keyword: channelSearchKeyword, pageNum: 1 }) : Promise.resolve(),
        ]);
      },
    });
  };

  const handleTriggerScan = async (sourceId: number) => {
    setScanningId(sourceId);
    try {
      const res = await triggerScan(sourceId);
      message.success(t('source.scanSuccess', { count: res?.createdCount || 0 }));
      const sourceList = await fetchSources();
      await Promise.all([
        fetchRequirements(sourceList, requirementSearchKeyword.trim()),
        channelPanelOpen ? fetchChannelSources({ keyword: channelSearchKeyword, pageNum: 1 }) : Promise.resolve(),
      ]);
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
    if (channelPanelOpen) {
      await fetchChannelSources({ keyword: channelSearchKeyword, pageNum: 1 });
    }
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

  // 拆单确认:演示态下拆分结果尚无后端多任务接口,仍走原有单任务启动;真实实现将按 tasks 批量建任务。
  const handleConfirmSplit = async (splitTasks: SplitTaskDraft[]) => {
    const requirement = splitRequirement;
    if (!requirement) return;
    setSplitRequirement(null);
    void splitTasks;
    await handleStartTask(requirement);
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

  const renderSourceList = (
    emptyText = t('source.empty'),
    options: { panel?: boolean; loading?: boolean } = {},
    sourceList: ScanSourceItem[] = sources
  ) => (
    <Spin spinning={(options.loading ?? sourcesLoading) && !sourceList.length}>
      {sourceList.length ? (
        <div className={options.panel ? styles.detailChannelSourceList : styles.detailSourceList}>
          {sourceList.map((source) => (
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
    if (channelSearchTimerRef.current) {
      clearTimeout(channelSearchTimerRef.current);
      channelSearchTimerRef.current = null;
    }
    // 关闭面板后忽略尚未返回的查询，避免旧搜索结果重新写回下一次打开的面板。
    channelSourceRequestIdRef.current += 1;
    setChannelPanelOpen(false);
    setChannelSearchKeyword('');
    setChannelSourcesLoading(false);
    clearDetailPanel?.();
  };

  const handleToggleChannelPanel = () => {
    if (channelPanelOpen) {
      handleCloseChannelPanel();
      return;
    }
    // 每次打开渠道配置都从后端重新查询第一页，避免沿用上次输入的搜索条件。
    setChannelSearchKeyword('');
    setChannelPanelOpen(true);
    void fetchChannelSources({ keyword: '', pageNum: 1 });
  };

  const handleChannelSearchChange = useCallback(
    (value: string) => {
      if (channelSearchTimerRef.current) clearTimeout(channelSearchTimerRef.current);
      // 输入停顿后再向后端搜索，避免每输入一个字符都请求渠道分页接口。
      channelSearchTimerRef.current = setTimeout(() => {
        setChannelSearchKeyword(value);
        void fetchChannelSources({ keyword: value, pageNum: 1 });
        channelSearchTimerRef.current = null;
      }, 300);
    },
    [fetchChannelSources]
  );

  const handleChannelPanelScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const loadedCount = channelSources.length;
      if (channelSourcesLoading || loadedCount >= channelSourcePage.total) return;
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight <= 80) {
        // 渠道列表独立触底分页，继续使用当前搜索关键字查询下一页。
        void fetchChannelSources({
          append: true,
          keyword: channelSearchKeyword,
          pageNum: channelSourcePage.pageNum + 1,
        });
      }
    },
    [channelSearchKeyword, channelSourcePage, channelSources.length, channelSourcesLoading, fetchChannelSources]
  );

  const handleTabChange = (nextTab: string) => {
    if (nextTab !== 'requirements' && channelPanelOpen) {
      // 渠道配置大面板只服务需求页签；切换到其他页签时立即移除右侧覆盖层。
      handleCloseChannelPanel();
    }
    if (nextTab !== 'requirements' && operationAccountPanelOpen) {
      // 账号管理仅属于运营项目需求页签，切换页签时立即收起覆盖层。
      handleCloseOperationAccountPanel();
    }
    setActiveTab(nextTab);
  };

  const renderChannelPanel = () => (
    <div className={styles.detailChannelPanel}>
      <div className={styles.detailChannelPanelHeader}>
        <div className={styles.detailChannelPanelTitle}>
          <h3>{t('channel.title')}</h3>
          <p>{t('channel.count', { count: channelSourcePage.total })}</p>
        </div>
        <div className={styles.detailChannelPanelActions}>
          <ChannelSearchInput
            keyword={channelSearchKeyword}
            placeholder={t('channel.searchPlaceholder')}
            onKeywordChange={handleChannelSearchChange}
          />
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
      <div className={styles.detailChannelPanelBody} onScroll={handleChannelPanelScroll}>
        {renderSourceList(
          channelSearchKeyword.trim() ? t('channel.searchEmpty') : t('channel.empty'),
          { panel: true, loading: channelSourcesLoading },
          channelSources
        )}
      </div>
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
    channelSearchKeyword,
    channelSourcePage.total,
    channelSources,
    channelSourcesLoading,
    dwsAuthed,
    dwsExpired,
    dwsExpiresAt,
    project?.projectName,
    repos,
    scanningId,
    setDetailPanel,
    sourceDwsStatusMap,
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
    if (!operationAccountPanelOpen) return;
    // 账号管理使用覆盖主会话区域的大页面，容量足以承载多平台筛选和账号数据卡片。
    const overlayDetailPanelOptions = { overlay: true } as NonNullable<
      Parameters<NonNullable<typeof setDetailPanel>>[1]
    > & { overlay: boolean };
    setDetailPanel?.(
      <OperationAccountPanel
        accounts={operationAccounts}
        loading={operationAccountsLoading}
        savingAccount={operationAccountSaving}
        loginTarget={operationAccountLoginTarget}
        loginPreparingAccountId={operationAccountLoginPreparingId}
        loginConfirming={operationAccountLoginConfirming}
        deletingAccountId={operationAccountDeletingId}
        onBack={handleCloseOperationAccountPanel}
        onSaveAccount={handleSaveOperationAccount}
        onLogin={handleLoginOperationAccount}
        onConfirmLogin={handleConfirmOperationAccountLogin}
        onCancelLogin={handleCloseOperationAccountRemoteDesktop}
        onDeleteAccount={handleDeleteOperationAccount}
      />,
      overlayDetailPanelOptions
    );
  }, [
    handleCloseOperationAccountPanel,
    handleCloseOperationAccountRemoteDesktop,
    handleConfirmOperationAccountLogin,
    handleDeleteOperationAccount,
    handleLoginOperationAccount,
    handleSaveOperationAccount,
    operationAccountPanelOpen,
    operationAccountLoginConfirming,
    operationAccountLoginPreparingId,
    operationAccountLoginTarget,
    operationAccountDeletingId,
    operationAccountSaving,
    operationAccountsLoading,
    operationAccounts,
    setDetailPanel,
  ]);

  useEffect(() => {
    return () => {
      if (operationAccountPanelOpen) clearDetailPanel?.();
    };
  }, [clearDetailPanel, operationAccountPanelOpen]);

  useEffect(() => {
    if (!operationAccountPanelOpen || activeTab === 'requirements') return;
    // 账号管理入口已移动到运营需求 Tab，切换到其他 Tab 时再关闭覆盖式大页面。
    handleCloseOperationAccountPanel();
  }, [activeTab, handleCloseOperationAccountPanel, operationAccountPanelOpen]);

  useEffect(() => {
    if (!operationRequirementDetail || activeTab === 'requirements') return;
    // 运营需求详情只属于需求 Tab，切换页面时同步关闭，避免抽屉覆盖其他业务内容。
    closeOperationRequirementDetail();
  }, [activeTab, closeOperationRequirementDetail, operationRequirementDetail]);

  // 详情抽屉底部启动入口:与列表「启动」按钮同源,读完需求内容可直接启动,无需退回列表 hover。
  const renderRequirementDetailFooter = (requirement: RequirementItem) => {
    const isStarting = startingRequirementIds.has(requirement.itemId);
    const isStarted = requirement.sessionId !== undefined && requirement.sessionId !== null;
    return (
      <div className={styles.requirementDetailFooter}>
        {isStarted ? (
          <Button disabled>{t('requirement.started')}</Button>
        ) : (
          <Button
            type="primary"
            loading={isStarting}
            disabled={isStarting}
            // V2:同样先弹拆单窗确认多仓库任务,确认后再启动。
            onClick={() => setSplitRequirement(requirement)}
          >
            {t(isStarting ? 'requirement.starting' : 'requirement.start')}
          </Button>
        )}
      </div>
    );
  };

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
        footer={renderRequirementDetailFooter(detailReq)}
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

  // 运营需求字段与研发扫描需求不同，详情抽屉按运营类型展示负责人、时间和类型专属配置。
  const renderOperationRequirementDetailDrawer = () => {
    if (!operationRequirementDetail) return null;
    const requirement = operationRequirementDetail;
    const operationType = normalizeOperationTaskType(requirement);
    const config = getOperationTaskConfig(requirement, operationType);
    const isStarted = requirement.status !== 'todo';
    const dueTime = requirement.dueTime || requirement.due || requirement.deadline;
    const createdAt = requirement.createTime || requirement.createdAt;
    const rawProgress = Number(requirement.progress ?? 0);
    const progress = Number.isFinite(rawProgress) ? Math.min(100, Math.max(0, rawProgress)) : 0;
    const emptyValue = t('common.emptyValue');
    const formatPlatform = (platformId?: string) => {
      const platformKeyMap: Record<string, string> = {
        WeChatAccount: 'wechat',
        wechat: 'wechat',
        Xiaohongshu: 'xiaohongshu',
        xiaohongshu: 'xiaohongshu',
        WeChatChannels: 'video',
        video: 'video',
        Douyin: 'douyin',
        douyin: 'douyin',
      };
      const platformKey = platformKeyMap[`${platformId || ''}`];
      if (platformKey) return intl.formatMessage({ id: `projectSpace.operation.platform.${platformKey}` });
      if (platformId === 'Internet') {
        return intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.channel.internet' });
      }
      if (platformId === 'GitHub') {
        return intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.channel.github' });
      }
      return platformId || emptyValue;
    };
    const formatAccount = (accountId?: OperationIdentifier) => {
      const account = operationAccounts.find(
        (item) => `${item.id}` === `${accountId}` || `${item.accountId}` === `${accountId}`
      );
      return account?.accountName || (accountId !== undefined && accountId !== null ? `${accountId}` : emptyValue);
    };
    const formatDateRange = (start?: string, end?: string) => {
      const values = [start, end]
        .filter(Boolean)
        .map((value) => (dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD') : value));
      return values.length ? values.join(' - ') : emptyValue;
    };
    const configItems: Array<{ label: string; value: React.ReactNode }> = [];
    let configTitleId = 'projectSpace.operation.taskForm.collect.title';

    if (operationType === 'collect') {
      const knowledgeBaseId = config.knowledgeBaseId;
      const knowledgeBase = operationKnowledgeBases.find((item) => `${item.value}` === `${knowledgeBaseId}`);
      const collectMode = config.mode ?? config.collectMethod;
      configItems.push(
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectChannel' }),
          value: formatPlatform(config.channel ?? config.collectSource),
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectAccountOrAddress' }),
          value: config.accountOrAddress ?? config.collectAccount ?? emptyValue,
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectTopic' }),
          value: config.topic ?? config.collectTopic ?? emptyValue,
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectDateRange' }),
          value: formatDateRange(config.startTime ?? config.collectStart, config.endTime ?? config.collectEnd),
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.knowledgeBase' }),
          value: knowledgeBase?.label || (knowledgeBaseId ? `${knowledgeBaseId}` : emptyValue),
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectMode' }),
          value: collectMode
            ? intl.formatMessage({ id: `projectSpace.operation.taskForm.collect.mode.${collectMode}` })
            : emptyValue,
        }
      );
    } else if (operationType === 'content') {
      configTitleId = 'projectSpace.operation.taskForm.content.title';
      const contentTypeKeyMap: Record<string, string> = {
        'wechat-article': 'wechatArticle',
        'xiaohongshu-post': 'xiaohongshuPost',
        'short-video': 'shortVideo',
      };
      const contentTypeKey = contentTypeKeyMap[config.contentType];
      configItems.push(
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.contentType' }),
          value: contentTypeKey
            ? intl.formatMessage({ id: `projectSpace.operation.taskForm.content.type.${contentTypeKey}` })
            : config.contentType || emptyValue,
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.publishChannel' }),
          value: formatPlatform(config.publishChannel),
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.publishAccount' }),
          value: formatAccount(config.publishAccountId),
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.contentTopic' }),
          value: config.topic ?? config.publishTopic ?? emptyValue,
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.publishSchedule' }),
          value: config.publishSchedule || emptyValue,
        }
      );
    } else {
      configTitleId = 'projectSpace.operation.taskForm.analyze.title';
      const analysisScope = config.scope ?? config.analysisType;
      configItems.push(
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.analysisPlatform' }),
          value: formatPlatform(config.platformId ?? config.analysisChannel),
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.analysisAccount' }),
          value: formatAccount(config.accountId ?? config.analysisAccountId),
        },
        {
          label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.analysisScope' }),
          value: analysisScope
            ? intl.formatMessage({ id: `projectSpace.operation.taskForm.analyze.scope.${analysisScope}` })
            : emptyValue,
        }
      );
    }

    return (
      <Drawer
        title={intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.title' })}
        className={styles.requirementDetailDrawer}
        open
        onClose={closeOperationRequirementDetail}
        width={640}
        // 运营需求详情的启动入口放在抽屉标题栏右侧，和任务详情的执行入口保持一致。
        extra={
          isStarted ? (
            <Button disabled>{intl.formatMessage({ id: 'projectSpace.operation.requirement.started' })}</Button>
          ) : (
            <Button
              type="primary"
              onClick={() => {
                closeOperationRequirementDetail();
                handleOpenOperationRequirementStart(requirement);
              }}
            >
              {intl.formatMessage({ id: 'projectSpace.operation.requirement.start' })}
            </Button>
          )
        }
      >
        <Spin spinning={operationRequirementDetailLoading}>
          <div className={styles.requirementDetailDrawerContent}>
            <div className={styles.requirementDetailTitleRow}>
              <div className={styles.requirementDetailTitle}>{requirement.title || requirement.requirementName}</div>
              <Tag color={isStarted ? 'processing' : 'default'}>
                {intl.formatMessage({
                  id: isStarted
                    ? 'projectSpace.operation.requirement.started'
                    : 'projectSpace.detail.requirement.notStarted',
                })}
              </Tag>
            </div>

            <section className={styles.requirementDetailSection}>
              <h3>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.basicInfo' })}</h3>
              <div className={styles.requirementDetailInfoGrid}>
                <div className={styles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.id' })}</label>
                  <span>{requirement.itemId || requirement.taskId || emptyValue}</span>
                </div>
                <div className={styles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.type' })}</label>
                  <span>{intl.formatMessage({ id: `projectSpace.operation.task.type.${operationType}` })}</span>
                </div>
                <div className={styles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.assignee' })}</label>
                  <span>{requirement.assigneeName || requirement.assignee || emptyValue}</span>
                </div>
                <div className={styles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.dueTime' })}</label>
                  <span>{dueTime && dayjs(dueTime).isValid() ? dayjs(dueTime).format('YYYY-MM-DD') : emptyValue}</span>
                </div>
                <div className={styles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.createdAt' })}</label>
                  <span>
                    {createdAt && dayjs(createdAt).isValid() ? dayjs(createdAt).format('YYYY-MM-DD HH:mm') : emptyValue}
                  </span>
                </div>
                <div className={styles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.progress' })}</label>
                  <span>{progress}%</span>
                </div>
              </div>
            </section>

            <section className={styles.requirementDetailSection}>
              <h3>{intl.formatMessage({ id: 'projectSpace.operation.requirement.detail.description' })}</h3>
              <div className={styles.requirementDetailText}>
                {requirement.description ||
                  intl.formatMessage({ id: 'projectSpace.operation.requirementStart.emptyDescription' })}
              </div>
            </section>

            <section className={styles.requirementDetailSection}>
              <h3>{intl.formatMessage({ id: configTitleId })}</h3>
              <div className={styles.requirementDetailInfoGrid}>
                {configItems.map((item) => (
                  <div key={item.label} className={styles.requirementDetailInfoItem}>
                    <label>{item.label}</label>
                    <span>{item.value}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </Spin>
      </Drawer>
    );
  };

  const renderOperationRequirements = () => (
    <div className={styles.detailRequirementsPanel}>
      <div className={styles.detailRequirementsToolbar}>
        <button
          type="button"
          className={operationStyles.operationAccountEntry}
          // 账号管理大页面由同一入口控制展开和收起，避免用户只能通过返回按钮关闭。
          onClick={() => {
            if (operationAccountPanelOpen) {
              handleCloseOperationAccountPanel();
            } else {
              handleOpenOperationAccountPanel();
            }
          }}
        >
          <span className={operationStyles.operationAccountEntryLabel}>
            <IdcardOutlined />
            <span>{intl.formatMessage({ id: 'projectSpace.operation.account.entry' })}</span>
          </span>
          {operationAccountPanelOpen ? <LeftOutlined /> : <RightOutlined />}
        </button>
        <div className={styles.detailRequirementHeader}>
          <div className={`${styles.searchInput} ${styles.detailRequirementSearch}`}>
            <Input
              allowClear
              placeholder={intl.formatMessage({ id: 'projectSpace.operation.requirement.searchPlaceholder' })}
              suffix={<SearchOutlined onClick={handleRequirementSearchSubmit} />}
              value={requirementSearchKeyword}
              onChange={(event) => handleRequirementSearchChange(event.target.value)}
              onPressEnter={handleRequirementSearchSubmit}
            />
          </div>
          <Space size={6}>
            <Tooltip title={intl.formatMessage({ id: 'projectSpace.operation.requirement.new' })} placement="top">
              <Button
                aria-label={intl.formatMessage({ id: 'projectSpace.operation.requirement.new' })}
                size="small"
                className={`${styles.detailHeaderActionButton} ${styles.detailManualRequirementAddButton}`}
                icon={<PlusOutlined />}
                onClick={handleOpenOperationTaskModal}
              />
            </Tooltip>
            <Tooltip title={t('common.refresh')} placement="top">
              <Button
                aria-label={t('common.refresh')}
                size="small"
                className={`${styles.detailHeaderActionButton} ${styles.detailRequirementRefreshButton}`}
                icon={<ReloadOutlined />}
                loading={operationRequirementsRefreshing}
                disabled={operationRequirementsRefreshing}
                onClick={handleRefreshRequirements}
              />
            </Tooltip>
          </Space>
        </div>
      </div>
      {/* 运营需求独立滚动，启动后刷新当前列表并由任务页展示拆解结果。 */}
      <div className={styles.detailRequirementScroll}>
        <Spin
          spinning={
            operationRequirementsLoading && operationRequirements.length > 0 && !operationRequirementsRefreshing
          }
        >
          {operationRequirements.length ? (
            <div className={styles.detailRequirementList}>
              {operationRequirements.map((requirement) => {
                const isTodo = requirement.status === 'todo';
                const isActionOpen = openManualRequirementActionId === `operation-${requirement.itemId}`;
                const actionItems: MenuProps['items'] = isTodo
                  ? [
                    {
                      key: 'edit',
                      icon: <EditOutlined />,
                      label: intl.formatMessage({ id: 'projectSpace.operation.requirement.edit' }),
                    },
                    {
                      key: 'delete',
                      icon: <DeleteOutlined />,
                      label: intl.formatMessage({ id: 'projectSpace.operation.requirement.delete' }),
                      danger: true,
                    },
                  ]
                  : [];
                const dueTime =
                  requirement.dueTime && dayjs(requirement.dueTime).isValid()
                    ? dayjs(requirement.dueTime).format('YYYY-MM-DD')
                    : '-';
                const type = normalizeOperationTaskType(requirement);
                return (
                  <div
                    key={requirement.itemId}
                    className={`${styles.detailRequirementItem} ${
                      isTodo ? styles.detailRequirementItemWithAction : ''
                    }`}
                    // 运营需求和研发需求保持一致，点击卡片主体在右侧打开完整详情。
                    onClick={() => void handleOpenOperationRequirementDetail(requirement)}
                  >
                    <div className={styles.detailRequirementSummary}>
                      <span className={styles.detailRequirementIcon}>
                        <FileTextOutlined />
                      </span>
                      <div className={styles.detailRequirementMain}>
                        <strong>{requirement.title || requirement.requirementName}</strong>
                        <span>
                          {intl.formatMessage({ id: `projectSpace.operation.task.type.${type}` })}
                          {' · '}
                          {requirement.assignee || '-'}
                          {' · '}
                          {dueTime}
                        </span>
                      </div>
                      <div
                        className={`${styles.detailRequirementActions} ${
                          isActionOpen ? styles.detailRequirementActionsOpen : ''
                        }`}
                      >
                        {isTodo && (
                          <Button
                            size="small"
                            className={`${styles.detailRequirementAction} ${styles.detailRequirementStartAction}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenOperationRequirementStart(requirement);
                            }}
                          >
                            {intl.formatMessage({ id: 'projectSpace.operation.requirement.start' })}
                          </Button>
                        )}
                        {!isTodo && (
                          <span
                            className={`${styles.detailRequirementAction} ${styles.detailRequirementStartedAction}`}
                          >
                            {intl.formatMessage({ id: 'projectSpace.operation.requirement.started' })}
                          </span>
                        )}
                        {isTodo && (
                          <Dropdown
                            trigger={['hover']}
                            placement="bottomRight"
                            onOpenChange={(open) =>
                              setOpenManualRequirementActionId(open ? `operation-${requirement.itemId}` : undefined)
                            }
                            menu={{
                              items: actionItems,
                              onClick: ({ key, domEvent }) => {
                                domEvent.preventDefault();
                                domEvent.stopPropagation();
                                setOpenManualRequirementActionId(undefined);
                                if (key === 'edit') {
                                  handleOpenEditOperationTaskModal(requirement);
                                } else if (key === 'delete') {
                                  handleDeleteOperationTask(requirement);
                                }
                              },
                            }}
                          >
                            <Button
                              type="text"
                              size="small"
                              aria-label={intl.formatMessage({ id: 'projectSpace.operation.requirement.more' })}
                              className={`${styles.detailRequirementMoreAction} ${
                                isActionOpen ? styles.detailRequirementMoreActionOpen : ''
                              }`}
                              icon={<EllipsisOutlined />}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                            />
                          </Dropdown>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!operationRequirementsLoading && <ListEndMessage />}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'projectSpace.operation.requirement.empty' })}
            />
          )}
        </Spin>
      </div>
      {renderOperationRequirementDetailDrawer()}
      <OperationTaskFormModal
        open={operationTaskModalOpen}
        mode={editingOperationTask ? 'edit' : 'create'}
        entityLabel="requirement"
        initialValues={
          editingOperationTask
            ? getOperationTaskInitialValues(editingOperationTask)
            : { assigneeId: defaultProjectAssigneeId }
        }
        options={operationTaskOptions}
        loading={operationTaskSaving}
        optionLoading={operationOptionsLoading}
        onCancel={() => {
          setOperationTaskModalOpen(false);
          setEditingOperationTask(null);
        }}
        onSubmit={handleSubmitOperationTask}
      />
      <OperationRequirementStartModal
        open={!!operationRequirementStartTarget}
        requirement={operationRequirementStartTarget}
        initialTasks={
          operationRequirementStartTarget ? getOperationRequirementStartTasks(operationRequirementStartTarget) : []
        }
        assignees={operationAssigneeOptions}
        loading={operationRequirementStarting}
        onCancel={() => setOperationRequirementStartTarget(null)}
        onSubmit={handleSubmitOperationRequirementStart}
      />
    </div>
  );

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
            {/* 新增需求拆成两种录入方式:hover 展开手工录入 / 聊天录入。 */}
            <Dropdown
              trigger={['hover']}
              placement="bottomRight"
              menu={{ items: requirementAddMenuItems, onClick: handleRequirementAddMenuClick }}
            >
              <Button
                aria-label={t('manualRequirement.title')}
                size="small"
                className={`${styles.detailHeaderActionButton} ${styles.detailManualRequirementAddButton}`}
                icon={<PlusOutlined />}
              />
            </Dropdown>
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
                              // V2:先弹拆单窗确认多仓库任务,确认后再启动。
                              setSplitRequirement(item);
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
            // 本地变更点行在右侧抽屉预览 diff；远程变更仍保留 GitHub 文件页入口。
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
      <>
        <div className={styles.codeChangeHeader}>
          <div className={styles.codeChangeHeaderMain}>
            {branchLabel ? (
              // 分支名即 GitHub 入口：有 compareUrl 就跳转整体比对页，否则展示当前任务分支。
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
        </div>
        {body}
      </>
    );
  };

  // 文件 diff 抽屉：逐行渲染 unified diff，行首 +/-/@@ 分别着色，保持与文件预览一致的右侧查看方式。
  const renderFileDiffDrawer = () => {
    const open = !!diffDrawerFile;
    const lines = parseDiffLines(diffDrawerData?.diff);
    const status = diffDrawerData?.status;
    const hasDiff = status === 'ok' && lines.some((l) => l.type === 'add' || l.type === 'del');
    const fileName = diffDrawerFile ? splitFilePath(diffDrawerFile).name : '';
    return (
      <Drawer
        open={open}
        onClose={closeFileDiff}
        width={720}
        title={
          <div className={styles.diffModalTitle}>
            <span className={styles.diffModalName}>{fileName}</span>
            {diffDrawerFile ? <span className={styles.diffModalPath}>{diffDrawerFile}</span> : null}
          </div>
        }
        className={styles.diffDrawer}
      >
        {diffDrawerLoading ? (
          <div className={styles.diffModalEmpty}>
            <Spin />
          </div>
        ) : !diffDrawerData || status !== 'ok' ? (
          <div className={styles.diffModalEmpty}>{diffDrawerData?.message || t('codeChanges.diffUnavailable')}</div>
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
      </Drawer>
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

    // 资源分类收敛到顶部 Tab，文件和代码变更复用同一个内容区，避免多个卡片纵向堆叠。
    const createResourceViewItem = (key: ResourceView, label: string) => ({
      key,
      // 二级 Tab 统一展示前两个字符，Tooltip 保留完整的国际化文案，避免窄屏出现省略号。
      label: (
        <Tooltip title={label}>
          <span className={styles.resourceViewTabLabel}>{Array.from(label).slice(0, 2).join('')}</span>
        </Tooltip>
      ),
    });
    const resourceViewItems = [
      createResourceViewItem('shared', t('resource.sharedSpace')),
      createResourceViewItem('sessionCurrent', t('resource.currentSession')),
      createResourceViewItem('sessionAll', t('resource.allSessions')),
      ...(isDevelopProject ? [createResourceViewItem('changes', t('codeChanges.title'))] : []),
    ];
    const resourceViewRefreshing =
      resourceView === 'shared'
        ? sharedFilesLoading
        : isSessionResourceView
          ? Object.values(sessionFilesLoadingMap).some(Boolean)
          : taskChangesLoading;
    const handleResourceViewRefresh = () => {
      if (resourceView === 'shared') {
        void fetchSharedResourceFiles();
        return;
      }
      if (isSessionResourceView) {
        refreshSessionResourceFiles();
        return;
      }
      void fetchTaskChanges(currentResourceSession?.sessionId);
    };

    return (
      <div className={styles.detailResourcePanel}>
        <div className={styles.resourceViewTabBar}>
          <Tabs
            activeKey={resourceView}
            className={styles.resourceViewTabs}
            items={resourceViewItems}
            onChange={(key) => setResourceView(key as ResourceView)}
          />
          <button
            type="button"
            className={styles.resourceViewRefresh}
            onClick={handleResourceViewRefresh}
            aria-label={t('common.refresh')}
          >
            <ReloadOutlined spin={resourceViewRefreshing} />
          </button>
        </div>
        <div className={styles.resourceViewContent}>
          {resourceView === 'shared' && (
            <>
              <FileSpaceBlock
                title={t('resource.sharedSpace')}
                loading={sharedFilesLoading}
                items={sharedFiles}
                currentPath={SHARED_FILE_PATH}
                emptyText={t('resource.emptySharedFiles')}
                hideHeader
                fillContainer
                compactTreePadding
                resourceEmptyStyle
                childrenByPath={resourceChildrenByPath}
                expandedKeys={resourceExpandedKeys}
                showActions={!!projectId}
                onExpand={setResourceExpandedKeys}
                onLoadData={loadResourceTreeNode}
                onNodeClick={handleResourceItemClick}
                onNodeDoubleClick={handleResourceItemDoubleClick}
                getActionItems={getSharedResourceFileActionItems}
                onAction={handleSharedResourceFileAction}
              />
            </>
          )}
          {isSessionResourceView && (
            <FileSpaceBlock
              title={t('resource.sessionSpace')}
              emptyText={t(resourceFileScope === 'all' ? 'resource.emptySessions' : 'resource.emptyCurrentSession')}
              // 当前会话只有一个文件树，无需重复展示与二级 Tab 相同的会话分组标题。
              groups={resourceFileScope === 'all' ? sessionGroups : undefined}
              items={currentSessionFiles}
              currentPath={
                currentResourceSession?.sessionId ? getSessionFilePath(`${currentResourceSession.sessionId}`) : '/'
              }
              loading={
                currentResourceSession?.sessionId
                  ? !!sessionFilesLoadingMap[`${currentResourceSession.sessionId}`]
                  : false
              }
              hideHeader
              fillContainer
              resourceEmptyStyle
              childrenByPath={resourceChildrenByPath}
              expandedKeys={resourceExpandedKeys}
              defaultGroupsCollapsed={resourceFileScope === 'all'}
              // “全部会话”仅展开一个分组，避免多棵文件树同时撑开统一的资源内容区。
              accordionGroups={resourceFileScope === 'all'}
              groupCollapseResetKey={resourceFileScope}
              showActions={!!fileResourceId}
              onExpand={setResourceExpandedKeys}
              onLoadData={loadResourceTreeNode}
              onNodeClick={handleResourceItemClick}
              onNodeDoubleClick={handleResourceItemDoubleClick}
              getActionItems={getSessionResourceFileActionItems}
              onAction={handleResourceFileAction}
            />
          )}
          {resourceView === 'changes' && isDevelopProject && renderCodeChanges()}
        </div>
        {renderFileDiffDrawer()}
      </div>
    );
  };

  const renderOperationTaskDetailDrawer = () => {
    if (!detailTask) return null;

    const operationTaskType = normalizeOperationTaskType(detailTask);
    const operationTaskConfig = getOperationTaskConfig(detailTask, operationTaskType);
    const workflowSteps = normalizeOperationWorkflow(detailTask);
    const rawProgress = Number(detailTask.progress ?? 0);
    // 任务进度缺失或不是数字时按 0 展示，避免给 progress 原生控件传入 NaN。
    const progress = Number.isFinite(rawProgress) ? Math.min(100, Math.max(0, rawProgress)) : 0;
    const operationTaskTypeLabel = intl.formatMessage({
      id: `projectSpace.operation.task.type.${operationTaskType}`,
    });
    const platformId = `${
      operationTaskConfig.channel ||
      operationTaskConfig.publishChannel ||
      operationTaskConfig.analysisChannel ||
      operationTaskConfig.platformId ||
      detailTask.platformId ||
      ''
    }`;
    // 任务配置保存后端 OPERATION_CHANNEL 编码，详情展示时再映射为国际化文本。
    const operationPlatformLabelKeyMap: Record<string, string> = {
      WeChatAccount: 'wechat',
      Xiaohongshu: 'xiaohongshu',
      WeChatChannels: 'video',
      Douyin: 'douyin',
    };
    const platformLabelKey = operationPlatformLabelKeyMap[platformId];
    const platformLabel = platformLabelKey
      ? intl.formatMessage({ id: `projectSpace.operation.platform.${platformLabelKey}` })
      : platformId || '-';
    const operationAccountId =
      operationTaskConfig.publishAccountId ??
      operationTaskConfig.analysisAccountId ??
      operationTaskConfig.accountId ??
      detailTask.operationAccountId;
    const operationAccount = operationAccounts.find(
      (account) => `${account.accountId}` === `${operationAccountId}` || `${account.id}` === `${operationAccountId}`
    );
    const rootOperationTaskConfig = parseOperationConfig(detailTask.operationConfig || detailTask.config);
    const controllerAgentId =
      detailTask.controllerAgentId ??
      detailTask.agentSelection?.controllerAgentId ??
      rootOperationTaskConfig.agentSelection?.controllerAgentId ??
      detailTask.operationAgentId;
    const executorAgentIdsValue =
      detailTask.agentIds ??
      detailTask.executorAgentIds ??
      detailTask.agentSelection?.executorAgentIds ??
      rootOperationTaskConfig.agentSelection?.executorAgentIds ??
      detailTask.operationAgentIds;
    const executorAgentIds = normalizeOperationIdentifierList(executorAgentIdsValue);
    const controllerAgent = operationAgents.find((agent) => `${agent.value}` === `${controllerAgentId}`);
    const executorAgentNames = operationAgents
      .filter((agent) => executorAgentIds.some((agentId) => `${agentId}` === `${agent.value}`))
      .map((agent) => agent.label)
      .join(', ');
    const taskDueTime = detailTask.dueTime || detailTask.due || detailTask.deadline;
    const taskIcon =
      operationTaskType === 'collect' ? (
        <CloudDownloadOutlined />
      ) : operationTaskType === 'content' ? (
        <EditOutlined />
      ) : (
        <BarChartOutlined />
      );

    return (
      <Drawer
        title={intl.formatMessage({ id: 'projectSpace.operation.task.detail.title' })}
        className={operationStyles.operationTaskDrawer}
        open
        onClose={() => setDetailTask(null)}
        width={640}
        extra={
          detailTask.sessionId ? (
            canEnterDetailTaskSession ? (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => {
                  handleOpenTaskSession(detailTask);
                  setDetailTask(null);
                }}
              >
                {intl.formatMessage({ id: 'projectSpace.operation.task.detail.enterSession' })}
              </Button>
            ) : (
              <Button
                icon={<EyeOutlined />}
                onClick={() => {
                  handleOpenReadonlySession(detailTask);
                  setDetailTask(null);
                }}
              >
                {intl.formatMessage({ id: 'projectSpace.operation.task.detail.viewSession' })}
              </Button>
            )
          ) : detailTask.status === 'todo' ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => handleOpenOperationTaskExecute(detailTask)}
            >
              {intl.formatMessage({ id: 'projectSpace.operation.execute.action' })}
            </Button>
          ) : null
        }
      >
        <div className={styles.taskDetailDrawerContent}>
          <div className={styles.taskDetailTitle}>{detailTask.title || detailTask.taskName || t('task.unnamed')}</div>
          <div className={styles.taskHero}>
            <div className={styles.taskHeroAgent}>
              <span className={`${styles.taskHeroAvatar} ${operationStyles.operationTaskDetailIcon}`}>{taskIcon}</span>
              <div>
                <small>{operationTaskTypeLabel}</small>
                <strong>{platformLabel}</strong>
              </div>
            </div>
            <div className={styles.taskHeroProgress}>
              <progress className={styles.taskHeroProgressBar} value={progress} max={100} />
              <p>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.progress' }, { progress })}</p>
            </div>
          </div>

          <div className={styles.phaseSection}>
            <h3 className={styles.phaseSectionTitle}>
              {intl.formatMessage({ id: 'projectSpace.operation.task.detail.configuration' })}
            </h3>
            <div className={styles.taskContextGrid}>
              <div className={`${styles.taskContextItem} ${styles.taskContextItemFull}`}>
                <label>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.description' })}</label>
                <strong>{detailTask.description || '-'}</strong>
              </div>
              <div className={styles.taskContextItem}>
                <label>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.assignee' })}</label>
                <strong>{detailTask.assigneeName || detailTask.assignee || '-'}</strong>
              </div>
              <div className={styles.taskContextItem}>
                <label>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.dueTime' })}</label>
                <strong>
                  {taskDueTime && dayjs(taskDueTime).isValid() ? dayjs(taskDueTime).format('YYYY-MM-DD') : '-'}
                </strong>
              </div>
              <div className={styles.taskContextItem}>
                <label>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.account' })}</label>
                <strong>{operationAccount?.accountName || detailTask.accountName || '-'}</strong>
              </div>
              <div className={styles.taskContextItem}>
                <label>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.topic' })}</label>
                <strong>
                  {operationTaskConfig.publishTopic ||
                    operationTaskConfig.collectTopic ||
                    operationTaskConfig.topic ||
                    '-'}
                </strong>
              </div>
              <div className={styles.taskContextItem}>
                <label>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.controllerAgent' })}</label>
                <strong>{controllerAgent?.label || detailTask.controllerAgentName || '-'}</strong>
              </div>
              <div className={styles.taskContextItem}>
                <label>{intl.formatMessage({ id: 'projectSpace.operation.task.detail.executorAgents' })}</label>
                <strong>{executorAgentNames || detailTask.executorAgentNames?.join?.(', ') || '-'}</strong>
              </div>
            </div>
          </div>

          <OperationWorkflowTimeline steps={workflowSteps} />
        </div>
      </Drawer>
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
        {/* 研发和运营任务均支持按创建日期筛选，并通过任务视图查看各状态分布。 */}
        {(isDevelopProject || isOperationProject) && (
          <div className={styles.detailTaskHeaderActions}>
            {(isDevelopProject || isOperationProject) && (
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
            )}
            {isDevelopProject && (
              <Tooltip title={t('task.viewTooltip')} placement="top">
                <Button
                  aria-label={t('task.viewTooltip')}
                  size="small"
                  className={`${styles.detailHeaderActionButton} ${styles.detailTaskViewButton}`}
                  icon={<AppstoreOutlined />}
                  onClick={() => setTaskKanbanOpen(true)}
                />
              </Tooltip>
            )}
            {isOperationProject && (
              <Tooltip title={t('task.viewTooltip')} placement="top">
                <Button
                  aria-label={t('task.viewTooltip')}
                  size="small"
                  className={`${styles.detailHeaderActionButton} ${styles.detailTaskViewButton}`}
                  icon={<AppstoreOutlined />}
                  onClick={() => setTaskKanbanOpen(true)}
                />
              </Tooltip>
            )}
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
                  const rawTaskDueTime = task.dueTime || task.due || task.deadline;
                  const taskDueTime =
                    rawTaskDueTime && dayjs(rawTaskDueTime).isValid()
                      ? dayjs(rawTaskDueTime).format('YYYY-MM-DD')
                      : '-';
                  const operationTaskType = normalizeOperationTaskType(task);
                  const operationTaskTypeLabel = intl.formatMessage({
                    id: `projectSpace.operation.task.type.${operationTaskType}`,
                  });
                  const operationTaskIconClass = {
                    collect: operationStyles.operationTaskIconCollect,
                    content: operationStyles.operationTaskIconContent,
                    analyze: operationStyles.operationTaskIconAnalyze,
                  }[operationTaskType];
                  const showStructuredTaskMeta = isDevelopProject || isOperationProject;
                  // 优先按用户 ID 判断处理人；历史数据缺失 ID 时再用用户名兜底，避免同名用户误判。
                  const isCurrentUserAssignee = isCurrentUserTaskAssignee(task, userInfo);
                  // 普通项目按会话展示；研发任务和运营任务保留负责人及各自的关键时间。
                  const taskDescription = isDevelopProject
                    ? `${taskAssignee} · ${taskCreateTime}`
                    : isOperationProject
                      ? `${taskAssignee} · ${taskDueTime}`
                      : `${task.sessionContent || ''}`;
                  const taskStatusMeta = getTaskStatusMeta(
                    task.operationState || task.status || task.taskStatus || task.currentStatus
                  );
                  // 下拉菜单展开时维持状态标签的让位，防止悬浮菜单遮挡右侧内容。
                  const isTaskActionOpen = openTaskActionId === `${task.taskId}`;
                  const isTaskSelected = selectedTaskId === `${task.taskId}`;
                  const operationTaskActionItems: MenuProps['items'] = [
                    // 运营任务未启动时将“启动”放在详情前，并保持菜单文案简洁。
                    ...(isOperationProject && task.status === 'todo' && !task.sessionId
                      ? [
                        {
                          key: 'execute',
                          label: intl.formatMessage({ id: 'projectSpace.operation.execute.action' }),
                        },
                      ]
                      : []),
                    { key: 'view-detail', label: t('task.viewDetail') },
                  ];

                  return (
                    <div
                      key={task.taskId}
                      className={`${styles.detailTaskCard} ${
                        isOperationProject ? operationStyles.operationTaskCard : ''
                      } ${isTaskSelected ? styles.detailTaskCardActive : ''}`}
                      onClick={() => {
                        setSelectedTaskId(`${task.taskId}`);
                        if (isOperationProject && operationAccountPanelOpen) {
                          // 从账号管理返回任务会话时先释放覆盖层，避免进入会话后仍遮挡主区域。
                          handleCloseOperationAccountPanel();
                        }
                        // 未启动运营需求没有会话，主点击直接打开详情；研发任务仍按处理人控制进入会话。
                        if (isOperationProject && !task.sessionId) {
                          handleOpenTaskDetail(task);
                          return;
                        }
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
                      ) : isOperationProject ? (
                        <Tooltip title={operationTaskTypeLabel} placement="top">
                          <div className={`${operationStyles.operationTaskIcon} ${operationTaskIconClass}`}>
                            {operationTaskType === 'collect' ? (
                              <CloudDownloadOutlined />
                            ) : operationTaskType === 'content' ? (
                              <EditOutlined />
                            ) : (
                              <BarChartOutlined />
                            )}
                          </div>
                        </Tooltip>
                      ) : (
                        <ChatAvatar session={normalizeTaskSession(task, projectId, t)} size={32} />
                      )}
                      <div
                        className={`${styles.detailTaskCardHeader} ${
                          showStructuredTaskMeta ? styles.detailTaskCardHeaderWithAction : ''
                        } ${isTaskActionOpen ? styles.detailTaskCardHeaderWithActionOpen : ''}`}
                      >
                        <div className={styles.detailTaskMain}>
                          <div className={styles.detailTaskTitleRow}>
                            <h4 className={styles.detailTaskTitle}>
                              {task.title || task.taskName || t('task.unnamed')}
                            </h4>
                          </div>
                          {/* 任务名称和描述仅用于列表扫读，不显示悬停提示。 */}
                          <p className={styles.detailTaskDescription}>{taskDescription}</p>
                        </div>
                        {/* 普通项目按会话展示，不显示统一任务状态。 */}
                        {showStructuredTaskMeta && (
                          <Tag
                            bordered={false}
                            className={`${styles.detailTaskStatusTag} ${
                              styles[`detailTaskStatus${taskStatusMeta.className}`]
                            }`}
                          >
                            {t(taskStatusMeta.labelId)}
                          </Tag>
                        )}
                        {showStructuredTaskMeta && (
                          <Dropdown
                            trigger={['hover']}
                            placement="bottomRight"
                            onOpenChange={(open) => setOpenTaskActionId(open ? `${task.taskId}` : undefined)}
                            menu={{
                              items: operationTaskActionItems,
                              onClick: ({ key, domEvent }) => {
                                domEvent.preventDefault();
                                domEvent.stopPropagation();
                                setSelectedTaskId(`${task.taskId}`);
                                setOpenTaskActionId(undefined);
                                if (key === 'execute') {
                                  handleOpenOperationTaskExecute(task);
                                } else {
                                  handleOpenTaskDetail(task);
                                }
                              },
                            }}
                          >
                            {/* 结构化任务详情作为辅助操作，卡片主点击仍进入任务会话。 */}
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
            <Empty
              className={isOperationProject ? operationStyles.operationTaskEmpty : undefined}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                isOperationProject ? intl.formatMessage({ id: 'projectSpace.operation.task.empty' }) : t('common.empty')
              }
            />
          )}
          {tasksLoadingMore && tasks.length > 0 && (
            <div className={styles.detailTaskLoadingMore}>
              <Spin size="small" />
            </div>
          )}
        </Spin>
      </div>

      {(isDevelopProject || isOperationProject) && (
        <SessionOverviewDrawer
          open={taskKanbanOpen}
          onClose={() => setTaskKanbanOpen(false)}
          projectId={projectId}
          operationProject={isOperationProject}
          // 整体任务视图沿用任务列表的处理人校验和进入会话逻辑。
          canEnterSession={(task) => isCurrentUserTaskAssignee(task, userInfo)}
          onEnterSession={(task) => {
            handleOpenTaskSession(task);
            setTaskKanbanOpen(false);
          }}
        />
      )}

      {isOperationProject ? (
        renderOperationTaskDetailDrawer()
      ) : (
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
      )}
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
    if (activeTab === 'digitalAgents') {
      if (isDevelopProject) {
        return (
          <div className={styles.detailEmbeddedContent}>
            <ProjectDefaultAgentPanel projectId={projectId} active={activeTab === 'digitalAgents'} />
          </div>
        );
      }
      return renderTasks();
    }
    if (activeTab === 'integration') {
      if (showIntegrationTab) return <Integration active projectId={projectId} repos={repos} />;
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
    return isOperationProject ? renderOperationRequirements() : renderRequirements();
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
                  // 渠道表单里的「+」直接进新增表单,建完回填仓库,不经过列表。
                  setRepoFormOpen(true);
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
                // 手工需求表单里的「+」直接进新增表单,建完回填仓库,不经过列表。
                setRepoFormOpen(true);
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
          <MarkdownField
            value={manualRequirementForm.originalContent}
            maxLength={MANUAL_REQUIREMENT_CONTENT_MAX_LENGTH}
            rows={4}
            placeholder={t('manualRequirement.placeholder.originalContent')}
            onChange={(originalContent) => setManualRequirementForm((prev) => ({ ...prev, originalContent }))}
          />
        </div>
        <div className={`${styles.formField} ${styles.manualRequirementFormFull}`}>
          <label>{t('manualRequirement.field.productContent')}</label>
          <MarkdownField
            value={manualRequirementForm.productContent}
            maxLength={MANUAL_REQUIREMENT_CONTENT_MAX_LENGTH}
            rows={4}
            placeholder={t('manualRequirement.placeholder.productContent')}
            onChange={(productContent) => setManualRequirementForm((prev) => ({ ...prev, productContent }))}
          />
        </div>
      </div>
    </Modal>
  );

  // 新增仓库表单弹窗:独立于列表,建完自动关闭。source/manualRequirement 入口直接打开此弹窗。
  const renderRepoFormModal = () => (
    <Modal
      title={t('repository.create')}
      open={repoFormOpen}
      onCancel={() => setRepoFormOpen(false)}
      onOk={handleCreateRepo}
      confirmLoading={repoSaving}
      okText={t('repository.create')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !repoForm.repoFullName.trim() }}
      width={480}
      // 从列表弹窗(zIndex 1100)或渠道/需求弹窗内再叠一层,需盖在上方。
      zIndex={1200}
    >
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
    </Modal>
  );

  // 仓库列表弹窗:先看已有仓库,顶部「新增仓库」按钮弹出独立表单。仅 manage 入口用列表;
  // source/manualRequirement 入口直接开表单(repoFormOpen),不展示这一层。
  const renderRepoModal = () => (
    <>
      <Modal
        title={t('repository.modalTitle')}
        open={repoModalOpen}
        onCancel={() => setRepoModalOpen(false)}
        footer={<Button onClick={() => setRepoModalOpen(false)}>{t('common.close')}</Button>}
        width={560}
        // 仓库弹窗可从渠道或需求弹窗内打开，需要始终覆盖在父弹窗上方。
        zIndex={1100}
      >
        <div className={styles.repoManageHeader}>
          <label>{t('repository.field.existing')}</label>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
              setRepoFormOpen(true);
            }}
          >
            {t('repository.create')}
          </Button>
        </div>
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
      </Modal>
      {renderRepoFormModal()}
    </>
  );

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
    // 运营项目通过“新增需求”维护运营需求，不提供研发扫描渠道入口。
    ...(showRequirementsTab && !isOperationProject ? [{ key: 'add-source', label: t('source.addTitle') }] : []),
    // 运营项目的常用新增入口集中到详情右上角更多菜单，和需求页内入口使用同一套打开逻辑。
    ...(isOperationProject
      ? [
        {
          key: 'add-operation-account',
          label: intl.formatMessage({ id: 'projectSpace.operation.account.add' }),
        },
        {
          key: 'add-operation-requirement',
          label: intl.formatMessage({ id: 'projectSpace.operation.requirement.new' }),
        },
      ]
      : []),
    // 研发项目一个项目挂多个仓库,提供独立的仓库管理入口(列表 + 新增,复用仓库弹窗)。
    ...(isDevelopProject ? [{ key: 'manage-repos', label: t('repository.manageTitle') }] : []),
    ...(onEditProject ? [{ key: 'edit-project', label: t('project.edit') }] : []),
    ...(onDeleteProject ? [{ key: 'delete-project', label: t('project.delete'), danger: true }] : []),
    // 非创建者通过项目菜单退出，成员列表不再提供“移除自己”入口。
    ...(!isProjectCreator ? [{ key: 'exit-project', label: t('project.exit'), danger: true }] : []),
  ];

  const handleDetailAction = ({ key }: { key: string }) => {
    if (key === 'add-source') {
      handleHeaderAdd();
      return;
    }
    if (key === 'add-operation-account') {
      handleOpenOperationAccountPanel();
      return;
    }
    if (key === 'add-operation-requirement') {
      handleOpenOperationTaskModal();
      return;
    }
    if (key === 'manage-repos') {
      setRepoModalTarget('manage');
      setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
      setRepoModalOpen(true);
      return;
    }
    if (key === 'edit-project' && project) {
      onEditProject?.(project);
      return;
    }
    if (key === 'delete-project' && project) {
      onDeleteProject?.(project);
      return;
    }
    if (key === 'exit-project') {
      handleExitProject();
    }
  };

  // 文件资源树保留滚动条；其余三个紧凑列表仅隐藏滚动条外观，仍可正常滚动。
  const hideDetailBodyScrollbar = ['requirements', 'tasks', 'members'].includes(activeTab);
  const isRequirementsTab = activeTab === 'requirements';
  const isTasksTab = activeTab === 'tasks' || (activeTab === 'requirements' && !showRequirementsTab);
  const isResourcesTab = activeTab === 'resources';
  const isMembersTab = activeTab === 'members' && showMembersTab;

  return (
    <div className={`${styles.projectDetailPanel} ${detailPanelTabCountClass}`}>
      <div className={styles.detailPanelHeader}>
        <Button className={styles.detailBackButton} icon={<LeftOutlined />} onClick={onBack} />
        <div className={styles.detailPanelTitle}>
          {/* 详情头部项目名称改为下拉选择，切换后直接刷新当前详情面板。 */}
          {onSwitchProject && projects && projects.length > 0 ? (
            <Select
              className={styles.detailProjectSelect}
              variant="borderless"
              showSearch
              optionFilterProp="label"
              value={project?.projectId}
              onChange={(value) => onSwitchProject(value)}
              options={projects.map((p) => ({
                value: p.projectId,
                label: p.projectName,
              }))}
              optionLabelProp="label"
            />
          ) : (
            <h3>{project?.projectName || t('project.detailTitle')}</h3>
          )}
          {projectScenes && (
            <span className={`${styles.projectTagGroup} ${styles.detailProjectSceneTag}`}>
              {projectScenes.map((scene) => (
                <Tag
                  key={scene.classSuffix}
                  bordered={false}
                  className={`${styles.projectTag} ${styles[`projectTag${scene.classSuffix}`]}`}
                >
                  {scene.text}
                </Tag>
              ))}
            </span>
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
          } ${isResourcesTab ? styles.detailResourcesBodyPanel : ''} ${
            isMembersTab ? styles.detailMembersBodyPanel : ''
          }`}
        >
          {renderTabContent()}
        </div>
      </Spin>
      {renderAddSourceModal()}
      {renderManualRequirementModal()}
      <RequirementSplitModal
        open={splitRequirement !== null || operationTaskSplitTarget !== null}
        requirement={
          splitRequirement || operationTaskSplitTarget
            ? {
              title: (splitRequirement || operationTaskSplitTarget).title,
              description: splitRequirement
                ? getRequirementDetailText(splitRequirement, t)
                : operationTaskSplitTarget.description,
            }
            : null
        }
        repos={repos}
        onAddRepository={() => {
          // 拆分弹窗内直接新增仓库，新增表单以更高层级展示并保留当前拆分上下文。
          setRepoModalTarget('requirementSplit');
          setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
          setRepoFormOpen(true);
        }}
        members={operationAssigneeOptions}
        defaultAssigneeId={defaultProjectAssigneeId}
        confirmLoading={
          operationTaskSplitTarget
            ? operationTaskExecuting
            : splitRequirement
              ? startingRequirementIds.has(splitRequirement.itemId)
              : false
        }
        onCancel={() => {
          if (operationTaskSplitTarget) {
            setOperationTaskSplitTarget(null);
            return;
          }
          setSplitRequirement(null);
        }}
        onConfirm={(splitTasks) => {
          if (operationTaskSplitTarget) {
            void handleConfirmOperationTaskSplit(splitTasks);
            return;
          }
          void handleConfirmSplit(splitTasks);
        }}
      />
      {renderRepoModal()}
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
