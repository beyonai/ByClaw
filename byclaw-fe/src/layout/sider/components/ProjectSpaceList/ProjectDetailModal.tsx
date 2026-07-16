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
  SettingOutlined,
} from '@ant-design/icons';
import { fetchEventSource } from '@fortaine/fetch-event-source';
import dayjs from 'dayjs';
import {
  checkGitHubPat,
  createScanSource,
  createTask,
  deleteScanSource,
  listProjectMembers,
  listScanLogItems,
  listScanLogs,
  listScanSources,
  listTasks,
  saveGitHubPat,
  searchDingtalkGroups,
  toggleScanSource,
  triggerScan,
  updateScanSource,
  updateTask,
} from '@/service/devloop';
import TaskDetailDrawer from '@/pages/devloop/TaskDetailDrawer';
import TaskKanban from '@/pages/devloop/TaskKanban';
import MemberList from '@/pages/devloop/MemberList';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import { getToken, getssoToken, ssotokenKey, tokenKey } from '@/utils/auth';
import { generateSignature } from '@/utils/signature';
import styles from './index.module.less';

type SourceType = 'dingtalk' | 'github_issue';

type ScanSourceItem = {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  config?: string;
  cronExpr?: string;
  enabled?: string;
  lastScanTime?: string | null;
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
  keywords: string;
  lookbackHours: string;
  repo: string;
  labels: string;
  pat: string;
  cron: string;
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
  keywords: '',
  lookbackHours: '24',
  repo: '',
  labels: '',
  pat: '',
  cron: '*/30 * * * *',
});

const formatConfig = (type: string, config?: string) => {
  try {
    const parsedConfig = JSON.parse(config || '{}');
    if (type === 'dingtalk') return parsedConfig.chatName || parsedConfig.chatId || parsedConfig.groupId || '-';
    return parsedConfig.repo || '-';
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
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logModalSource, setLogModalSource] = useState<ScanSourceItem | null>(null);
  const [logList, setLogList] = useState<ScanLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [detailTask, setDetailTask] = useState<any>(null);
  const [taskKanbanOpen, setTaskKanbanOpen] = useState(false);
  const groupSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    const memberList = (await listProjectMembers(projectId)) || [];
    setMembers(memberList);
  }, [projectId]);

  const fetchDetailData = useCallback(async () => {
    if (!projectId) return;
    const sourceList = await fetchSources();
    await Promise.all([fetchRequirements(sourceList), fetchTasks(), fetchMembers()]);
  }, [fetchMembers, fetchRequirements, fetchSources, fetchTasks, projectId]);

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

  // 各 tab 只响应自己的加载状态，避免需求/日志等后台请求盖住其它 tab 已渲染的数据。
  const detailSpinning =
    (activeTab === 'requirements' && requirementsLoading) || (activeTab === 'tasks' && tasksLoading);

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

    let config = '';
    if (sourceForm.type === 'dingtalk') {
      if (!sourceForm.chatId) {
        message.error('请选择钉钉群');
        return;
      }
      config = JSON.stringify({
        groupId: sourceForm.chatId,
        keyword: sourceForm.keywords || '需求',
        lookbackHours: parseInt(sourceForm.lookbackHours, 10) || 24,
      });
    } else {
      if (!sourceForm.repo.trim()) {
        message.error('请填写仓库');
        return;
      }
      if (!hasPatSaved && !sourceForm.pat.trim()) {
        message.error('请填写 GitHub PAT');
        return;
      }
      config = JSON.stringify({
        repo: sourceForm.repo.trim(),
        labels: sourceForm.labels,
        state: 'open',
      });
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
      keywords: config.keyword || '',
      lookbackHours: config.lookbackHours ? String(config.lookbackHours) : '24',
      repo: config.repo || '',
      labels: config.labels || '',
      pat: '',
      cron: source.cronExpr || '*/30 * * * *',
    });
    setSourceModalOpen(true);
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

  const renderSourceList = (emptyText = '暂无收集源，点击右上角 + 添加') => (
    <Spin spinning={sourcesLoading}>
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
        <span>{tasks.length} 个研发任务 · 0 个与我关联</span>
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
                  <span>{task.assignee || '我'}</span>
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
          <MemberList projectId={projectId} />
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
      {sourceForm.type === 'dingtalk' && (
        <>
          <div className={styles.formField}>
            <label>钉钉群</label>
            <Select
              showSearch
              filterOption={false}
              placeholder="输入群名搜索"
              value={sourceForm.chatId || undefined}
              onSearch={handleGroupSearch}
              onChange={(chatId) => setSourceForm((prev) => ({ ...prev, chatId }))}
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
            <label>仓库</label>
            <Input
              placeholder="owner/repo"
              value={sourceForm.repo}
              onChange={(event) => setSourceForm((prev) => ({ ...prev, repo: event.target.value }))}
            />
          </div>
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
        <Button className={styles.detailBackButton} icon={<LeftOutlined />} onClick={onBack} />
        <div className={styles.detailPanelTitle}>
          <h3>{project?.projectName || '项目详情'}</h3>
          <p>研发项目详情</p>
        </div>
        <div className={styles.detailPanelActions}>
          <Button
            className={styles.detailIconButton}
            icon={<SettingOutlined />}
            onClick={() => project && onEditProject?.(project)}
          />
          <Button className={styles.detailAddButton} icon={<PlusOutlined />} onClick={handleHeaderAdd} />
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
      {renderLogDrawer()}
    </div>
  );
};

export default ProjectDetailPanel;
