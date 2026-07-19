import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Drawer,
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
  FileTextOutlined,
  GithubOutlined,
  LeftOutlined,
  MessageOutlined,
  PartitionOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useIntl, useNavigate } from '@umijs/max';
import dayjs from 'dayjs';
import {
  checkDwsAuthStatus,
  checkGitHubPat,
  createProjectRepo,
  createScanSource,
  createTask,
  deleteProjectRepo,
  deleteScanSource,
  getProject,
  getTaskPhases,
  listProjectSessionsByQo,
  listProjectMembers,
  listRequirementsBySource,
  listScanLogs,
  listScanSources,
  listTasks,
  saveGitHubPat,
  searchDingtalkGroups,
  startDwsDeviceAuth,
  toggleScanSource,
  triggerScan,
  updateScanSource,
} from '@/service/devloop';
import { deleteFiles, listFiles, renameFile, type FileBrowserItem } from '@/service/fileBrowser';
import SessionOverviewDrawer from './SessionOverviewDrawer';
import TaskDetailDrawer from './TaskDetailDrawer';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import { getArrayData, normalizeProjectSession } from '@/pages/projectSpace/utils';
import AntdIcon from '@/components/AntdIcon';
import RenameModal from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import FileSpaceBlock, {
  getFileSpaceFileCount,
} from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
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
  getParentDirectoryPath,
  getSessionFilePath,
  isDirectory,
  isPathIn,
  normalizeFileBrowserPath,
  normalizeReferenceItem,
  sortFileBrowserItems,
  unwrapListResponse,
} from '@/layout/sider/components/FileSiderPanel/utils';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import ProjectMemberList from './ProjectMemberList';
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

const SCORE_DIMENSIONS: { key: keyof ScoreDetail; label: string; max: number }[] = [
  { key: 'businessValue', label: '业务价值', max: 30 },
  { key: 'userImpact', label: '用户影响', max: 20 },
  { key: 'urgency', label: '紧迫度', max: 15 },
  { key: 'strategyFit', label: '战略匹配', max: 15 },
  { key: 'feasibility', label: '实现可行性', max: 10 },
  { key: 'reuseValue', label: '复用价值', max: 10 },
];

const priorityColor = (priority?: string | null) =>
  priority === 'P0' ? 'red' : priority === 'P1' ? 'orange' : 'default';

// 综合分配色：>=80 绿，>=60 蓝，<60 橙；无分灰
const scoreBg = (score?: number | null) => {
  if (score == null) return '#f0f0f0';
  if (score >= 80) return '#e9f8f0';
  if (score >= 60) return '#eaf2ff';
  return '#fff3dc';
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

type Props = {
  project?: ProjectSpace;
  onBack: () => void;
  onEditProject?: (project: ProjectSpace) => void;
  onProjectSharedChange?: (projectId: string | number) => void;
};

const REQUIREMENT_PAGE_SIZE = 20;

const PHASE_COLORS: Record<string, string> = {
  分诊: 'orange',
  设计: 'blue',
  编码: 'green',
  测试: 'purple',
  审批: 'cyan',
  发布: 'gold',
};

// 任务状态色（状态存于 byai_session_ext，看板与卡片共用）
const STATUS_COLORS: Record<string, string> = {
  待开始: 'default',
  进行中: 'blue',
  暂停: 'orange',
  完成: 'green',
};

// 环节状态 → 展开区横向概要小节点样式（与 TaskDetailDrawer 竖向流程口径一致）
const PHASE_STATE_META: Record<string, { cls: string; icon: string }> = {
  done: { cls: 'phaseMiniDone', icon: '✓' },
  running: { cls: 'phaseMiniActive', icon: '●' },
  rejected: { cls: 'phaseMiniRejected', icon: '↩' },
  pending: { cls: 'phaseMiniWaiting', icon: '○' },
};

const cronPresets = [
  { value: '*/1 * * * *', label: '每1分钟' },
  { value: '*/5 * * * *', label: '每5分钟' },
  { value: '*/15 * * * *', label: '每15分钟' },
  { value: '*/30 * * * *', label: '每30分钟' },
  { value: '0 */1 * * *', label: '每1小时' },
  { value: '0 */2 * * *', label: '每2小时' },
  { value: '0 9,14,18 * * 1-5', label: '工作日 9/14/18点' },
];

const getCronDisplayText = (cronExpr?: string) => {
  // 渠道卡片展示用户可读的扫描频率，避免直接暴露 cron 表达式。
  if (!cronExpr) return '手动';
  const matchedPreset = cronPresets.find((preset) => preset.value === cronExpr);
  if (matchedPreset) return `${matchedPreset.label}扫描`;

  const minuteMatch = cronExpr.match(/^\*\/(\d+) \* \* \* \*$/);
  if (minuteMatch) return `每${minuteMatch[1]}分钟扫描`;

  const hourMatch = cronExpr.match(/^0 \*\/(\d+) \* \* \*$/);
  if (hourMatch) return `每${hourMatch[1]}小时扫描`;

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

const formatConfig = (type: string, config?: string) => {
  try {
    const parsedConfig = JSON.parse(config || '{}');
    if (type === 'dingtalk') return parsedConfig.chatName || parsedConfig.chatId || parsedConfig.groupId || '-';
    if (type === 'github_issue') return parsedConfig.labels ? `标签: ${parsedConfig.labels}` : '全部 Issue';
    return '-';
  } catch {
    return '-';
  }
};

const getSourceIcon = (sourceType: string) => {
  if (sourceType === 'dingtalk') return <DingdingOutlined />;
  return <GithubOutlined />;
};

const getSourceLabel = (sourceType?: string) => {
  if (sourceType === 'dingtalk') return '钉钉';
  if (sourceType === 'github_issue') return 'GitHub Issues';
  return '需求来源';
};

const getSessionResourceName = (session: Partial<ProjectResourceSession>) => session?.sessionName || '未命名会话';

const getRequirementDetailText = (requirement: RequirementItem) =>
  requirement.productContent ||
  requirement.originalContent ||
  requirement.content ||
  requirement.description ||
  requirement.summary ||
  requirement.title ||
  '-';

// 资源 tab 下会话文件路径形如 /.sessions/{sessionId}/，操作后需要按会话刷新对应目录。
const getResourceSessionIdByPath = (path: string) => {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  if (!isPathIn(normalizedPath, SESSION_FILE_PATH)) return '';
  return normalizedPath.slice(SESSION_FILE_PATH.length).split('/').filter(Boolean)[0] || '';
};

const ProjectDetailPanel: React.FC<Props> = ({ project, onBack, onEditProject, onProjectSharedChange }) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { EventEmitter, sessionId: activeChatSessionId, setSessionId } = useGlobal();
  const activeSiderAgent = useActiveSiderAgent();
  const { setDetailPanel, clearDetailPanel } = React.useContext(SiderContentContext);
  const [activeTab, setActiveTab] = useState('requirements');
  const [sources, setSources] = useState<ScanSourceItem[]>([]);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [visibleRequirementCount, setVisibleRequirementCount] = useState(REQUIREMENT_PAGE_SIZE);
  const [detailReq, setDetailReq] = useState<RequirementItem | null>(null);
  const [expandedRequirementId, setExpandedRequirementId] = useState<number | null>(null);
  const [startingRequirementIds, setStartingRequirementIds] = useState<Set<number>>(() => new Set());
  const [tasks, setTasks] = useState<any[]>([]);
  const [, setMembers] = useState<any[]>([]);
  const [resourceFileScope, setResourceFileScope] = useState<ResourceFileScope>('current');
  const [sharedFiles, setSharedFiles] = useState<FileBrowserItem[]>([]);
  const [sharedFilesLoading, setSharedFilesLoading] = useState(false);
  const [resourceSessions, setResourceSessions] = useState<ProjectResourceSession[]>([]);
  const [sessionFilesMap, setSessionFilesMap] = useState<Record<string, FileBrowserItem[]>>({});
  const [sessionFilesLoadingMap, setSessionFilesLoadingMap] = useState<Record<string, boolean>>({});
  const [resourceChildrenByPath, setResourceChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [resourceExpandedKeys, setResourceExpandedKeys] = useState<React.Key[]>([]);
  const [resourceRenameOpen, setResourceRenameOpen] = useState(false);
  const [resourceRenameTarget, setResourceRenameTarget] = useState<FileBrowserItem | null>(null);
  const [resourceRenameLoading, setResourceRenameLoading] = useState(false);
  const [lastLog, setLastLog] = useState<ScanLogEntry | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [requirementsLoading, setRequirementsLoading] = useState(false);
  const [requirementsRefreshLoading, setRequirementsRefreshLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
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
  // 左侧小面板内直接展开任务详情，避免在窄侧栏里再叠右侧抽屉。
  const [expandedTaskId, setExpandedTaskId] = useState<string | number | null>(null);
  // 展开任务时按 sessionId 拉环节概要，缓存于 map 避免重复请求。
  const [taskPhaseMap, setTaskPhaseMap] = useState<Record<string, any>>({});
  const [taskKanbanOpen, setTaskKanbanOpen] = useState(false);
  // 列表项直接打开环节详情抽屉，不必先经整体视图。
  const [detailTask, setDetailTask] = useState<any>(null);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [repoForm, setRepoForm] = useState({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
  const [repoSaving, setRepoSaving] = useState(false);
  const [manualRequirementOpen, setManualRequirementOpen] = useState(false);
  const [manualRequirementForm, setManualRequirementForm] = useState<ManualRequirementForm>(
    getDefaultManualRequirementForm
  );
  const groupSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwsAuthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dwsAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRequirementIdsRef = useRef<Set<number>>(new Set());
  const resourceClickTimerRef = useRef<number | null>(null);

  const projectId = Number(project?.projectId);
  // 项目类型来自后端/静态参数，先按字符串归一，避免默认项目枚举声明不同步时报比较类型错误。
  const projectType = project?.projectType ? String(project.projectType) : undefined;
  const isDevelopProject = projectType === 'develop';
  // 标题下方展示项目描述字段，避免继续显示固定的项目类型详情文案。
  const projectDescription = project?.description?.trim() || '暂无描述';
  const fileResourceId = activeSiderAgent.resourceId || (project?.resourceId ? `${project.resourceId}` : '');
  const { handlePreview: handleResourcePreview, handleDownload: handleResourceDownload } = useFilePreviewActions({
    resourceId: fileResourceId,
    EventEmitter,
    previewClassName: fileSiderStyles.previewContent,
  });
  // 研发项目、普通共享项目展示需求 tab；默认项目和普通未共享项目不展示。
  const showRequirementsTab = isDevelopProject || (projectType === 'normal' && !!project?.sharedFlag);
  // 默认项目和未共享的普通项目不展示成员配置，只有研发项目或共享项目需要成员 tab。
  const showMembersTab = projectType !== 'default' && (isDevelopProject || !!project?.sharedFlag);
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
          sessionName: '当前会话',
        }
      );
    }
    return projectSessions[0];
  }, [activeChatSessionId, projectSessions]);

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
    async (sourceList: ScanSourceItem[] = []) => {
      if (!projectId) return;
      setRequirementsLoading(true);
      const allItems: RequirementItem[] = [];
      let latestLog: ScanLogEntry | null = null;

      try {
        // 只消费本次请求得到的收集源列表，避免 setSources 后触发 useEffect 依赖变化造成需求 tab 循环请求。
        for (const source of sourceList) {
          // 需求直接按源查(含历史)，不再遍历最近日志——否则早期需求会被空扫描日志挤出而漏显。
          const items = (await listRequirementsBySource(source.sourceId)) || [];
          items.forEach((item: any) => {
            allItems.push({
              ...item,
              sourceType: source.sourceType,
              sourceName: source.sourceName,
            });
          });
          // 仅取最近一条日志用于“上次扫描完成”状态展示。
          const logs = (await listScanLogs(source.sourceId, 1)) || [];
          if (logs[0] && (!latestLog || new Date(logs[0].scanTime) > new Date(latestLog.scanTime))) {
            latestLog = logs[0];
          }
        }
        // 跨源合并后按综合分倒序，未评分(score 为空)沉底。
        allItems.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        setRequirements(allItems);
        setVisibleRequirementCount(REQUIREMENT_PAGE_SIZE);
        setLastLog(latestLog);
      } finally {
        setRequirementsLoading(false);
      }
    },
    [projectId]
  );

  const fetchTasks = useCallback(async () => {
    if (!projectId) return;
    setTasksLoading(true);
    try {
      const taskList = (await listTasks(projectId)) || [];
      setTasks(taskList);
    } finally {
      setTasksLoading(false);
    }
  }, [projectId]);

  // 展开任务时按需拉环节概要（后端按需刷新），结果缓存到 map，收起不清除避免重复请求。
  const loadTaskPhases = useCallback(async (task: any) => {
    const sessionId = task?.sessionId;
    if (!sessionId) return;
    const key = `${sessionId}`;
    try {
      const res: any = await getTaskPhases(Number(sessionId));
      const snapshot = res?.data ?? res ?? null;
      setTaskPhaseMap((prev) => ({ ...prev, [key]: snapshot }));
    } catch {
      // 环节概要失败不阻断详情展开，静默忽略。
    }
  }, []);

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
    if (!fileResourceId) return;
    setSharedFilesLoading(true);
    try {
      // 共享文件与文件模块“共享文件空间”同源，路径固定使用 /.shared/。
      const res = await listFiles({ resourceId: fileResourceId, path: SHARED_FILE_PATH });
      setSharedFiles(sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(res)));
    } catch (error) {
      console.error('Failed to load shared project files:', error);
      message.error('共享文件加载失败');
      setSharedFiles([]);
    } finally {
      setSharedFilesLoading(false);
    }
  }, [fileResourceId]);

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

  const getResourceFileActionItems = useCallback(
    (item: FileBrowserItem): MenuProps['items'] => {
      const labelIdMap = {
        preview: 'fileBrowser.action.preview',
        download: 'directoryManage.downloadFile',
        rename: 'fileBrowser.action.rename',
        delete: 'fileBrowser.action.delete',
      };
      const actionKeys = [
        ...(canPreviewFile(item) ? (['preview'] as const) : []),
        'download',
        'rename',
        'delete',
      ] as const;

      // 资源 tab 先对齐文件树的基础操作，弹窗型的上传/保存类操作后续再单独接入。
      return actionKeys.map((key) => ({
        key,
        label: <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: labelIdMap[key] })}</div>,
      }));
    },
    [intl]
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

  const handleResourceFileAction = useCallback(
    (key: React.Key, item: FileBrowserItem) => {
      if (key === 'preview') {
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
      }
    },
    [handleDeleteResourceFile, handleResourceDownload, handleResourcePreview, intl]
  );

  const clearResourceClickTimer = useCallback(() => {
    if (resourceClickTimerRef.current) {
      window.clearTimeout(resourceClickTimerRef.current);
      resourceClickTimerRef.current = null;
    }
  }, []);

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
        void handleResourcePreview(item);
      }, 220);
    },
    [clearResourceClickTimer, handleResourcePreview, intl]
  );

  const handleResourceItemDoubleClick = useCallback(
    (item: FileTreeItem) => {
      if (!fileResourceId) return;
      clearResourceClickTimer();
      // 和“文件”模块一致，双击文件/文件夹时把引用插入当前聊天输入框。
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, fileResourceId),
        type: isDirectory(item) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, clearResourceClickTimer, fileResourceId]
  );

  useEffect(() => clearResourceClickTimer, [clearResourceClickTimer]);

  const fetchDetailData = useCallback(async () => {
    if (!projectId) return;
    // 打开详情时并行请求当前可见 tab 需要的数据，成员 tab 隐藏时不额外查询成员。
    const requirementPromise = showRequirementsTab ? fetchSources().then(fetchRequirements) : Promise.resolve();
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
    setActiveTab(showRequirementsTab ? 'requirements' : 'tasks');
    setExpandedTaskId(null);
    setDetailReq(null);
    setExpandedRequirementId(null);
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
    if (activeTab !== 'resources' || !fileResourceId) return;
    void fetchSharedResourceFiles();
    const sessionIds =
      resourceFileScope === 'all'
        ? projectSessions.map((session) => `${session.sessionId}`).filter(Boolean)
        : currentResourceSession?.sessionId
          ? [`${currentResourceSession.sessionId}`]
          : [];
    Array.from(new Set(sessionIds)).forEach((item) => {
      void fetchSessionResourceFiles(item);
    });
  }, [
    activeTab,
    currentResourceSession?.sessionId,
    fetchSessionResourceFiles,
    fetchSharedResourceFiles,
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
    (activeTab === 'requirements' && requirementsTabLoading && !hasRequirementVisibleData) ||
    (activeTab === 'tasks' && tasksLoading);

  const tabItems = useMemo(
    () => [
      ...(showRequirementsTab ? [{ key: 'requirements', label: '需求' }] : []),
      { key: 'tasks', label: '任务' },
      { key: 'resources', label: '资源' },
      ...(showMembersTab ? [{ key: 'members', label: '成员' }] : []),
    ],
    [showMembersTab, showRequirementsTab]
  );

  const detailPanelStyle = useMemo(
    () => ({ '--project-detail-tab-count': tabItems.length } as React.CSSProperties),
    [tabItems.length]
  );

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
      setExpandedRequirementId(null);
      await fetchRequirements(sourceList);
    } catch (error) {
      console.error('Failed to refresh project requirements:', error);
      message.error('需求列表刷新失败');
    } finally {
      // 手动刷新按钮只响应自己的刷新动作，避免打开渠道配置时拉渠道数据导致按钮转圈。
      setRequirementsRefreshLoading(false);
    }
  }, [fetchRequirements, fetchSources, requirementsRefreshLoading, showRequirementsTab]);

  const handleDetailBodyScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (activeTab !== 'requirements' || !showRequirementsTab || !hasMoreRequirements) return;

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight > 80) return;

      // 需求接口当前一次返回归并结果，左侧窄面板按 20 条递增渲染，避免一次性塞满列表。
      setVisibleRequirementCount((prev) => Math.min(prev + REQUIREMENT_PAGE_SIZE, requirements.length));
    },
    [activeTab, hasMoreRequirements, requirements.length, showRequirementsTab]
  );

  const handleGoToTaskChat = useCallback(
    (task: any, event?: React.MouseEvent<HTMLElement>) => {
      event?.stopPropagation();
      if (!task?.sessionId) {
        message.warning('未找到任务会话');
        return;
      }
      // 先关掉覆盖态的渠道/详情面板，否则它会盖在聊天页上挡住跳转后的会话视图。
      clearDetailPanel?.();
      // 任务会话仍复用右侧聊天页，点击后切换当前会话上下文。
      setSessionId?.(`${task.sessionId}`);
      navigate('/chat');
    },
    [navigate, setSessionId, clearDetailPanel]
  );

  const handleManualRequirementSubmit = () => {
    if (!manualRequirementForm.title.trim()) {
      message.warning('请填写需求名称');
      return;
    }
    if (!manualRequirementForm.originalContent.trim()) {
      message.warning('请填写原始需求');
      return;
    }

    // 后端人工新增需求接口还未接入，先保留表单与校验，避免前端伪造需求数据导致后续状态不一致。
    message.info('人工新增需求接口待后端接入');
  };

  const handleSaveSource = async () => {
    if (!projectId) return;
    if (!sourceForm.name.trim()) {
      message.error('请填写名称');
      return;
    }
    if (!sourceForm.repoId) {
      message.error('请选择关联仓库');
      return;
    }

    let config = '';
    if (sourceForm.type === 'dingtalk') {
      if (!sourceForm.chatId) {
        message.error('请选择钉钉群');
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
        message.error('请填写 GitHub PAT');
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
        message.success('收集源已更新');
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
        message.success('收集源添加成功');
      }

      setSourceModalOpen(false);
      setEditingSource(null);
      const sourceList = await fetchSources();
      await fetchRequirements(sourceList);
    } catch {
      message.error(editingSource ? '更新失败' : '添加失败');
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
      message.error('请填写仓库全名 owner/repo');
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
        message.error('新增仓库失败');
        return;
      }
      message.success('仓库已新增');
      setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
      await fetchRepos();
      setSourceForm((prev) => ({ ...prev, repoId: res.repoId }));
    } catch {
      message.error('新增仓库失败');
    } finally {
      setRepoSaving(false);
    }
  };

  const handleDeleteRepo = (repo: RepoOption) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定删除仓库「${repo.repoFullName || repo.repoUrl || repo.repoId}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProjectRepo(repo.repoId);
          message.success('仓库已删除');
          if (sourceForm.repoId === repo.repoId) {
            setSourceForm((prev) => ({ ...prev, repoId: undefined }));
          }
          await fetchRepos();
        } catch (error: any) {
          message.error(error?.message || '删除失败，可能已被扫描源关联');
        }
      },
    });
  };

  const handleDeleteSource = (source: ScanSourceItem) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除收集源「${source.sourceName}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteScanSource(source.sourceId);
        message.success('已删除');
        const sourceList = await fetchSources();
        await fetchRequirements(sourceList);
      },
    });
  };

  const handleTriggerScan = async (sourceId: number) => {
    setScanningId(sourceId);
    try {
      const res = await triggerScan(sourceId);
      message.success(`扫描完成，新建 ${res?.createdCount || 0} 条`);
      const sourceList = await fetchSources();
      await fetchRequirements(sourceList);
    } catch {
      message.error('扫描失败');
    } finally {
      setScanningId(null);
    }
  };

  const handleToggleSource = async (sourceId: number, checked: boolean) => {
    await toggleScanSource(sourceId, checked ? '1' : '0');
    message.success(checked ? '已启用' : '已暂停');
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
        message.error('创建任务失败');
        return;
      }

      // 后端 createTask 已建会话(带 projectId)并异步发起对话，前端无需再自建会话回写。
      setRequirements((prev) =>
        prev.map((item) => (item.itemId === requirementId ? { ...item, sessionId: res.sessionId } : item))
      );
      message.success('任务已创建');
      await Promise.all([fetchTasks(), fetchSources().then(fetchRequirements)]);
      setActiveTab('tasks');
    } catch (error: any) {
      const errorMessage = error?.message || '创建任务失败';
      message.error(errorMessage);
      if (errorMessage.includes('重复启动') || errorMessage.includes('已有进行中的任务')) {
        // 页面需求数据可能落后于后端任务状态，重复启动失败后主动刷新让按钮状态回到已启动。
        void fetchRequirements(sources);
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
        message.success('钉钉授权成功');
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
      message.warning('授权超时，请重试');
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
        message.error(res?.message || '启动授权失败');
      }
    } catch {
      message.error('启动授权失败');
    } finally {
      setDwsAuthLoading(false);
    }
  };

  const repoLabel = (repoId?: number | null) => {
    if (!repoId) return null;
    const repo = repos.find((item) => item.repoId === repoId);
    return repo ? repo.repoFullName || repo.repoUrl || String(repo.repoId) : null;
  };

  const renderSourceList = (emptyText = '暂无收集源，点击右上角 + 添加', options: { panel?: boolean } = {}) => (
    <Spin spinning={sourcesLoading && !sources.length}>
      {sources.length ? (
        <div className={options.panel ? styles.detailChannelSourceList : styles.detailSourceList}>
          {sources.map((source) => (
            <div key={source.sourceId} className={styles.detailSourceCard}>
              <div className={styles.detailSourceHeader}>
                <span className={styles.detailSourceIcon}>{getSourceIcon(source.sourceType)}</span>
                <div className={styles.detailSourceTitle}>
                  <strong>{source.sourceName}</strong>
                  <span>{formatConfig(source.sourceType, source.config)}</span>
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
                        className={styles.detailSourceDwsTag}
                        color="green"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setDwsAuthDetailVisible(true)}
                      >
                        DWS 已授权{dwsExpiresAt ? ` · 有效至 ${dayjs(dwsExpiresAt).format('MM-DD HH:mm')}` : ''}
                      </Tag>
                    ) : dwsExpired ? (
                      <Tag
                        className={styles.detailSourceDwsTag}
                        color="red"
                        style={{ cursor: 'pointer' }}
                        onClick={handleStartDwsAuth}
                      >
                        DWS 授权已过期，点击重新授权
                      </Tag>
                    ) : (
                      <Tag
                        className={styles.detailSourceDwsTag}
                        color="orange"
                        style={{ cursor: 'pointer' }}
                        onClick={handleStartDwsAuth}
                      >
                        DWS 未授权，点击授权
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
                  {getCronDisplayText(source.cronExpr)}
                </Tag>
                {source.lastScanTime && (
                  <span className={styles.detailSourceTime}>
                    上次扫描: {dayjs(source.lastScanTime).format('MM-DD HH:mm')}
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
                    扫描
                  </Button>
                  <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => handleViewLogs(source)}>
                    日志
                  </Button>
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditSource(source)}>
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteSource(source)}
                  >
                    删除
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
          <h3>渠道配置</h3>
          <p>{sources.length} 个渠道</p>
        </div>
        <div className={styles.detailChannelPanelActions}>
          <Tooltip title="新增渠道" placement="top">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openAddSourceModal()}>
              新增渠道
            </Button>
          </Tooltip>
          <Tooltip title="关闭" placement="top">
            <Button icon={<CloseOutlined />} onClick={handleCloseChannelPanel} />
          </Tooltip>
        </div>
      </div>
      <div className={styles.detailChannelPanelBody}>
        {renderSourceList('暂无渠道，点击右上角新增渠道', { panel: true })}
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
    dwsAuthed,
    dwsExpired,
    dwsExpiresAt,
    project?.projectName,
    repos,
    scanningId,
    setDetailPanel,
    sources,
    sourcesLoading,
  ]);

  useEffect(() => {
    return () => {
      if (channelPanelOpen) {
        clearDetailPanel?.();
      }
    };
  }, [channelPanelOpen, clearDetailPanel]);

  const renderRequirements = () => (
    <>
      <button type="button" className={styles.detailChannelEntry} onClick={handleToggleChannelPanel}>
        <AntdIcon type="icon-chajian" className={styles.detailChannelEntryIcon} />
        <span>
          <strong>渠道配置</strong>
        </span>
        <RightOutlined />
      </button>
      <div className={styles.detailSectionHeader}>
        <span>{requirements.length} 个需求</span>
        <Space size={6}>
          {/* 人工新增需求接口未接入，等后端接口可用后再恢复入口。 */}
          {/* <Tooltip title="人工新增" placement="top">
            <Button size="small" icon={<PlusOutlined />} onClick={openManualRequirementModal} />
          </Tooltip> */}
          <Tooltip title="刷新" placement="top">
            <Button
              size="small"
              className={styles.detailHeaderActionButton}
              icon={<ReloadOutlined />}
              loading={requirementsRefreshLoading}
              disabled={requirementsRefreshLoading}
              onClick={handleRefreshRequirements}
            >
              刷新
            </Button>
          </Tooltip>
        </Space>
      </div>
      {requirements.length ? (
        <div className={styles.detailRequirementList}>
          {visibleRequirements.map((item) => {
            const isStarting = startingRequirementIds.has(item.itemId);
            const isStarted = !!item.sessionId;
            const expanded = expandedRequirementId === item.itemId;
            const sourceLabel = getSourceLabel(item.sourceType);
            const sourceName = item.sourceName || '-';
            const createTime = item.createTime ? dayjs(item.createTime).format('MM-DD HH:mm') : '-';
            const detailText = getRequirementDetailText(item);
            const scoreDetail = parseScoreDetail(item.scoreDetail);
            const scored = item.score != null;

            return (
              <div
                key={item.itemId}
                className={[styles.detailRequirementItem, expanded ? styles.detailRequirementItemExpanded : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setExpandedRequirementId((prev) => (prev === item.itemId ? null : item.itemId))}
              >
                <div className={styles.detailRequirementSummary}>
                  <span className={styles.detailScore} style={{ background: scoreBg(item.score) }}>
                    {scored ? item.score : '—'}
                  </span>
                  <div className={styles.detailRequirementMain}>
                    <strong>
                      {item.priority ? (
                        <Tag color={priorityColor(item.priority)} style={{ marginRight: 6 }}>
                          {item.priority}
                        </Tag>
                      ) : null}
                      {item.title}
                    </strong>
                    <span>
                      {sourceLabel} · {sourceName} · {createTime}
                    </span>
                  </div>
                  {isStarted ? (
                    <Button
                      size="small"
                      className={`${styles.detailRequirementAction} ${styles.detailRequirementStartedAction}`}
                      disabled
                      onClick={(event) => event.stopPropagation()}
                    >
                      已启动
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
                      {isStarting ? '启动中' : '启动'}
                    </Button>
                  )}
                </div>
                {expanded && (
                  <div className={styles.detailRequirementExpanded}>
                    <div className={styles.detailRequirementMetaGrid}>
                      <span>
                        <em>综合评分</em>
                        <strong>{scored ? `${item.score}（${item.priority || '-'}）` : '未评分'}</strong>
                      </span>
                      <span>
                        <em>创建时间</em>
                        <strong>{createTime}</strong>
                      </span>
                      <span>
                        <em>任务状态</em>
                        <strong>{isStarted ? '已启动' : '未启动'}</strong>
                      </span>
                    </div>
                    <div className={styles.detailRequirementDetailText}>
                      <em>{scoreDetail.summary ? 'AI 整理的产品需求' : '需求内容'}</em>
                      <Tooltip
                        title={detailText}
                        placement="top"
                        overlayInnerStyle={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}
                      >
                        <p>{scoreDetail.summary || detailText}</p>
                      </Tooltip>
                    </div>
                    <div className={styles.detailRequirementExtra}>
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDetailReq(item);
                        }}
                      >
                        查看完整评分与需求详情
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {hasMoreRequirements && <div className={styles.detailRequirementMore}>向下滚动加载更多</div>}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无需求，请去「渠道配置」点击「扫描」收集" />
      )}
      {renderRequirementDetailModal()}
    </>
  );

  const renderRequirementDetailModal = () => {
    if (!detailReq) return null;
    const detail = parseScoreDetail(detailReq.scoreDetail);
    const sourceLabel = getSourceLabel(detailReq.sourceType);
    const scored = detailReq.score != null;
    const createTime = detailReq.createTime ? dayjs(detailReq.createTime).format('YYYY-MM-DD HH:mm') : '-';
    return (
      <Modal
        title={detailReq.title}
        open={!!detailReq}
        onCancel={() => setDetailReq(null)}
        footer={<Button onClick={() => setDetailReq(null)}>关闭</Button>}
        width={720}
      >
        <div className={styles.scoreSummary}>
          <div className={styles.scoreSummaryCircle} style={{ background: scoreBg(detailReq.score) }}>
            {scored ? detailReq.score : '—'}
          </div>
          <div>
            <div className={styles.scoreSummaryLabel}>AI 综合评分</div>
            <div className={styles.scoreSummaryPriority}>
              {detailReq.priority || '—'}
              {detailReq.sessionId ? ' · 研发中' : ''}
            </div>
            <div className={styles.scoreSummaryHint}>
              {detailReq.sessionId ? '已满足自动派生研发任务规则' : '尚未启动研发任务'}
            </div>
          </div>
        </div>

        {detail.summary && (
          <div className={styles.formField} style={{ marginTop: 16 }}>
            <label>AI 整理的产品需求</label>
            <div>{detail.summary}</div>
          </div>
        )}
        <div className={styles.formField}>
          <label>原始需求</label>
          <div style={{ whiteSpace: 'pre-wrap', color: '#555' }}>{getRequirementDetailText(detailReq)}</div>
        </div>
        <div className={styles.formField}>
          <label>来源</label>
          <div>
            {sourceLabel} · {detailReq.sourceName || '-'} · {createTime}
          </div>
        </div>

        {scored && (
          <div className={styles.formField}>
            <label>评分维度</label>
            <div className={styles.detailScoreDimGrid}>
              {SCORE_DIMENSIONS.map((d) => (
                <div key={d.key} className={styles.detailScoreDimItem}>
                  <span>{d.label}</span>
                  <strong>
                    +{detail[d.key] ?? 0} / {d.max}
                  </strong>
                </div>
              ))}
              {detail.risk != null && detail.risk !== 0 && (
                <div className={styles.detailScoreDimItem}>
                  <span>风险与冲突</span>
                  <strong style={{ color: '#cf1322' }}>{detail.risk}</strong>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    );
  };

  const renderResources = () => {
    const currentSessionFiles = currentResourceSession?.sessionId
      ? sessionFilesMap[`${currentResourceSession.sessionId}`] || []
      : [];
    const allSessionFileCount = projectSessions.reduce(
      (count, session) => count + getFileSpaceFileCount(sessionFilesMap[`${session.sessionId}`] || []),
      0
    );
    const sessionFileCount =
      resourceFileScope === 'all' ? allSessionFileCount : getFileSpaceFileCount(currentSessionFiles);
    const sessionGroups =
      resourceFileScope === 'all'
        ? projectSessions.map((session) => {
            const sessionResourceId = `${session.sessionId}`;
            const files = sessionFilesMap[sessionResourceId] || [];
            const sessionName = getSessionResourceName(session);
            return {
              key: sessionResourceId,
              title: sessionName,
              titleText: sessionName,
              currentPath: getSessionFilePath(sessionResourceId),
              items: files,
              loading: !!sessionFilesLoadingMap[sessionResourceId],
              emptyText: '该会话暂无文件',
              count: getFileSpaceFileCount(files),
            };
          })
        : currentResourceSession
          ? [
            {
              key: `${currentResourceSession.sessionId}`,
              title: getSessionResourceName(currentResourceSession),
              titleText: getSessionResourceName(currentResourceSession),
              currentPath: getSessionFilePath(`${currentResourceSession.sessionId}`),
              items: currentSessionFiles,
              loading: !!sessionFilesLoadingMap[`${currentResourceSession.sessionId}`],
              emptyText: '该会话暂无文件',
              count: getFileSpaceFileCount(currentSessionFiles),
            },
          ]
          : [];

    return (
      <div className={styles.detailResourcePanel}>
        <FileSpaceBlock
          title="共享文件空间"
          count={getFileSpaceFileCount(sharedFiles)}
          loading={sharedFilesLoading}
          items={sharedFiles}
          currentPath={SHARED_FILE_PATH}
          emptyText={fileResourceId ? '暂无共享文件' : '暂无当前数字员工，无法加载文件'}
          childrenByPath={resourceChildrenByPath}
          expandedKeys={resourceExpandedKeys}
          showActions={!!fileResourceId}
          onExpand={setResourceExpandedKeys}
          onLoadData={loadResourceTreeNode}
          onNodeClick={handleResourceItemClick}
          onNodeDoubleClick={handleResourceItemDoubleClick}
          getActionItems={getResourceFileActionItems}
          onAction={handleResourceFileAction}
        />
        <FileSpaceBlock
          title="会话空间"
          count={sessionFileCount}
          emptyText={resourceFileScope === 'all' ? '暂无会话' : '暂无当前会话'}
          groups={sessionGroups}
          childrenByPath={resourceChildrenByPath}
          expandedKeys={resourceExpandedKeys}
          switchValue={resourceFileScope}
          defaultGroupsCollapsed={resourceFileScope === 'all'}
          groupCollapseResetKey={resourceFileScope}
          showActions={!!fileResourceId}
          switchOptions={[
            { label: '当前会话', value: 'current' },
            { label: '全部会话', value: 'all' },
          ]}
          onSwitchChange={(value) => setResourceFileScope(value as ResourceFileScope)}
          onExpand={setResourceExpandedKeys}
          onLoadData={loadResourceTreeNode}
          onNodeClick={handleResourceItemClick}
          onNodeDoubleClick={handleResourceItemDoubleClick}
          getActionItems={getResourceFileActionItems}
          onAction={handleResourceFileAction}
        />
      </div>
    );
  };

  const renderTasks = () => (
    <div className={styles.detailTaskPanel}>
      {tasks.length > 0 && (
        <div className={styles.detailTaskHeader}>
          <span>{tasks.length} 个任务</span>
          <Button
            size="small"
            className={styles.detailHeaderActionButton}
            icon={<AppstoreOutlined />}
            onClick={() => setTaskKanbanOpen(true)}
          >
            视图
          </Button>
        </div>
      )}

      {tasks.length ? (
        <div className={styles.detailTaskList}>
          {tasks.map((task) => {
            // 进度由后端按环节口径统一算好（与详情抽屉一致），列表直接用。
            const progress = typeof task.progress === 'number' ? task.progress : 0;
            const isExpanded = `${expandedTaskId || ''}` === `${task.taskId}`;
            // 会话即任务后仅状态由 session_ext 提供，阶段/分支等仍可能为空，空则不渲染避免残缺横线。
            const hasTaskMeta = !!task.phase || !!task.agentName || !!task.branchName;

            return (
              <div
                key={task.taskId}
                className={`${styles.detailTaskCard} ${isExpanded ? styles.detailTaskCardExpanded : ''}`}
                onClick={() => {
                  const next = isExpanded ? null : task.taskId;
                  setExpandedTaskId(next);
                  if (next && !taskPhaseMap[`${task.sessionId}`]) {
                    loadTaskPhases(task);
                  }
                }}
              >
                <div className={styles.detailTaskCardHeader}>
                  <div className={styles.detailTaskMain}>
                    <Tooltip placement="top" title={task.title}>
                      <h4 className={styles.detailTaskTitle}>{task.title}</h4>
                    </Tooltip>
                    {task.status && (
                      <div className={styles.detailTaskMeta}>
                        <Tag color={STATUS_COLORS[task.status] || 'default'}>{task.status}</Tag>
                        {task.agentName && <span>{task.agentName}</span>}
                        {task.branchName && <span className={styles.detailTaskBranch}>{task.branchName}</span>}
                      </div>
                    )}
                    {!task.status && hasTaskMeta && (
                      <div className={styles.detailTaskMeta}>
                        {task.phase && <Tag color={PHASE_COLORS[task.phase] || 'default'}>{task.phase}</Tag>}
                        {task.agentName && <span>{task.agentName}</span>}
                        {task.branchName && <span className={styles.detailTaskBranch}>{task.branchName}</span>}
                      </div>
                    )}
                    {task.warningTag && (
                      <Tag color="warning" className={styles.detailTaskWarning}>
                        {task.warningTag}
                      </Tag>
                    )}
                  </div>
                  <div className={styles.detailTaskRight}>
                    <Avatar size="small" style={{ background: '#f56a00' }}>
                      {(task.assignee || '我')[0]}
                    </Avatar>
                    <strong>{progress}%</strong>
                  </div>
                </div>
                {isExpanded && (
                  <div className={styles.detailTaskInlineDetail}>
                    {(() => {
                      const snapshot = taskPhaseMap[`${task.sessionId}`];
                      const phaseList: any[] = snapshot?.phases || [];
                      if (!phaseList.length) return null;
                      const currentPhase = snapshot?.currentPhase;
                      return (
                        <div className={styles.detailTaskPhaseSummary}>
                          <div className={styles.detailTaskPhaseHeader}>
                            <label>研发环节</label>
                            {snapshot?.round ? <span>第 {snapshot.round} 轮</span> : null}
                          </div>
                          <div className={styles.phaseMiniFlow}>
                            {phaseList.map((p, idx) => {
                              const meta = PHASE_STATE_META[p.status] || PHASE_STATE_META.pending;
                              const isCurrent = p.key === currentPhase;
                              return (
                                <React.Fragment key={p.key}>
                                  {idx > 0 && <span className={styles.phaseMiniLine} />}
                                  <Tooltip title={`${p.label}·${p.status}`}>
                                    <span
                                      className={`${styles.phaseMiniNode} ${styles[meta.cls]} ${
                                        isCurrent ? styles.phaseMiniCurrent : ''
                                      }`}
                                    >
                                      <em>{p.status === 'done' || p.status === 'rejected' ? meta.icon : idx + 1}</em>
                                      <i>{p.label}</i>
                                    </span>
                                  </Tooltip>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    <span>
                      <label>状态</label>
                      <strong>{task.status || '-'}</strong>
                    </span>
                    <span>
                      <label>阶段</label>
                      <strong>{task.phase || '-'}</strong>
                    </span>
                    <span>
                      <label>轮次</label>
                      <strong>
                        {task.currentRound || 0}/{task.totalRounds || 0}
                      </strong>
                    </span>
                    <span>
                      <label>分数</label>
                      <strong>{task.score ?? '-'}</strong>
                    </span>
                    <span>
                      <label>数字员工</label>
                      <strong>{task.agentName || '-'}</strong>
                    </span>
                    <span>
                      <label>负责人</label>
                      <strong>{task.assignee || '我'}</strong>
                    </span>
                    <span className={styles.detailTaskInlineWide}>
                      <label>分支</label>
                      <Tooltip placement="top" title={task.branchName || '-'}>
                        <strong>{task.branchName || '-'}</strong>
                      </Tooltip>
                    </span>
                    <span>
                      <label>创建时间</label>
                      <strong>{task.createTime ? dayjs(task.createTime).format('MM-DD HH:mm') : '-'}</strong>
                    </span>
                    <div className={styles.detailTaskInlineActions}>
                      <Button
                        size="small"
                        type="link"
                        className={styles.detailTaskChatButton}
                        icon={<PartitionOutlined />}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDetailTask(task);
                        }}
                      >
                        环节详情
                      </Button>
                      {task.sessionId && (
                        <Button
                          size="small"
                          type="link"
                          className={styles.detailTaskChatButton}
                          icon={<MessageOutlined />}
                          onClick={(event) => handleGoToTaskChat(task, event)}
                        >
                          进入会话
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={isDevelopProject ? '暂无任务，在需求 Tab 点击「启动」创建' : '暂无任务'}
        />
      )}

      <SessionOverviewDrawer
        open={taskKanbanOpen}
        onClose={() => setTaskKanbanOpen(false)}
        tasks={tasks}
        onRefresh={fetchTasks}
      />

      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} onRefresh={fetchTasks} />
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
      title={editingSource ? '编辑收集源' : '添加收集源'}
      open={sourceModalOpen}
      onOk={handleSaveSource}
      onCancel={() => {
        setSourceModalOpen(false);
        setEditingSource(null);
        setGroupOptions([]);
      }}
      okText={editingSource ? '保存' : '添加'}
      width={640}
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
          <label>类型</label>
          <Select
            value={sourceForm.type}
            disabled={!!editingSource}
            onChange={(type) => setSourceForm((prev) => ({ ...prev, type }))}
            options={[
              { value: 'dingtalk', label: '钉钉群消息' },
              { value: 'github_issue', label: 'GitHub Issue' },
            ]}
          />
        </div>
        <div className={styles.formField}>
          <label>名称</label>
          <Input
            placeholder="收集源名称"
            value={sourceForm.name}
            onChange={(event) => setSourceForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
        <div className={styles.formField}>
          <label>关联仓库</label>
          <Space.Compact style={{ width: '100%' }}>
            <Select
              style={{ flex: 1 }}
              placeholder="选择该源扫来的需求要开发的仓库"
              value={sourceForm.repoId}
              allowClear
              onChange={(repoId) => setSourceForm((prev) => ({ ...prev, repoId }))}
              options={repos.map((repo) => ({
                value: repo.repoId,
                label: repo.repoFullName || repo.repoUrl || String(repo.repoId),
              }))}
              notFoundContent={repos.length ? undefined : '项目暂无仓库，点击右侧新增'}
            />
            <Button
              className={styles.sourceRepoAddButton}
              icon={<PlusOutlined />}
              onClick={() => {
                setRepoForm({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
                setRepoModalOpen(true);
              }}
            >
              新增
            </Button>
          </Space.Compact>
        </div>
        <div className={styles.formField}>
          <label>扫描频率</label>
          <Select
            value={sourceForm.cron}
            onChange={(cron) => setSourceForm((prev) => ({ ...prev, cron }))}
            options={cronPresets}
            popupClassName={styles.sourceSelectPopup}
          />
        </div>
        <div className={styles.formFieldFull}>
          <div className={styles.formField}>
            <label>需求确认规则</label>
            <Radio.Group
              value={sourceForm.confirmMode}
              onChange={(event) => setSourceForm((prev) => ({ ...prev, confirmMode: event.target.value }))}
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: 'manual', label: '人工确认' },
                { value: 'auto', label: '全自动派生' },
                { value: 'score', label: '按需求得分' },
              ]}
            />
            {sourceForm.confirmMode === 'score' && (
              <div style={{ marginTop: 8 }}>
                得分达到
                <InputNumber
                  min={0}
                  max={100}
                  value={sourceForm.scoreThreshold}
                  onChange={(value) => setSourceForm((prev) => ({ ...prev, scoreThreshold: value ?? 70 }))}
                  style={{ width: 80, margin: '0 8px' }}
                />
                分自动转任务，低于该分数需要人工干预
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
              {sourceForm.confirmMode === 'auto'
                ? '扫描到的新需求将自动派生为研发任务并启动会话'
                : sourceForm.confirmMode === 'score'
                  ? '综合评分达到阈值的需求自动派生，其余进入列表等待人工确认'
                  : '扫描到的需求进入列表，需人工点击「启动任务」'}
            </div>
          </div>
        </div>
        {sourceForm.type === 'dingtalk' && (
          <>
            {!dwsAuthed && (
              <div className={styles.formFieldFull}>
                <div className={styles.formField}>
                  <label>钉钉授权</label>
                  {dwsDeviceInfo ? (
                    <div>
                      <p style={{ margin: '4px 0' }}>请在手机钉钉打开以下链接完成授权：</p>
                      <a href={dwsDeviceInfo.verificationUrl} target="_blank" rel="noreferrer">
                        {dwsDeviceInfo.verificationUrl}
                      </a>
                      <p style={{ margin: '4px 0', color: '#666' }}>
                        设备码: <strong>{dwsDeviceInfo.userCode}</strong>
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
                      授权钉钉扫描
                    </Button>
                  )}
                </div>
              </div>
            )}
            {dwsAuthed && (
              <div className={styles.formField}>
                <label>钉钉授权</label>
                <Tag color="green">已授权</Tag>
              </div>
            )}
            <div className={styles.formField}>
              <label>钉钉群</label>
              <Select
                showSearch
                filterOption={false}
                placeholder="输入群名搜索"
                value={sourceForm.chatId || undefined}
                onSearch={handleGroupSearch}
                onChange={(chatId, option) => {
                  const chatName = Array.isArray(option) ? '' : (option?.label as string) || '';
                  setSourceForm((prev) => ({ ...prev, chatId, chatName }));
                }}
                options={groupOptions}
                loading={groupSearching}
                notFoundContent={groupSearching ? <Spin size="small" /> : '输入至少2个字搜索'}
              />
            </div>
            <div className={styles.formField}>
              <label>关键词</label>
              <Input
                placeholder="默认: 需求"
                value={sourceForm.keywords}
                onChange={(event) => setSourceForm((prev) => ({ ...prev, keywords: event.target.value }))}
              />
            </div>
            <div className={styles.formField}>
              <label>回溯时长（小时）</label>
              <Select
                value={sourceForm.lookbackHours}
                onChange={(lookbackHours) => setSourceForm((prev) => ({ ...prev, lookbackHours }))}
                popupClassName={styles.sourceSelectPopup}
                options={[
                  { value: '6', label: '6小时' },
                  { value: '12', label: '12小时' },
                  { value: '24', label: '24小时（默认）' },
                  { value: '48', label: '48小时' },
                  { value: '72', label: '72小时' },
                  { value: '168', label: '7天' },
                ]}
              />
            </div>
          </>
        )}
        {sourceForm.type === 'github_issue' && (
          <>
            {!hasPatSaved && (
              <div className={styles.formField}>
                <label>GitHub PAT</label>
                <Input.Password
                  placeholder="输入 Personal Access Token"
                  value={sourceForm.pat}
                  onChange={(event) => setSourceForm((prev) => ({ ...prev, pat: event.target.value }))}
                />
              </div>
            )}
            <div className={styles.formField}>
              <label>标签过滤（可选）</label>
              <Input
                placeholder="如 bug,feature"
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
          <h3>人工新增需求</h3>
          <p>提交后由 AI 统一分析、评分并生成需求文档</p>
        </div>
      }
      open={manualRequirementOpen}
      onCancel={() => setManualRequirementOpen(false)}
      onOk={handleManualRequirementSubmit}
      okText="交给 AI 分析"
      cancelText="取消"
      width={720}
      className={styles.manualRequirementModal}
    >
      <div className={styles.manualRequirementForm}>
        <div className={styles.manualRequirementRow}>
          <div className={styles.formField}>
            <label>原始来源</label>
            <Select
              value={manualRequirementForm.sourceType}
              onChange={(sourceType) => setManualRequirementForm((prev) => ({ ...prev, sourceType }))}
              options={[
                { value: 'manual', label: '人工录入' },
                { value: 'customer_feedback', label: '客户反馈' },
                { value: 'internal_proposal', label: '内部提案' },
              ]}
            />
          </div>
          <div className={styles.formField}>
            <label>影响分支</label>
            <Input
              placeholder="develop"
              value={manualRequirementForm.branch}
              onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, branch: event.target.value }))}
            />
          </div>
        </div>
        <div className={styles.formField}>
          <label>需求名称</label>
          <Input
            placeholder="一句话描述期望解决的问题"
            value={manualRequirementForm.title}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>
        <div className={styles.formField}>
          <label>原始需求</label>
          <Input.TextArea
            placeholder="记录用户原话、问题背景和触发场景"
            rows={4}
            value={manualRequirementForm.originalContent}
            onChange={(event) => setManualRequirementForm((prev) => ({ ...prev, originalContent: event.target.value }))}
          />
        </div>
        <div className={styles.formField}>
          <label>产品需求</label>
          <Input.TextArea
            placeholder="可选：为空时由 AI 自动整理目标、范围与验收标准"
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
      title="维护项目仓库"
      open={repoModalOpen}
      onCancel={() => setRepoModalOpen(false)}
      footer={<Button onClick={() => setRepoModalOpen(false)}>关闭</Button>}
      width={560}
    >
      <div className={styles.formField}>
        <label>已有仓库</label>
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
                    删除
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={repo.repoFullName}
                  description={
                    <span style={{ color: '#999' }}>
                      {repo.repoUrl || '-'}
                      {repo.defaultBranch ? ` · ${repo.defaultBranch}` : ''}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无仓库" />
        )}
      </div>
      <div className={styles.repoModalDivider} />
      <div className={styles.formField}>
        <label>仓库全名 owner/repo</label>
        <Input
          placeholder="如 beyonai/byclaw-test"
          value={repoForm.repoFullName}
          onChange={(event) => setRepoForm((prev) => ({ ...prev, repoFullName: event.target.value }))}
        />
      </div>
      <div className={styles.formField}>
        <label>仓库地址（可选）</label>
        <Input
          placeholder="如 https://github.com/beyonai/byclaw-test"
          value={repoForm.repoUrl}
          onChange={(event) => setRepoForm((prev) => ({ ...prev, repoUrl: event.target.value }))}
        />
      </div>
      <div className={styles.formField}>
        <label>默认分支</label>
        <Input
          placeholder="main"
          value={repoForm.defaultBranch}
          onChange={(event) => setRepoForm((prev) => ({ ...prev, defaultBranch: event.target.value }))}
        />
      </div>
      <Button type="primary" icon={<PlusOutlined />} loading={repoSaving} onClick={handleCreateRepo}>
        新增仓库
      </Button>
    </Modal>
  );

  const renderDwsAuthModal = () => (
    <Modal
      title="DWS 钉钉授权信息"
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
          重新授权
        </Button>,
        <Button key="close" onClick={() => setDwsAuthDetailVisible(false)}>
          关闭
        </Button>,
      ]}
    >
      {dwsAuthDetail ? (
        <div className={styles.dwsAuthDetail}>
          <p>
            <strong>认证状态：</strong>
            {dwsAuthDetail.tokenValid ? <Tag color="green">有效</Tag> : <Tag color="red">无效</Tag>}
          </p>
          <p>
            <strong>组织名称：</strong>
            {dwsAuthDetail.corpName || '-'}
          </p>
          <p>
            <strong>用户名称：</strong>
            {dwsAuthDetail.userName || '-'}
          </p>
          <p>
            <strong>组织ID：</strong>
            {dwsAuthDetail.corpId || '-'}
          </p>
          <p>
            <strong>Access Token 有效至：</strong>
            {dwsAuthDetail.expiresAt ? dayjs(dwsAuthDetail.expiresAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </p>
          <p>
            <strong>Refresh Token 状态：</strong>
            {dwsAuthDetail.refreshTokenValid ? <Tag color="green">有效</Tag> : <Tag color="red">已过期</Tag>}
          </p>
          <p>
            <strong>Refresh Token 有效至：</strong>
            {dwsAuthDetail.refreshExpiresAt ? dayjs(dwsAuthDetail.refreshExpiresAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </p>
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无授权信息" />
      )}
    </Modal>
  );

  const renderLogDrawer = () => (
    <Drawer
      title={`扫描日志 - ${logModalSource?.sourceName || ''}`}
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
                        {log.status === 'success' ? '成功' : log.status === 'failed' ? '失败' : '运行中'}
                      </Tag>
                    </span>
                  }
                  description={
                    log.status === 'success'
                      ? `发现 ${log.foundCount} 条，新增 ${log.createdCount} 条`
                      : log.errorMsg || ''
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无扫描记录" />
        )}
      </Spin>
    </Drawer>
  );

  return (
    <div className={styles.projectDetailPanel} style={detailPanelStyle}>
      <div className={styles.detailPanelHeader}>
        <Tooltip title="返回" placement="top">
          <Button className={styles.detailBackButton} icon={<LeftOutlined />} onClick={onBack} />
        </Tooltip>
        <div className={styles.detailPanelTitle}>
          <h3>{project?.projectName || '项目详情'}</h3>
          <p title={projectDescription}>{projectDescription}</p>
        </div>
        <div className={styles.detailPanelActions}>
          <Tooltip title="编辑项目" placement="top">
            <Button
              className={styles.detailIconButton}
              icon={<EditOutlined />}
              onClick={() => project && onEditProject?.(project)}
            />
          </Tooltip>
          {showRequirementsTab && (
            <Tooltip title="添加收集源" placement="top">
              <Button className={styles.detailAddButton} icon={<PlusOutlined />} onClick={handleHeaderAdd} />
            </Tooltip>
          )}
        </div>
      </div>
      <div className={styles.detailTabsWrap}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </div>
      <Spin spinning={detailSpinning} wrapperClassName={styles.detailSpin}>
        <div className={styles.detailBodyPanel} onScroll={handleDetailBodyScroll}>
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
