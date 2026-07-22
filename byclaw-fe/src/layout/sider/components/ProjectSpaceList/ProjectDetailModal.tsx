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
  ClockCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  DingdingOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  GithubOutlined,
  LeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useDispatch, useIntl, useNavigate, useSelector } from '@umijs/max';
import dayjs, { type Dayjs } from 'dayjs';
import {
  checkDwsAuthStatus,
  checkGitHubPat,
  createProjectRepo,
  createScanSource,
  createTask,
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
  updateScanSource,
  type DevloopProjectSpaceFile,
  type DevloopTaskChanges,
  type DevloopTaskFileDiff,
} from '@/service/devloop';
import { deleteFiles, listFiles, renameFile, type FileBrowserItem } from '@/service/fileBrowser';
import SessionOverviewDrawer from './SessionOverviewDrawer';
import TaskDetailDrawer from './TaskDetailDrawer';
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

type SourceType = 'dingtalk' | 'github_issue';

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
};

type TaskDateRange = [Dayjs | null, Dayjs | null] | null;

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
};

type ManualRequirementForm = {
  sourceType: string;
  branch: string;
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
  developProjectEnabled?: boolean;
};

const REQUIREMENT_PAGE_SIZE = 20;
// 任务列表固定页大小，取消分页器后按此值触底追加。
const TASK_PAGE_SIZE = 20;

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
  type: 'dingtalk',
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
});

const getDefaultManualRequirementForm = (): ManualRequirementForm => ({
  sourceType: 'manual',
  branch: 'develop',
  title: '',
  originalContent: '',
  productContent: '',
});

const formatConfig = (type: string, config: string | undefined, t: ProjectDetailTranslate) => {
  try {
    const parsedConfig = JSON.parse(config || '{}');
    if (type === 'dingtalk') return parsedConfig.chatName || parsedConfig.chatId || parsedConfig.groupId || '-';
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
  if (sourceType === 'dingtalk') return <DingdingOutlined />;
  return <GithubOutlined />;
};

const getSourceLabel = (sourceType: string | undefined, t: ProjectDetailTranslate) => {
  if (sourceType === 'dingtalk') return t('source.type.dingtalk');
  if (sourceType === 'github_issue') return t('source.type.githubIssues');
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
  developProjectEnabled = false,
}) => {
  const intl = useIntl();
  // 项目详情的所有固定界面文案统一从 detail 命名空间读取。
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.detail.${id}` }, values),
    [intl]
  );
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const { EventEmitter, sessionId: activeChatSessionId, setSessionId } = useGlobal();
  const activeSiderAgent = useActiveSiderAgent();
  const { setDetailPanel, clearDetailPanel } = React.useContext(SiderContentContext);
  const [activeTab, setActiveTab] = useState('requirements');
  const [sources, setSources] = useState<ScanSourceItem[]>([]);
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
  const [sourceForm, setSourceForm] = useState<SourceForm>(getDefaultSourceForm);
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
  const [taskKanbanOpen, setTaskKanbanOpen] = useState(false);
  // 研发任务通过更多操作打开环节详情抽屉，不必先经整体视图。
  const [detailTask, setDetailTask] = useState<any>(null);
  // 记录任务列表最近一次点击项，详情打开或进入会话后仍保留选中反馈。
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  // 菜单展开时保持研发任务的更多操作可见，避免鼠标移入菜单后图标闪动。
  const [openTaskActionId, setOpenTaskActionId] = useState<string>();
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [repoForm, setRepoForm] = useState({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
  const [repoSaving, setRepoSaving] = useState(false);
  const [manualRequirementOpen, setManualRequirementOpen] = useState(false);
  const [manualRequirementForm, setManualRequirementForm] = useState<ManualRequirementForm>(
    getDefaultManualRequirementForm
  );
  const groupSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requirementSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwsAuthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dwsAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRequirementIdsRef = useRef<Set<number>>(new Set());
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
  // 需求和成员配置只服务研发项目，普通共享项目也不展示这两个 Tab。
  const showRequirementsTab = isDevelopProject;
  const showMembersTab = isDevelopProject;

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

  const fetchSources = useCallback(async () => {
    if (!projectId) return [];
    setSourcesLoading(true);
    try {
      const sourceList = (await listScanSources(projectId)) || [];
      setSources(sourceList);
      return sourceList as ScanSourceItem[];
    } finally {
      setSourcesLoading(false);
    }
  }, [projectId]);

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
      ...(showMembersTab ? [{ key: 'members', label: t('tabs.members') }] : []),
    ],
    [showMembersTab, showRequirementsTab, t]
  );

  const detailPanelTabCountClass = styles[`projectDetailPanelTabCount${tabItems.length}`] || '';

  const resetSourceForm = (type: SourceType = 'dingtalk') => {
    setEditingSource(null);
    setSourceForm({
      ...getDefaultSourceForm(),
      type,
    });
    setGroupOptions([]);
  };

  const openAddSourceModal = (type: SourceType = 'dingtalk') => {
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

  const handleManualRequirementSubmit = () => {
    if (!manualRequirementForm.title.trim()) {
      message.warning(t('manualRequirement.validation.titleRequired'));
      return;
    }
    if (!manualRequirementForm.originalContent.trim()) {
      message.warning(t('manualRequirement.validation.originalContentRequired'));
      return;
    }

    // 后端人工新增需求接口还未接入，先保留表单与校验，避免前端伪造需求数据导致后续状态不一致。
    message.info(t('manualRequirement.unavailable'));
  };

  const handleSaveSource = async () => {
    if (!projectId) return;
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
        keyword: sourceForm.keywords || '需求',
        lookbackHours: parseInt(sourceForm.lookbackHours, 10) || 24,
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
    }
  };

  const handleEditSource = (source: ScanSourceItem) => {
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
      setSourceForm((prev) => ({ ...prev, repoId: res.repoId }));
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
              {(repoLabel(source.repoId) || source.sourceType === 'dingtalk') && (
                <div className={styles.detailSourceAuth}>
                  {repoLabel(source.repoId) && (
                    <Tag icon={<GithubOutlined />} bordered={false} color="blue">
                      {repoLabel(source.repoId)}
                    </Tag>
                  )}
                  {source.sourceType === 'dingtalk' &&
                    (dwsAuthed ? (
                      <Tag
                        className={`${styles.detailSourceDwsTag} ${styles.detailSourceDwsTagClickable}`}
                        color="green"
                        onClick={() => setDwsAuthDetailVisible(true)}
                      >
                        {dwsExpiresAt
                          ? t('dws.authorizedUntil', { expiry: dayjs(dwsExpiresAt).format('MM-DD HH:mm') })
                          : t('dws.authorized')}
                      </Tag>
                    ) : dwsExpired ? (
                      <Tag
                        className={`${styles.detailSourceDwsTag} ${styles.detailSourceDwsTagClickable}`}
                        color="red"
                        onClick={handleStartDwsAuth}
                      >
                        {t('dws.authorizationExpired')}
                      </Tag>
                    ) : (
                      <Tag
                        className={`${styles.detailSourceDwsTag} ${styles.detailSourceDwsTagClickable}`}
                        color="orange"
                        onClick={handleStartDwsAuth}
                      >
                        {t('dws.authorizationRequired')}
                      </Tag>
                    ))}
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

  // 需求列表保持紧凑，完整字段统一在右侧抽屉展示。
  const renderRequirementDetailDrawer = () => {
    if (!detailReq) return null;
    const detail = parseScoreDetail(detailReq.scoreDetail);
    const sourceLabel = getSourceLabel(detailReq.sourceType, t);
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
            {/* 人工新增需求接口未接入，等后端接口可用后再恢复入口。 */}
            {/* <Tooltip title={t('manualRequirement.title')} placement="top">
              <Button size="small" icon={<PlusOutlined />} onClick={openManualRequirementModal} />
            </Tooltip> */}
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
                const isStarted = !!item.sessionId;
                const detailText = getRequirementDetailText(item, t);

                return (
                  <div
                    key={item.itemId}
                    className={styles.detailRequirementItem}
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

  // 资源 Tab 顶部的“代码变更”卡片:仅研发项目有任务/分支概念,普通项目隐藏。
  const renderCodeChanges = () => {
    if (!isDevelopProject) return null;
    const empty = (id: string, values?: Record<string, string | number>) => (
      <div className={styles.codeChangeEmpty}>{taskChangesLoading ? t('codeChanges.loading') : t(id, values)}</div>
    );

    let body: React.ReactNode;
    const status = taskChanges?.status;
    if (!currentResourceSession?.sessionId) {
      body = empty('codeChanges.selectSession');
    } else if (taskChangesLoading && !taskChanges) {
      body = empty('codeChanges.loading');
    } else if (!taskChanges || status === 'http_error') {
      body = taskChanges?.message ? (
        <div className={styles.codeChangeEmpty}>{taskChanges.message}</div>
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
            {taskChanges?.source === 'local' && status === 'ok' ? (
              <span className={styles.codeChangeLocalBadge}>{t('codeChanges.localBadge')}</span>
            ) : null}
          </div>
          {status === 'ok' && taskChanges?.files?.length ? (
            <span className={styles.codeChangeCount}>{taskChanges.files.length}</span>
          ) : null}
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
        <FileSpaceBlock
          title={t('resource.sessionSpace')}
          emptyText={t(resourceFileScope === 'all' ? 'resource.emptySessions' : 'resource.emptyCurrentSession')}
          groups={sessionGroups}
          childrenByPath={resourceChildrenByPath}
          expandedKeys={resourceExpandedKeys}
          switchValue={resourceFileScope}
          defaultGroupsCollapsed={resourceFileScope === 'all'}
          // “全部会话”只允许展开一个会话，避免多个文件树同时撑开资源卡片。
          accordionGroups={resourceFileScope === 'all'}
          groupCollapseResetKey={resourceFileScope}
          showActions={!!fileResourceId}
          switchOptions={[
            { label: t('resource.currentSession'), value: 'current' },
            { label: t('resource.allSessions'), value: 'all' },
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
                  const taskAssigneeId = task.assigneeId ?? task.createBy;
                  const currentUserId = userInfo?.userId ?? userInfo?.id;
                  // 优先按用户 ID 判断处理人；历史数据缺失 ID 时再用用户名兜底，避免同名用户误判。
                  const isCurrentUserAssignee =
                    taskAssigneeId && currentUserId
                      ? `${taskAssigneeId}` === `${currentUserId}`
                      : !!taskAssignee && !!userInfo?.userName && taskAssignee === userInfo.userName;
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
                          setDetailTask(task);
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
                                setDetailTask(task);
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

      <SessionOverviewDrawer open={taskKanbanOpen} onClose={() => setTaskKanbanOpen(false)} projectId={projectId} />

      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} />
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
    if (activeTab === 'members') {
      if (showMembersTab) {
        return (
          <div className={styles.detailEmbeddedContent}>
            <ProjectMemberList
              projectId={projectId}
              creatorId={project?.createBy}
              onMembersChange={handleMembersChange}
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
      title={t(editingSource ? 'source.editTitle' : 'source.addTitle')}
      open={sourceModalOpen}
      onOk={handleSaveSource}
      onCancel={() => {
        setSourceModalOpen(false);
        setEditingSource(null);
        setGroupOptions([]);
      }}
      okText={t(editingSource ? 'common.save' : 'common.add')}
      // 新增和编辑渠道共用更宽的双列表单空间，仓库选择器不会挤压扫描频率。
      width={760}
      className={styles.sourceModal}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
      <div className={styles.formGrid}>
        <div className={styles.formField}>
          <label>{t('source.field.type')}</label>
          <Select
            value={sourceForm.type}
            disabled={!!editingSource}
            onChange={(type) => setSourceForm((prev) => ({ ...prev, type }))}
            options={[
              { value: 'dingtalk', label: t('source.type.dingtalkGroup') },
              { value: 'github_issue', label: t('source.type.githubIssue') },
            ]}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('source.field.name')}</label>
          <Input
            placeholder={t('source.placeholder.name')}
            value={sourceForm.name}
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
              onChange={(repoId) => setSourceForm((prev) => ({ ...prev, repoId }))}
              options={repos.map((repo) => ({
                value: repo.repoId,
                label: repo.repoFullName || repo.repoUrl || String(repo.repoId),
              }))}
              notFoundContent={repos.length ? undefined : t('source.noRepositories')}
            />
            <Button
              className={styles.sourceRepoAddButton}
              icon={<PlusOutlined />}
              onClick={() => {
                setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
                setRepoModalOpen(true);
              }}
            >
              {t('common.add')}
            </Button>
          </Space.Compact>
        </div>
        <div className={styles.formField}>
          <label>{t('source.field.scanFrequency')}</label>
          <Select
            value={sourceForm.cron}
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
        {sourceForm.type === 'dingtalk' && (
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
            <div className={styles.formField}>
              <label>{t('source.field.dingtalkGroup')}</label>
              <Select
                showSearch
                filterOption={false}
                placeholder={t('source.placeholder.groupSearch')}
                value={sourceForm.chatId || undefined}
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
                onChange={(event) => setSourceForm((prev) => ({ ...prev, keywords: event.target.value }))}
              />
            </div>
            <div className={styles.formField}>
              <label>{t('source.field.lookbackHours')}</label>
              <Select
                value={sourceForm.lookbackHours}
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
        {sourceForm.type === 'github_issue' && (
          <>
            {!hasPatSaved && (
              <div className={styles.formField}>
                <label>{t('source.field.githubPat')}</label>
                <Input.Password
                  placeholder={t('source.placeholder.githubPat')}
                  value={sourceForm.pat}
                  onChange={(event) => setSourceForm((prev) => ({ ...prev, pat: event.target.value }))}
                />
              </div>
            )}
            <div className={styles.formField}>
              <label>{t('source.field.labelFilter')}</label>
              <Input
                placeholder={t('source.placeholder.labelFilter')}
                value={sourceForm.labels}
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
          <h3>{t('manualRequirement.title')}</h3>
          <p>{t('manualRequirement.description')}</p>
        </div>
      }
      open={manualRequirementOpen}
      onCancel={() => setManualRequirementOpen(false)}
      onOk={handleManualRequirementSubmit}
      okText={t('manualRequirement.submit')}
      cancelText={t('common.cancel')}
      width={720}
      className={styles.manualRequirementModal}
    >
      <div className={styles.manualRequirementForm}>
        <div className={styles.manualRequirementRow}>
          <div className={styles.formField}>
            <label>{t('manualRequirement.field.sourceType')}</label>
            <Select
              value={manualRequirementForm.sourceType}
              onChange={(sourceType) => setManualRequirementForm((prev) => ({ ...prev, sourceType }))}
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
              placeholder="develop"
              value={manualRequirementForm.branch}
              onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, branch: event.target.value }))}
            />
          </div>
        </div>
        <div className={styles.formField}>
          <label>{t('manualRequirement.field.title')}</label>
          <Input
            placeholder={t('manualRequirement.placeholder.title')}
            value={manualRequirementForm.title}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('manualRequirement.field.originalContent')}</label>
          <Input.TextArea
            placeholder={t('manualRequirement.placeholder.originalContent')}
            rows={4}
            value={manualRequirementForm.originalContent}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, originalContent: event.target.value }))}
          />
        </div>
        <div className={styles.formField}>
          <label>{t('manualRequirement.field.productContent')}</label>
          <Input.TextArea
            placeholder={t('manualRequirement.placeholder.productContent')}
            rows={4}
            value={manualRequirementForm.productContent}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, productContent: event.target.value }))}
          />
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
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
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
