import React, { useState, useEffect, useCallback } from 'react';
import { Card, Switch, Tag, Button, Select, Tabs, Modal, Input, message, Empty, Spin, Space, List, Drawer } from 'antd';
import {
  PlusOutlined,
  ArrowLeftOutlined,
  EditOutlined,
  DeleteOutlined,
  ProjectOutlined,
  SettingOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  DingdingOutlined,
  GithubOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  createProject,
  listProjects,
  listScanSources,
  createScanSource,
  toggleScanSource,
  triggerScan,
  listScanLogs,
  listScanLogItems,
  saveGitHubPat,
  checkGitHubPat,
  searchDingtalkGroups,
  updateProject,
  deleteProject,
  updateScanSource,
  deleteScanSource,
  createTask,
  listTasks,
  checkDwsAuthStatus,
  startDwsDeviceAuth,
} from '@/service/devloop';
import styles from './index.module.less';
import TaskList from './TaskList';
import MemberList from './MemberList';

type SourceType = 'dingtalk' | 'github_issue';

interface ProjectItem {
  projectId: number;
  projectName: string;
  description?: string;
  createTime: string;
}

interface ScanSourceItem {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  config: string;
  cronExpr: string;
  enabled: string;
  lastScanTime: string | null;
}

interface ScanLogEntry {
  logId: number;
  scanTime: string;
  foundCount: number;
  createdCount: number;
  status: string;
}

interface RequirementItem {
  itemId: number;
  title: string;
  originId: string;
  originUrl: string;
  action: string;
  createTime: string;
  sourceType?: string;
  sourceName?: string;
  taskId?: number;
}

const SCORE_COLORS = ['#52c41a', '#73d13d', '#95de64', '#faad14', '#ffc53d'];

const cronPresets = [
  { value: '*/15 * * * *', label: '每15分钟' },
  { value: '*/30 * * * *', label: '每30分钟' },
  { value: '0 */1 * * *', label: '每小时' },
  { value: '0 */2 * * *', label: '每2小时' },
  { value: '0 9,14,18 * * 1-5', label: '工作日 9/14/18点' },
];

const NeedCollect: React.FC = () => {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectItem | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);

  const [sources, setSources] = useState<ScanSourceItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [lastLog, setLastLog] = useState<ScanLogEntry | null>(null);
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [startingTaskItemId, setStartingTaskItemId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('requirements');
  const [tasks, setTasks] = useState<any[]>([]);

  // 弹窗
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [projectForm, setProjectForm] = useState({ name: '', description: '' });
  const [projectCreating, setProjectCreating] = useState(false);

  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [editingSource, setEditingSource] = useState<ScanSourceItem | null>(null);
  const [addForm, setAddForm] = useState({
    type: 'dingtalk' as SourceType,
    name: '',
    chatId: '',
    keywords: '',
    lookbackHours: '24',
    repo: 'beyonai/byclaw-test',
    labels: '',
    pat: '',
    cron: '*/30 * * * *',
  });

  const [hasPatSaved, setHasPatSaved] = useState(false);
  const [groupOptions, setGroupOptions] = useState<{ value: string; label: string }[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);

  // DWS 授权
  const [dwsAuthed, setDwsAuthed] = useState(false);
  const [dwsExpired, setDwsExpired] = useState(false);
  const [dwsExpiresAt, setDwsExpiresAt] = useState('');
  const [dwsAuthLoading, setDwsAuthLoading] = useState(false);
  const [dwsDeviceInfo, setDwsDeviceInfo] = useState<{ userCode: string; verificationUrl: string } | null>(null);
  const [dwsAuthPolling, setDwsAuthPolling] = useState(false);
  const [dwsAuthDetailVisible, setDwsAuthDetailVisible] = useState(false);
  const [dwsAuthDetail, setDwsAuthDetail] = useState<any>(null);

  const [showLogModal, setShowLogModal] = useState(false);
  const [logModalSource, setLogModalSource] = useState<ScanSourceItem | null>(null);
  const [logList, setLogList] = useState<any[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // --- 数据加载 ---
  const fetchProjects = useCallback(async () => {
    setProjectLoading(true);
    try {
      const res = await listProjects();
      if (res) setProjects(res);
    } finally {
      setProjectLoading(false);
    }
  }, []);

  const fetchSources = useCallback(async () => {
    if (!currentProject) return;
    setSourcesLoading(true);
    try {
      const res = await listScanSources(currentProject.projectId);
      if (res) setSources(res);
    } finally {
      setSourcesLoading(false);
    }
  }, [currentProject]);

  const fetchRequirements = useCallback(async () => {
    if (!currentProject) return;
    const sourceRes = await listScanSources(currentProject.projectId);
    if (!sourceRes || sourceRes.length === 0) return;

    const allItems: RequirementItem[] = [];
    let latestLog: ScanLogEntry | null = null;

    for (const source of sourceRes) {
      const logs = await listScanLogs(source.sourceId, 10);
      if (logs && logs.length > 0) {
        if (!latestLog || new Date(logs[0].scanTime) > new Date(latestLog.scanTime)) {
          latestLog = logs[0];
        }
        // 只拉最新一条 log 的 items，避免大量重复请求
        const items = await listScanLogItems(logs[0].logId);
        if (items) {
          items
            .filter((it: any) => it.action === 'created')
            .forEach((it: any) => {
              allItems.push({
                ...it,
                sourceType: source.sourceType,
                sourceName: source.sourceName,
              });
            });
        }
      }
    }
    setRequirements(allItems);
    setLastLog(latestLog);
  }, [currentProject]);

  const fetchTasks = useCallback(async () => {
    if (!currentProject) return;
    const res = await listTasks(currentProject.projectId);
    if (res) setTasks(res);
  }, [currentProject]);

  useEffect(() => {
    fetchProjects();
  }, []);
  useEffect(() => {
    if (view === 'detail') {
      fetchSources();
      fetchRequirements();
      fetchTasks();
    }
  }, [currentProject, view]);
  useEffect(() => {
    checkGitHubPat()
      .then((res: any) => {
        if (res?.hasPat) setHasPatSaved(true);
      })
      .catch(() => {});
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
      .catch(() => {});
  }, []);

  // --- 项目操作 ---
  const handleSelectProject = (project: ProjectItem) => {
    setCurrentProject(project);
    setSources([]);
    setRequirements([]);
    setLastLog(null);
    setView('detail');
  };

  const handleCreateProject = async () => {
    if (!projectForm.name.trim()) {
      message.error('请输入项目名称');
      return;
    }
    setProjectCreating(true);
    try {
      if (editingProject) {
        await updateProject({
          projectId: editingProject.projectId,
          projectName: projectForm.name.trim(),
          description: projectForm.description.trim(),
        });
        message.success('项目已更新');
        setShowProjectModal(false);
        setEditingProject(null);
        setProjectForm({ name: '', description: '' });
        await fetchProjects();
        if (currentProject?.projectId === editingProject.projectId) {
          setCurrentProject({
            ...currentProject,
            projectName: projectForm.name.trim(),
            description: projectForm.description.trim(),
          });
        }
      } else {
        const res = await createProject({
          projectName: projectForm.name.trim(),
          description: projectForm.description.trim(),
        });
        if (res?.projectId) {
          message.success('项目创建成功');
          setShowProjectModal(false);
          setProjectForm({ name: '', description: '' });
          await fetchProjects();
          handleSelectProject({
            projectId: res.projectId,
            projectName: projectForm.name.trim(),
            description: projectForm.description.trim(),
            createTime: new Date().toISOString(),
          });
        }
      }
    } catch {
      message.error(editingProject ? '更新失败' : '创建失败');
    } finally {
      setProjectCreating(false);
    }
  };

  const handleDeleteProject = (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation();
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除项目「${project.projectName}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteProject(project.projectId);
        message.success('项目已删除');
        fetchProjects();
        if (currentProject?.projectId === project.projectId) {
          setView('list');
          setCurrentProject(null);
        }
      },
    });
  };

  // --- 扫描源操作 ---
  const handleSaveSource = async () => {
    if (!addForm.name.trim()) {
      message.error('请填写名称');
      return;
    }
    if (!currentProject) return;
    let config = '';
    if (addForm.type === 'dingtalk') {
      if (!addForm.chatId) {
        message.error('请选择钉钉群');
        return;
      }
      config = JSON.stringify({
        groupId: addForm.chatId,
        keyword: addForm.keywords || '需求',
        lookbackHours: parseInt(addForm.lookbackHours) || 24,
        corpId: dwsAuthDetail?.corpId || '',
      });
    } else {
      if (!addForm.repo.trim()) {
        message.error('请填写仓库');
        return;
      }
      if (!hasPatSaved && !addForm.pat.trim()) {
        message.error('请填写 GitHub PAT');
        return;
      }
      config = JSON.stringify({ repo: addForm.repo.trim(), labels: addForm.labels, state: 'open' });
    }
    try {
      if (addForm.type === 'github_issue' && addForm.pat.trim()) {
        await saveGitHubPat(addForm.pat.trim());
        setHasPatSaved(true);
      }
      if (editingSource) {
        await updateScanSource({
          sourceId: editingSource.sourceId,
          sourceName: addForm.name.trim(),
          config,
          cronExpr: addForm.cron,
        });
        message.success('收集源已更新');
      } else {
        await createScanSource({
          projectId: currentProject.projectId,
          sourceName: addForm.name.trim(),
          sourceType: addForm.type,
          config,
          cronExpr: addForm.cron,
          enabled: '1',
        });
        message.success('收集源添加成功');
      }
      setShowAddSourceModal(false);
      setEditingSource(null);
      fetchSources();
      fetchRequirements();
    } catch {
      message.error(editingSource ? '更新失败' : '添加失败');
    }
  };

  const handleEditSource = (source: ScanSourceItem) => {
    setEditingSource(source);
    let cfg: any = {};
    try {
      cfg = JSON.parse(source.config);
    } catch {}
    setAddForm({
      type: source.sourceType as SourceType,
      name: source.sourceName,
      chatId: cfg.groupId || '',
      keywords: cfg.keyword || '',
      lookbackHours: cfg.lookbackHours ? String(cfg.lookbackHours) : '24',
      repo: cfg.repo || '',
      labels: cfg.labels || '',
      pat: '',
      cron: source.cronExpr || '*/30 * * * *',
    });
    setShowAddSourceModal(true);
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
        fetchSources();
        fetchRequirements();
      },
    });
  };

  const handleTriggerScan = async (sourceId: number) => {
    setScanningId(sourceId);
    try {
      const res = await triggerScan(sourceId);
      message.success(`扫描完成，新建 ${res?.createdCount || 0} 条`);
      fetchSources();
      fetchRequirements();
    } catch {
      message.error('扫描失败');
    } finally {
      setScanningId(null);
    }
  };

  const handleToggle = async (sourceId: number, checked: boolean) => {
    await toggleScanSource(sourceId, checked ? '1' : '0');
    message.success(checked ? '已启用' : '已暂停');
    fetchSources();
  };

  const handleViewLogs = async (source: ScanSourceItem) => {
    setLogModalSource(source);
    setShowLogModal(true);
    setLogLoading(true);
    try {
      const logs = await listScanLogs(source.sourceId, 10);
      setLogList(logs || []);
    } finally {
      setLogLoading(false);
    }
  };

  const handleStartTask = async (req: RequirementItem) => {
    if (!currentProject || startingTaskItemId) return;
    setStartingTaskItemId(req.itemId);
    try {
      const res = await createTask({ projectId: currentProject.projectId, sourceItemId: req.itemId, title: req.title });
      if (!res) {
        message.error('创建任务失败');
        return;
      }
      message.success('任务已创建');
      fetchTasks();
      setActiveTab('tasks');
    } catch {
      message.error('创建任务失败');
    } finally {
      setStartingTaskItemId(null);
    }
  };

  // --- 钉钉群搜索 ---
  let groupSearchTimer: ReturnType<typeof setTimeout> | null = null;
  const handleGroupSearch = (value: string) => {
    if (!value || value.length < 2) {
      setGroupOptions([]);
      return;
    }
    if (groupSearchTimer) clearTimeout(groupSearchTimer);
    groupSearchTimer = setTimeout(async () => {
      setGroupSearching(true);
      try {
        const res = await searchDingtalkGroups(value);
        if (res) {
          setGroupOptions(
            res.map((g: any) => ({ value: g.openConversationId, label: g.name || g.openConversationId }))
          );
        }
      } catch {
        setGroupOptions([]);
      } finally {
        setGroupSearching(false);
      }
    }, 500);
  };

  const pollDwsAuthStatus = () => {
    const timer = setInterval(async () => {
      try {
        const res = await checkDwsAuthStatus();
        if (res?.tokenValid) {
          clearInterval(timer);
          message.success('钉钉授权成功');
          setDwsAuthed(true);
          setDwsExpired(false);
          setDwsAuthDetail(res);
          if (res.expiresAt) setDwsExpiresAt(res.expiresAt);
          setDwsDeviceInfo(null);
          setDwsAuthPolling(false);
        }
      } catch {
        // 轮询失败忽略，继续重试
      }
    }, 5000);
    // 3分钟超时
    setTimeout(() => {
      clearInterval(timer);
      if (!dwsAuthed) {
        setDwsDeviceInfo(null);
        setDwsAuthPolling(false);
        message.warning('授权超时，请重试');
      }
    }, 180000);
  };

  // --- DWS 授权 ---
  const handleStartDwsAuth = async () => {
    setDwsAuthLoading(true);
    try {
      const res = await startDwsDeviceAuth();
      if (res?.userCode && res?.verificationUrl) {
        setDwsDeviceInfo({ userCode: res.userCode, verificationUrl: res.verificationUrl });
        // 在浏览器打开授权链接
        window.open(res.verificationUrl, '_blank');
        // 开始轮询等待授权完成
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

  // --- 渲染弹窗 ---
  const renderProjectModal = () => (
    <Modal
      title={editingProject ? '编辑项目' : '新建项目'}
      open={showProjectModal}
      onOk={handleCreateProject}
      onCancel={() => {
        setShowProjectModal(false);
        setEditingProject(null);
      }}
      confirmLoading={projectCreating}
      okText={editingProject ? '保存' : '创建'}
    >
      <div className={styles.formField}>
        <label>项目名称</label>
        <Input
          placeholder="输入项目名称"
          value={projectForm.name}
          onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
        />
      </div>
      <div className={styles.formField}>
        <label>描述（可选）</label>
        <Input.TextArea
          rows={3}
          placeholder="项目描述"
          value={projectForm.description}
          onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
        />
      </div>
    </Modal>
  );

  const renderAddSourceModal = () => (
    <Modal
      title={editingSource ? '编辑收集源' : '添加收集源'}
      open={showAddSourceModal}
      onOk={handleSaveSource}
      onCancel={() => {
        setShowAddSourceModal(false);
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
                setShowAddSourceModal(false);
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
          value={addForm.type}
          disabled={!!editingSource}
          onChange={(v) => setAddForm({ ...addForm, type: v })}
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
          value={addForm.name}
          onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
        />
      </div>
      {addForm.type === 'dingtalk' && (
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
              value={addForm.chatId || undefined}
              onSearch={handleGroupSearch}
              onChange={(v) => setAddForm({ ...addForm, chatId: v })}
              options={groupOptions}
              loading={groupSearching}
              notFoundContent={groupSearching ? <Spin size="small" /> : '输入至少2个字搜索'}
            />
          </div>
          <div className={styles.formField}>
            <label>关键词</label>
            <Input
              placeholder="默认: 需求"
              value={addForm.keywords}
              onChange={(e) => setAddForm({ ...addForm, keywords: e.target.value })}
            />
          </div>
          <div className={styles.formField}>
            <label>回溯时长（小时）</label>
            <Select
              value={addForm.lookbackHours}
              onChange={(v) => setAddForm({ ...addForm, lookbackHours: v })}
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
      {addForm.type === 'github_issue' && (
        <>
          {!hasPatSaved && (
            <div className={styles.formField}>
              <label>GitHub PAT</label>
              <Input.Password
                placeholder="输入 Personal Access Token"
                value={addForm.pat}
                onChange={(e) => setAddForm({ ...addForm, pat: e.target.value })}
              />
            </div>
          )}
          <div className={styles.formField}>
            <label>仓库</label>
            <Input
              placeholder="owner/repo"
              value={addForm.repo}
              onChange={(e) => setAddForm({ ...addForm, repo: e.target.value })}
            />
          </div>
          <div className={styles.formField}>
            <label>标签过滤（可选）</label>
            <Input
              placeholder="如 bug,feature"
              value={addForm.labels}
              onChange={(e) => setAddForm({ ...addForm, labels: e.target.value })}
            />
          </div>
        </>
      )}
      <div className={styles.formField}>
        <label>扫描频率</label>
        <Select value={addForm.cron} onChange={(v) => setAddForm({ ...addForm, cron: v })} options={cronPresets} />
      </div>
    </Modal>
  );

  const formatConfig = (type: string, config: string) => {
    try {
      const c = JSON.parse(config);
      if (type === 'dingtalk') return c.chatName || c.chatId || '-';
      if (type === 'github') return c.repo || '-';
      return '-';
    } catch {
      return '-';
    }
  };

  // ========== 项目列表视图 ==========
  if (view === 'list') {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h2>研发闭环</h2>
            <p className={styles.subtitle}>选择一个项目，管理需求收集与研发任务</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingProject(null);
              setProjectForm({ name: '', description: '' });
              setShowProjectModal(true);
            }}
          >
            新建项目
          </Button>
        </div>
        <Spin spinning={projectLoading}>
          {projects.length === 0 ? (
            <Empty description="暂无项目，请先创建">
              <Button
                type="primary"
                onClick={() => {
                  setEditingProject(null);
                  setProjectForm({ name: '', description: '' });
                  setShowProjectModal(true);
                }}
              >
                创建项目
              </Button>
            </Empty>
          ) : (
            <List
              grid={{ gutter: 16, column: 3 }}
              dataSource={projects}
              renderItem={(item) => (
                <List.Item>
                  <Card
                    hoverable
                    className={styles.projectCard}
                    onClick={() => handleSelectProject(item)}
                    actions={[
                      <EditOutlined
                        key="edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingProject(item);
                          setProjectForm({ name: item.projectName, description: item.description || '' });
                          setShowProjectModal(true);
                        }}
                      />,
                      <DeleteOutlined key="delete" onClick={(e) => handleDeleteProject(item, e)} />,
                    ]}
                  >
                    <Card.Meta
                      avatar={<ProjectOutlined style={{ fontSize: 24, color: '#1677ff' }} />}
                      title={item.projectName}
                      description={item.description || '暂无描述'}
                    />
                    <div className={styles.projectTime}>创建于 {dayjs(item.createTime).format('YYYY-MM-DD')}</div>
                  </Card>
                </List.Item>
              )}
            />
          )}
        </Spin>
        {renderProjectModal()}
      </div>
    );
  }

  // ========== 项目详情视图 ==========
  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderLeft}>
          <Button icon={<ArrowLeftOutlined />} type="text" shape="circle" onClick={() => setView('list')} />
          <div className={styles.detailTitle}>
            <h2>{currentProject?.projectName}</h2>
            <p>研发项目详情</p>
          </div>
        </div>
        <Space>
          <Button
            icon={<SettingOutlined />}
            type="text"
            onClick={() => {
              setEditingProject(currentProject);
              setProjectForm({
                name: currentProject?.projectName || '',
                description: currentProject?.description || '',
              });
              setShowProjectModal(true);
            }}
          />
          <Button
            icon={<PlusOutlined />}
            type="text"
            onClick={() => {
              setEditingSource(null);
              setAddForm({
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
              setShowAddSourceModal(true);
            }}
          />
        </Space>
      </div>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'requirements', label: '需求' },
          { key: 'tasks', label: '任务' },
          { key: 'resources', label: '资源', disabled: true },
          { key: 'members', label: '成员' },
        ]}
      />

      {/* 统计行 */}
      <div className={styles.tabSummary}>
        <span>{requirements.length} 个需求</span>
        <span>{tasks.length} 个研发任务</span>
      </div>

      {activeTab === 'requirements' && (
        <>
          {/* 收集源列表 */}
          <Spin spinning={sourcesLoading}>
            {sources.length === 0 ? (
              <Empty description="暂无收集源，点击右上角 + 添加" />
            ) : (
              <div className={styles.sourceList}>
                {sources.map((source) => (
                  <Card key={source.sourceId} size="small" className={styles.sourceCard}>
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>
                        {source.sourceType === 'dingtalk' ? <DingdingOutlined /> : <GithubOutlined />}
                      </span>
                      <span className={styles.cardName}>{source.sourceName}</span>
                      <Switch
                        size="small"
                        checked={source.enabled === '1'}
                        onChange={(v) => handleToggle(source.sourceId, v)}
                      />
                    </div>
                    <div className={styles.cardConfig}>{formatConfig(source.sourceType, source.config)}</div>
                    {source.sourceType === 'dingtalk' && (
                      <div style={{ marginBottom: 4 }}>
                        {dwsAuthed ? (
                          <Tag
                            color="green"
                            style={{ cursor: 'pointer' }}
                            onClick={() => setDwsAuthDetailVisible(true)}
                          >
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
                    <div className={styles.cardMeta}>
                      <Tag icon={<ClockCircleOutlined />} bordered={false}>
                        {source.cronExpr || '手动'}
                      </Tag>
                      {source.lastScanTime && (
                        <span className={styles.lastScan}>
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
                      <Button
                        type="link"
                        size="small"
                        icon={<FileTextOutlined />}
                        onClick={() => handleViewLogs(source)}
                      >
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
                  </Card>
                ))}
              </div>
            )}
          </Spin>

          {lastLog && (
            <div className={styles.aiCardStatus}>
              <span className={styles.statusDot} />
              <span>
                上次扫描完成，共归并 {lastLog.foundCount} 条候选，新增 {lastLog.createdCount} 条需求
              </span>
              <span className={styles.statusTime}>完成于 {dayjs(lastLog.scanTime).format('HH:mm')}</span>
            </div>
          )}

          <div className={styles.reqHeader}>
            <span className={styles.reqCount}>{requirements.length} 个需求</span>
            <Button type="default" icon={<PlusOutlined />}>
              人工新增
            </Button>
          </div>

          <div className={styles.reqList}>
            {requirements.map((req, idx) => {
              const score = 50 + Math.floor(Math.abs(Math.sin(req.itemId)) * 50);
              const colorIdx = idx % SCORE_COLORS.length;
              const sourceLabel = req.sourceType === 'dingtalk' ? '钉钉' : 'GitHub Issues';
              return (
                <div key={req.itemId} className={styles.reqCard}>
                  <div className={styles.scoreCircle} style={{ background: SCORE_COLORS[colorIdx] }}>
                    {score}
                  </div>
                  <div className={styles.reqContent}>
                    <p className={styles.reqTitle}>{req.title}</p>
                    <span className={styles.reqMeta}>
                      {sourceLabel} · {req.sourceName} ·{' '}
                      {req.createTime ? dayjs(req.createTime).format('MM-DD HH:mm') : ''}
                    </span>
                  </div>
                  <div className={styles.reqRight}>
                    {req.taskId ? (
                      <Button size="small" disabled>
                        已启动
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        size="small"
                        loading={startingTaskItemId === req.itemId}
                        disabled={startingTaskItemId !== null}
                        onClick={() => handleStartTask(req)}
                      >
                        启动任务
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {requirements.length === 0 && !sourcesLoading && <Empty description={'暂无需求，点击「扫描」收集'} />}
          </div>
        </>
      )}

      {activeTab === 'tasks' && <TaskList tasks={tasks} onRefresh={fetchTasks} projectId={currentProject?.projectId} />}

      {activeTab === 'members' && <MemberList projectId={currentProject?.projectId} />}

      {renderAddSourceModal()}
      {renderProjectModal()}

      {/* 扫描日志抽屉 */}
      <Drawer
        title={`扫描日志 - ${logModalSource?.sourceName || ''}`}
        open={showLogModal}
        onClose={() => setShowLogModal(false)}
        width={520}
      >
        <Spin spinning={logLoading}>
          {logList.length === 0 ? (
            <Empty description="暂无扫描记录" />
          ) : (
            <List
              dataSource={logList}
              renderItem={(log: any) => (
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
          )}
        </Spin>
      </Drawer>

      {/* DWS 授权详情弹窗 */}
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
          <div style={{ lineHeight: '2.2' }}>
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
              {dwsAuthDetail.refreshExpiresAt
                ? dayjs(dwsAuthDetail.refreshExpiresAt).format('YYYY-MM-DD HH:mm:ss')
                : '-'}
            </p>
          </div>
        ) : (
          <Empty description="暂无授权信息" />
        )}
      </Modal>
    </div>
  );
};

export default NeedCollect;
