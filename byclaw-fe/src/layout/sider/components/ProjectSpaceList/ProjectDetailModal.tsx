import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Drawer,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DingdingOutlined,
  EditOutlined,
  FileTextOutlined,
  GithubOutlined,
  LeftOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { fetchEventSource } from '@fortaine/fetch-event-source';
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
  listProjectMembers,
  listScanLogItems,
  listScanLogs,
  listScanSources,
  listTasks,
  saveGitHubPat,
  searchDingtalkGroups,
  startDwsDeviceAuth,
  toggleScanSource,
  triggerScan,
  updateScanSource,
  updateTask,
} from '@/service/devloop';
import TaskDetailDrawer from '@/pages/devloop/TaskDetailDrawer';
import TaskKanban from '@/pages/devloop/TaskKanban';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import { getToken, getssoToken, ssotokenKey, tokenKey } from '@/utils/auth';
import { generateSignature } from '@/utils/signature';
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
  createTime?: string;
  sourceType?: string;
  sourceName?: string;
  taskId?: number;
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
};

type Props = {
  project?: ProjectSpace;
  onBack: () => void;
  onEditProject?: (project: ProjectSpace) => void;
};

const SCORE_COLORS = ['#e9f8f0', '#fff3dc', '#eaf2ff'];

const PHASE_COLORS: Record<string, string> = {
  分诊: 'orange',
  设计: 'blue',
  编码: 'green',
  测试: 'purple',
  审批: 'cyan',
  发布: 'gold',
};

const cronPresets = [
  { value: '*/15 * * * *', label: '每15分钟' },
  { value: '*/30 * * * *', label: '每30分钟' },
  { value: '0 */1 * * *', label: '每小时' },
  { value: '0 */2 * * *', label: '每2小时' },
  { value: '0 9,14,18 * * 1-5', label: '工作日 9/14/18点' },
];

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

const ProjectDetailPanel: React.FC<Props> = ({ project, onBack, onEditProject }) => {
  const [activeTab, setActiveTab] = useState('requirements');
  const [sources, setSources] = useState<ScanSourceItem[]>([]);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [lastLog, setLastLog] = useState<ScanLogEntry | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [requirementsLoading, setRequirementsLoading] = useState(false);
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
  const [detailTask, setDetailTask] = useState<any>(null);
  const [taskKanbanOpen, setTaskKanbanOpen] = useState(false);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [repoForm, setRepoForm] = useState({ repoFullName: '', repoUrl: '', defaultBranch: 'main' });
  const [repoSaving, setRepoSaving] = useState(false);
  const groupSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwsAuthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dwsAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const projectId = Number(project?.projectId);

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
          const logs = (await listScanLogs(source.sourceId, 10)) || [];
          for (const log of logs) {
            if (!latestLog || new Date(log.scanTime) > new Date(latestLog.scanTime)) {
              latestLog = log;
            }
            const items = (await listScanLogItems(log.logId)) || [];
            items
              .filter((item: any) => item.action === 'created')
              .forEach((item: any) => {
                allItems.push({
                  ...item,
                  sourceType: source.sourceType,
                  sourceName: source.sourceName,
                });
              });
          }
        }
        setRequirements(allItems);
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

  const fetchDetailData = useCallback(async () => {
    if (!projectId) return;
    // 打开详情时立即并行请求成员，避免需求 tab 的收集源/日志请求阻塞成员数量展示。
    await Promise.all([fetchSources().then(fetchRequirements), fetchTasks(), fetchMembers(), fetchRepos()]);
  }, [fetchMembers, fetchRepos, fetchRequirements, fetchSources, fetchTasks, projectId]);

  useEffect(() => {
    setActiveTab('requirements');
    fetchDetailData();
  }, [fetchDetailData]);

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

  // 各 tab 只响应自己的加载状态；需求 tab 已有可见数据时不再整块遮罩，避免“数据已出现但还在 loading”的观感。
  const detailSpinning =
    (activeTab === 'requirements' && requirementsTabLoading && !hasRequirementVisibleData) ||
    (activeTab === 'tasks' && tasksLoading);

  const tabItems = useMemo(
    () => [
      { key: 'requirements', label: '需求' },
      { key: 'tasks', label: '任务' },
      { key: 'resources', label: '资源' },
      { key: 'members', label: '成员' },
    ],
    []
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
    if (activeTab === 'members') {
      setActiveTab('requirements');
    }
    openAddSourceModal();
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
    try {
      const res = await createTask({
        projectId,
        sourceItemId: requirement.itemId,
        title: requirement.title,
      });
      if (!res) {
        message.error('创建任务失败');
        return;
      }

      const { taskId, agentId, title: taskTitle } = res;
      message.success('任务已创建，正在发起会话...');
      await fetchTasks();
      setActiveTab('tasks');

      const chatBody = {
        agentId,
        agentType: '001',
        chatContent: `请处理以下研发任务：${taskTitle || requirement.title}`,
        sessionId: null,
        accessTerminal: 'Web',
        projectId,
      };
      const signatureHeaders = generateSignature('POST', chatBody);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        [tokenKey]: getToken() || '',
        [ssotokenKey]: getssoToken() || '',
        ...signatureHeaders,
      };

      // 与 /devloop 保持一致：启动任务后发起聊天，拿到 createSession 再回写 task.sessionId。
      void fetchEventSource('/byaiService/chat/superAgentChat', {
        method: 'POST',
        body: JSON.stringify(chatBody),
        headers,
        openWhenHidden: true,
        onmessage: (event) => {
          if (event.event !== 'createSession' || !event.data) return;
          try {
            const sessionData = JSON.parse(event.data);
            const sessionId = sessionData.sessionId;
            if (sessionId && taskId) {
              void updateTask({ taskId, sessionId }).then(fetchTasks);
            }
          } catch (error) {
            // 流式事件中只有 createSession 需要回写任务，会话数据异常时不中断当前页面。
            console.error('Failed to parse project task session event:', error);
          }
        },
        onerror: (error) => {
          console.error('Project task chat stream failed:', error);
        },
      });
    } catch {
      message.error('创建任务失败');
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

  const renderSourceList = (emptyText = '暂无收集源，点击右上角 + 添加') => (
    <Spin spinning={sourcesLoading && !sources.length}>
      {sources.length ? (
        <div className={styles.detailSourceList}>
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
              {repoLabel(source.repoId) && (
                <div className={styles.detailSourceAuth}>
                  <Tag icon={<GithubOutlined />} bordered={false} color="blue">
                    {repoLabel(source.repoId)}
                  </Tag>
                </div>
              )}
              {source.sourceType === 'dingtalk' && (
                <div className={styles.detailSourceAuth}>
                  {dwsAuthed ? (
                    <Tag color="green" style={{ cursor: 'pointer' }} onClick={() => setDwsAuthDetailVisible(true)}>
                      DWS 已授权{dwsExpiresAt ? ` · 有效至 ${dayjs(dwsExpiresAt).format('MM-DD HH:mm')}` : ''}
                    </Tag>
                  ) : dwsExpired ? (
                    <Tag color="red" style={{ cursor: 'pointer' }} onClick={handleStartDwsAuth}>
                      DWS 授权已过期，点击重新授权
                    </Tag>
                  ) : (
                    <Tag color="orange" style={{ cursor: 'pointer' }} onClick={handleStartDwsAuth}>
                      DWS 未授权，点击授权
                    </Tag>
                  )}
                </div>
              )}
              <div className={styles.detailSourceActions}>
                <Tag icon={<ClockCircleOutlined />} bordered={false}>
                  {source.cronExpr || '手动'}
                </Tag>
                {source.lastScanTime && (
                  <span className={styles.detailSourceTime}>
                    上次: {dayjs(source.lastScanTime).format('MM-DD HH:mm')}
                  </span>
                )}
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
          ))}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      )}
    </Spin>
  );

  const renderRequirements = () => (
    <>
      {renderSourceList()}
      {lastLog && (
        <div className={styles.detailScanStatus}>
          <span className={styles.detailStatusDot} />
          <span>
            上次扫描完成，共归并 {lastLog.foundCount} 条候选，新增 {lastLog.createdCount} 条需求
          </span>
          <span className={styles.detailTime}>完成于 {dayjs(lastLog.scanTime).format('HH:mm')}</span>
        </div>
      )}
      <div className={styles.detailSectionHeader}>
        <span>{requirements.length} 个需求</span>
        <Button size="small" icon={<PlusOutlined />} onClick={() => message.info('人工新增需求功能待后端接口接入')}>
          人工新增
        </Button>
      </div>
      {requirements.length ? (
        <div className={styles.detailRequirementList}>
          {requirements.map((item, index) => (
            <div key={item.itemId} className={styles.detailRequirementItem}>
              <span className={styles.detailScore} style={{ background: SCORE_COLORS[index % SCORE_COLORS.length] }}>
                {60 + ((item.itemId || index) % 40)}
              </span>
              <div className={styles.detailRequirementMain}>
                <strong>{item.title}</strong>
                <span>
                  {getSourceLabel(item.sourceType)} · {item.sourceName || '-'} ·{' '}
                  {item.createTime ? dayjs(item.createTime).format('MM-DD HH:mm') : '-'}
                </span>
              </div>
              {item.taskId ? (
                <Button size="small" className={styles.detailRequirementAction} disabled>
                  已启动
                </Button>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  className={styles.detailRequirementAction}
                  onClick={() => handleStartTask(item)}
                >
                  启动
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无需求，点击「扫描」收集" />
      )}
    </>
  );

  const renderResources = () => (
    <>
      <div className={styles.detailSectionHeader}>
        <span>{sources.length} 个收集源</span>
        <Button size="small" icon={<PlusOutlined />} onClick={() => openAddSourceModal()}>
          添加
        </Button>
      </div>
      {renderSourceList('暂无资源，点击右上角 + 添加收集源')}
    </>
  );

  const renderTasks = () => (
    <div className={styles.detailTaskPanel}>
      <div className={styles.detailTaskHeader}>
        <span className={styles.detailTaskSummary}>
          <span>{tasks.length} 个研发任务</span>
          <span>0 个与我关联</span>
        </span>
        <Button icon={<AppstoreOutlined />} onClick={() => setTaskKanbanOpen(true)}>
          整体任务视图
        </Button>
      </div>

      {tasks.length ? (
        <div className={styles.detailTaskList}>
          {tasks.map((task) => {
            const progress = task.totalRounds > 0 ? Math.round((task.currentRound / task.totalRounds) * 100) : 0;
            return (
              <div key={task.taskId} className={styles.detailTaskCard} onClick={() => setDetailTask(task)}>
                <div className={styles.detailTaskMain}>
                  <Tooltip placement="top" title={task.title}>
                    <h4 className={styles.detailTaskTitle}>{task.title}</h4>
                  </Tooltip>
                  <div className={styles.detailTaskMeta}>
                    <Tag color={PHASE_COLORS[task.phase] || 'default'}>{task.phase}</Tag>
                    <span>{task.agentName}</span>
                    {task.branchName && <span className={styles.detailTaskBranch}>{task.branchName}</span>}
                  </div>
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
            );
          })}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务，在需求 Tab 点击「启动」创建" />
      )}

      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} onRefresh={fetchTasks} />
      <TaskKanban
        open={taskKanbanOpen}
        onClose={() => setTaskKanbanOpen(false)}
        tasks={tasks}
        onRefresh={fetchTasks}
        projectId={projectId}
      />
    </div>
  );

  const renderTabContent = () => {
    if (activeTab === 'tasks') {
      return renderTasks();
    }
    if (activeTab === 'resources') return renderResources();
    if (activeTab === 'members') {
      return (
        <div className={styles.detailEmbeddedContent}>
          <ProjectMemberList projectId={projectId} onMembersChange={setMembers} />
        </div>
      );
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
      width={520}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          {editingSource && (
            <Button
              danger
              onClick={() => {
                setSourceModalOpen(false);
                handleDeleteSource(editingSource);
              }}
            >
              删除
            </Button>
          )}
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
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
      {sourceForm.type === 'dingtalk' && (
        <>
          {!dwsAuthed && (
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
      <div className={styles.formField}>
        <label>扫描频率</label>
        <Select
          value={sourceForm.cron}
          onChange={(cron) => setSourceForm((prev) => ({ ...prev, cron }))}
          options={cronPresets}
        />
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
      width={520}
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
    <div className={styles.projectDetailPanel}>
      <div className={styles.detailPanelHeader}>
        <Tooltip title="返回" placement="top">
          <Button className={styles.detailBackButton} icon={<LeftOutlined />} onClick={onBack} />
        </Tooltip>
        <div className={styles.detailPanelTitle}>
          <h3>{project?.projectName || '项目详情'}</h3>
          <p>研发项目详情</p>
        </div>
        <div className={styles.detailPanelActions}>
          <Tooltip title="编辑项目" placement="top">
            <Button
              className={styles.detailIconButton}
              icon={<EditOutlined />}
              onClick={() => project && onEditProject?.(project)}
            />
          </Tooltip>
          <Tooltip title={activeTab === 'members' ? '添加成员' : '新增需求'} placement="top">
            <Button className={styles.detailAddButton} icon={<PlusOutlined />} onClick={handleHeaderAdd} />
          </Tooltip>
        </div>
      </div>
      <div className={styles.detailTabsWrap}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </div>
      <div className={styles.detailCountRow}>
        <span>{requirements.length} 个需求</span>
        <span>{tasks.length} 个研发任务</span>
        <span>{members.length} 个成员</span>
      </div>
      <Spin spinning={detailSpinning} wrapperClassName={styles.detailSpin}>
        <div className={styles.detailBodyPanel}>{renderTabContent()}</div>
      </Spin>
      {renderAddSourceModal()}
      {renderRepoModal()}
      {renderDwsAuthModal()}
      {renderLogDrawer()}
    </div>
  );
};

export default ProjectDetailPanel;
