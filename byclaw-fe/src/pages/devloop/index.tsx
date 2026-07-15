import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Switch,
  Tag,
  Button,
  Select,
  Timeline,
  Modal,
  Input,
  message,
  Empty,
  Spin,
  Space,
  List,
  Typography,
} from 'antd';
import {
  DingdingOutlined,
  GithubOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  ProjectOutlined,
  ArrowLeftOutlined,
  EditOutlined,
  DeleteOutlined,
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
} from '@/service/devloop';
import styles from './index.module.less';

const { Text } = Typography;

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

interface ScanLogDetailItem {
  itemId: number;
  title: string;
  originId: string;
  originUrl: string;
  action: string;
}

const sourceIcon: Record<string, React.ReactNode> = {
  dingtalk: <DingdingOutlined style={{ color: '#1890ff' }} />,
  github_issue: <GithubOutlined />,
};

const actionTag: Record<string, { label: string; color: string }> = {
  created: { label: '新建任务', color: 'green' },
  duplicate: { label: '重复跳过', color: 'default' },
  deferred: { label: '放入待办池', color: 'orange' },
};

const cronPresets = [
  { value: '*/15 * * * *', label: '每15分钟' },
  { value: '*/30 * * * *', label: '每30分钟' },
  { value: '0 */1 * * *', label: '每小时' },
  { value: '0 */2 * * *', label: '每2小时' },
  { value: '0 9,14,18 * * 1-5', label: '工作日 9/14/18点' },
];

const NeedCollect: React.FC = () => {
  // 页面视图: 'list' 项目列表 | 'detail' 项目详情
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectItem | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);

  // 项目详情状态
  const [sources, setSources] = useState<ScanSourceItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [logs, setLogs] = useState<ScanLogEntry[]>([]);
  const [logItems, setLogItems] = useState<Record<number, ScanLogDetailItem[]>>({});
  const [scanningId, setScanningId] = useState<number | null>(null);

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

  // PAT & 钉钉群
  const [hasPatSaved, setHasPatSaved] = useState(false);
  const [groupOptions, setGroupOptions] = useState<{ value: string; label: string }[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);

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

  useEffect(() => {
    fetchProjects();
  }, []);
  useEffect(() => {
    if (view === 'detail') fetchSources();
  }, [currentProject, view]);
  useEffect(() => {
    checkGitHubPat()
      .then((res) => {
        if (res?.hasPat) setHasPatSaved(true);
      })
      .catch(() => {});
  }, []);

  // --- 项目操作 ---
  const handleSelectProject = (project: ProjectItem) => {
    setCurrentProject(project);
    setSources([]);
    setLogs([]);
    setLogItems({});
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
          const newProject: ProjectItem = {
            projectId: res.projectId,
            projectName: projectForm.name.trim(),
            description: projectForm.description.trim(),
            createTime: new Date().toISOString(),
          };
          handleSelectProject(newProject);
        }
      }
    } catch {
      message.error(editingProject ? '更新失败' : '创建失败');
    } finally {
      setProjectCreating(false);
    }
  };

  const handleEditProject = (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(project);
    setProjectForm({ name: project.projectName, description: project.description || '' });
    setShowProjectModal(true);
  };

  const handleDeleteProject = (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation();
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除项目「${project.projectName}」吗？删除后不可恢复。`,
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
  const handleToggle = async (sourceId: number, checked: boolean) => {
    await toggleScanSource(sourceId, checked ? '1' : '0');
    message.success(checked ? '已启用' : '已暂停');
    fetchSources();
  };

  const handleTriggerScan = async (sourceId: number) => {
    setScanningId(sourceId);
    try {
      const res = await triggerScan(sourceId);
      message.success(`扫描完成，新建 ${res?.createdCount || 0} 条`);
      fetchSources();
    } catch {
      message.error('扫描失败');
    } finally {
      setScanningId(null);
    }
  };

  const handleViewLog = async (sourceId: number) => {
    try {
      const res = await listScanLogs(sourceId, 10);
      if (res) setLogs(res);
    } catch {

      /* ignore */
    }
  };

  const loadLogItems = async (logId: number) => {
    if (logItems[logId]) return;
    try {
      const res = await listScanLogItems(logId);
      if (res) setLogItems((prev) => ({ ...prev, [logId]: res }));
    } catch {

      /* ignore */
    }
  };

  // --- 添加扫描源 ---
  const handleSaveSource = async () => {
    if (!addForm.name.trim()) {
      message.error('请填写名称');
      return;
    }
    if (!currentProject) {
      message.error('请先选择项目');
      return;
    }

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
      });
    } else {
      if (!addForm.repo.trim()) {
        message.error('请填写仓库');
        return;
      }
      if (!hasPatSaved && !addForm.pat.trim()) {
        message.error('请填写 GitHub Personal Access Token');
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
      repo: cfg.repo || 'beyonai/byclaw-test',
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
        message.success('收集源已删除');
        fetchSources();
      },
    });
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
            res.map((g: any) => ({
              value: g.openConversationId,
              label: g.name || g.openConversationId,
            }))
          );
        }
      } catch {
        setGroupOptions([]);
      } finally {
        setGroupSearching(false);
      }
    }, 500);
  };
  // --- 辅助函数 ---
  const formatConfig = (type: string, configStr: string) => {
    try {
      const cfg = JSON.parse(configStr);
      if (type === 'dingtalk') return `群: ${cfg.groupId || '-'} · 关键词: ${cfg.keyword || '需求'}`;
      if (type === 'github_issue') return `仓库: ${cfg.repo || '-'} · 标签: ${cfg.labels || '全部'}`;
      return configStr;
    } catch {
      return configStr;
    }
  };

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
          <div className={styles.formField}>
            <label>GitHub PAT {hasPatSaved && <Tag color="green">已保存</Tag>}</label>
            <Input.Password
              placeholder={hasPatSaved ? '已保存，留空使用已有 PAT' : '输入 Personal Access Token'}
              value={addForm.pat}
              onChange={(e) => setAddForm({ ...addForm, pat: e.target.value })}
            />
          </div>
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

  // ========== 项目列表视图 ==========
  if (view === 'list') {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h2>需求收集</h2>
            <p className={styles.subtitle}>选择一个项目，管理其需求收集源。</p>
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
            <Empty description="暂无项目，请先创建一个项目">
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
                      <EditOutlined key="edit" onClick={(e) => handleEditProject(item, e)} />,
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
      <div className={styles.header}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => setView('list')} />
          <div>
            <h2 style={{ margin: 0 }}>{currentProject?.projectName}</h2>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {currentProject?.description || '管理该项目的需求收集源'}
            </Text>
          </div>
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingSource(null);
            setAddForm({
              type: 'dingtalk',
              name: '',
              chatId: '',
              keywords: '',
              lookbackHours: '24',
              repo: 'beyonai/byclaw-test',
              labels: '',
              pat: '',
              cron: '*/30 * * * *',
            });
            setShowAddSourceModal(true);
          }}
        >
          添加收集源
        </Button>
      </div>

      <Spin spinning={sourcesLoading}>
        {sources.length === 0 ? (
          <Empty description="暂无收集源，点击右上角添加" />
        ) : (
          <div className={styles.sourceList}>
            {sources.map((source) => (
              <Card key={source.sourceId} size="small" className={styles.sourceCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardIcon}>{sourceIcon[source.sourceType]}</span>
                  <span className={styles.cardName}>{source.sourceName}</span>
                  <Switch
                    size="small"
                    checked={source.enabled === '1'}
                    onChange={(v) => handleToggle(source.sourceId, v)}
                  />
                </div>
                <div className={styles.cardConfig}>{formatConfig(source.sourceType, source.config)}</div>
                <div className={styles.cardMeta}>
                  <Tag icon={<ClockCircleOutlined />} bordered={false}>
                    {source.cronExpr || '手动'}
                  </Tag>
                  {source.lastScanTime && (
                    <span className={styles.lastScan}>上次: {dayjs(source.lastScanTime).format('MM-DD HH:mm')}</span>
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
                  <Button type="link" size="small" onClick={() => handleViewLog(source.sourceId)}>
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

      {logs.length > 0 && (
        <div className={styles.logSection}>
          <h4>扫描日志</h4>
          <Timeline
            items={logs.map((log) => ({
              color: log.status === 'success' ? (log.createdCount > 0 ? 'green' : 'gray') : 'red',
              children: (
                <div className={styles.logItem} onClick={() => loadLogItems(log.logId)}>
                  <div className={styles.logHeader}>
                    <span className={styles.logTime}>{dayjs(log.scanTime).format('MM-DD HH:mm')}</span>
                    <Tag bordered={false}>
                      发现 {log.foundCount} · 新建 {log.createdCount}
                    </Tag>
                    {log.status === 'failed' && <Tag color="red">失败</Tag>}
                  </div>
                  {logItems[log.logId] && (
                    <div className={styles.logDetails}>
                      {logItems[log.logId].map((item) => (
                        <div key={item.itemId} className={styles.logDetailLine}>
                          <Tag color={actionTag[item.action]?.color || 'default'} bordered={false}>
                            {actionTag[item.action]?.label || item.action}
                          </Tag>
                          {item.originUrl ? (
                            <a href={item.originUrl} target="_blank" rel="noreferrer">
                              {item.title}
                            </a>
                          ) : (
                            <span>{item.title}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ),
            }))}
          />
        </div>
      )}

      {renderAddSourceModal()}
      {renderProjectModal()}
    </div>
  );
};

export default NeedCollect;
