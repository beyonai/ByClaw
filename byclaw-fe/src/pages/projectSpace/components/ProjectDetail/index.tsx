import { Alert, Button, Dropdown, Input, Modal, Segmented, Tag, Typography, message } from 'antd';
import {
  ArrowLeftOutlined,
  LoadingOutlined,
  EllipsisOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import {
  OperationTaskFormModal,
  type OperationSelectOption,
  type OperationTaskFormValues,
} from '@/layout/sider/components/ProjectSpaceList/operation';
import {
  createOperationRequirement,
  listProjectMembers,
  INIT_POLL_INTERVAL_MS,
  INIT_POLL_MAX_ROUNDS,
} from '@/service/devloop';
import { PROJECT_DETAIL_SECTIONS, type ProjectDetailSection } from '../../constants';
import { useProjectTypeConfig } from '../../hooks/useProjectTypeConfig';
import { checkGitHubPat, saveGitHubPat, type DevloopProjectRepo } from '@/service/devloop';
import type { ProjectSession, ProjectSpace } from '../../types';
import { getArrayData } from '../../utils';
import ProjectAccounts from '../ProjectAccounts';
import ProjectMembers from '../ProjectMembers';
import ProjectRequirements from '../ProjectRequirements';
import ProjectResources from '../ProjectResources';
import ProjectTasks from '../ProjectTasks';
import ProjectDefaultAgentPanel, { type ChatWithAgentTarget } from '../ProjectDefaultAgentPanel';
import Integration from '@/layout/sider/components/ProjectSpaceList/Integration';
import ProjectRepositoryManager from '../ProjectRepositoryManager';
import styles from '../../index.module.less';

interface Props {
  project?: ProjectSpace;
  onBack: () => void;
  onRefresh?: () => void;
  onOpenSession?: (session: ProjectSession) => void;
  // 员工信息可选:工具栏按钮不带,数字员工卡的「去聊天」带上它以预置 @ 该员工。
  // 带的是整个 target 而非只有 agentId —— 输入框查不到这些员工,名字/头像/类型得一路透传。
  onNewSession?: (target?: ChatWithAgentTarget) => void;
  onEditProject?: (project: ProjectSpace) => void;
  onDeleteProject?: (project: ProjectSpace) => void;
}

// 项目主菜单使用独立详情页；会话侧栏仍由 ProjectDetailModal 维护，两者不共享详情布局和状态。
const ProjectDetail: React.FC<Props> = ({
  project,
  onBack,
  onRefresh,
  onOpenSession,
  onNewSession,
  onEditProject,
  onDeleteProject,
}) => {
  const intl = useIntl();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const [activeSection, setActiveSection] = useState<ProjectDetailSection>('tasks');
  // 搜索条件跟随各自 Tab 缓存，避免在当前 Tab 搜索时触发其它已挂载 Tab 的接口请求。
  const [sectionKeywordMap, setSectionKeywordMap] = useState<Partial<Record<ProjectDetailSection, string>>>({});
  const [operationRequirementModalOpen, setOperationRequirementModalOpen] = useState(false);
  const [operationRequirementSaving, setOperationRequirementSaving] = useState(false);
  const [operationAssignees, setOperationAssignees] = useState<OperationSelectOption[]>([]);
  const [operationAssigneesLoading, setOperationAssigneesLoading] = useState(false);
  const [requirementsRefreshVersion, setRequirementsRefreshVersion] = useState(0);
  // 已访问 Tab 保持挂载以缓存列表数据；切换项目时只保留默认任务 Tab，避免复用上一个项目的数据。
  const [sectionCache, setSectionCache] = useState<{ projectId: string; sections: ProjectDetailSection[] }>({
    projectId: '',
    sections: ['tasks'],
  });
  // 各 Tab 常驻后工具栏也要按 Tab 分开缓存，否则隐藏 Tab 的 effect 会覆盖当前 Tab 的按钮。
  const [sectionToolbarMap, setSectionToolbarMap] = useState<Partial<Record<ProjectDetailSection, React.ReactNode>>>(
    {}
  );
  const [sectionRefreshToolbarMap, setSectionRefreshToolbarMap] = useState<
    Partial<Record<ProjectDetailSection, React.ReactNode>>
  >({});
  const [repositoryManagerOpen, setRepositoryManagerOpen] = useState(false);
  const [editingRepository, setEditingRepository] = useState<DevloopProjectRepo>();
  const [repositoryRefreshVersion, setRepositoryRefreshVersion] = useState(0);
  const [githubPatOpen, setGithubPatOpen] = useState(false);
  const [githubPat, setGithubPat] = useState('');
  const [githubPatSaved, setGithubPatSaved] = useState(true);
  const [githubPatLoading, setGithubPatLoading] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isDevelopProjectEnabled, isOperationProjectEnabled } = useProjectTypeConfig();
  // 研发和运营能力均以静态参数为准，避免未启用环境误展示对应的业务分区。
  const isDevelopProject = isDevelopProjectEnabled && project?.projectType === 'develop';
  const isOperationProject = isOperationProjectEnabled && project?.projectType === 'operation';
  const currentUserId = userInfo.userId ?? userInfo.id;
  const handleRefreshProject = useCallback(() => {
    // 顶部刷新按钮做轻量防抖，避免连续点击造成详情接口并发请求和旧数据覆盖新数据。
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
    }, 500);
    void onRefresh?.();
  }, [onRefresh]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    []
  );
  const defaultRequirementAssignee = operationAssignees.find(
    (option) => currentUserId !== undefined && `${option.value}` === `${currentUserId}`
  )?.value;
  // 运营项目和研发项目保留业务扩展页；默认、普通项目固定只展示任务和资源。
  // 研发需求入口已迁到应用级「自动化」页；运营需求仍以本页需求页签为宿主，故只对运营项目保留。
  const showRequirementsSection = isOperationProject;
  const showMembersSection = isDevelopProject || isOperationProject;
  const projectCacheKey = `${project?.projectId ?? ''}`;
  const visitedSections =
    sectionCache.projectId === projectCacheKey ? sectionCache.sections : (['tasks'] as ProjectDetailSection[]);

  const updateSectionToolbar = useCallback((section: ProjectDetailSection, toolbar: React.ReactNode) => {
    setSectionToolbarMap((current) => (current[section] === toolbar ? current : { ...current, [section]: toolbar }));
  }, []);

  const updateSectionRefreshToolbar = useCallback((section: ProjectDetailSection, toolbar: React.ReactNode) => {
    setSectionRefreshToolbarMap((current) =>
      current[section] === toolbar ? current : { ...current, [section]: toolbar }
    );
  }, []);

  const toolbarHandlers = useMemo(
    () => ({
      accounts: (toolbar: React.ReactNode) => updateSectionToolbar('accounts', toolbar),
      tasks: (toolbar: React.ReactNode) => updateSectionToolbar('tasks', toolbar),
      members: (toolbar: React.ReactNode) => updateSectionToolbar('members', toolbar),
    }),
    [updateSectionToolbar]
  );

  const refreshToolbarHandlers = useMemo(
    () => ({
      accounts: (toolbar: React.ReactNode) => updateSectionRefreshToolbar('accounts', toolbar),
      requirements: (toolbar: React.ReactNode) => updateSectionRefreshToolbar('requirements', toolbar),
      tasks: (toolbar: React.ReactNode) => updateSectionRefreshToolbar('tasks', toolbar),
      resources: (toolbar: React.ReactNode) => updateSectionRefreshToolbar('resources', toolbar),
      members: (toolbar: React.ReactNode) => updateSectionRefreshToolbar('members', toolbar),
    }),
    [updateSectionRefreshToolbar]
  );

  const activateSection = useCallback(
    (section: ProjectDetailSection) => {
      // 首次访问才加入挂载集合；再次切换只显示缓存组件，不重新触发首屏接口。
      setSectionCache((current) => {
        const sections = current.projectId === projectCacheKey ? current.sections : [];
        if (sections.includes(section))
          return current.projectId === projectCacheKey ? current : { projectId: projectCacheKey, sections };
        return { projectId: projectCacheKey, sections: [...sections, section] };
      });
      setActiveSection(section);
    },
    [projectCacheKey]
  );

  useEffect(() => {
    if (!isDevelopProject) {
      setGithubPatSaved(true);
      return;
    }
    let active = true;
    void checkGitHubPat()
      .then((response: any) => {
        if (active) setGithubPatSaved(Boolean(response?.hasPat ?? response?.data?.hasPat));
      })
      .catch(() => {
        if (active) setGithubPatSaved(false);
      });
    return () => {
      active = false;
    };
  }, [isDevelopProject, project?.projectId]);
  const detailSections = useMemo(
    () =>
      PROJECT_DETAIL_SECTIONS.filter((item) => {
        if (item.key === 'accounts') return isOperationProject;
        if (item.key === 'digitalAgents' || item.key === 'integration') return isDevelopProject;
        if (item.key === 'sessions') return false;
        if (item.key === 'members') return showMembersSection;
        if (item.key === 'requirements') return showRequirementsSection;
        return true;
      }).sort((left, right) => {
        const order = isDevelopProject
          ? ['tasks', 'resources', 'digitalAgents', 'members', 'integration']
          : isOperationProject
            ? ['accounts', 'requirements', 'tasks', 'resources', 'members']
            : ['tasks', 'resources'];
        return order.indexOf(left.key) - order.indexOf(right.key);
      }),
    [isDevelopProject, isOperationProject, showMembersSection, showRequirementsSection]
  );

  useEffect(() => {
    // 仅在真正切换项目时初始化 Tab；能力配置异步完成或刷新项目详情时不应覆盖用户当前 Tab。
    setActiveSection('tasks');
    setSectionCache({ projectId: projectCacheKey, sections: ['tasks'] });
    setSectionKeywordMap({});
    setOperationRequirementModalOpen(false);
    setSectionToolbarMap({});
    setSectionRefreshToolbarMap({});
  }, [project?.projectId, project?.projectType, projectCacheKey]);

  useEffect(() => {
    if (!operationRequirementModalOpen || !isOperationProject || !project?.projectId) return;
    let active = true;
    setOperationAssigneesLoading(true);
    void listProjectMembers(Number(project.projectId))
      .then((response) => {
        if (!active) return;
        setOperationAssignees(
          getArrayData(response).map((member) => ({
            value: member.userId ?? member.memberId,
            label: member.userName || member.userCode || `${member.userId ?? member.memberId}`,
          }))
        );
      })
      .catch(() => {
        if (active) setOperationAssignees([]);
      })
      .finally(() => {
        if (active) setOperationAssigneesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOperationProject, operationRequirementModalOpen, project?.projectId]);

  // 初始化中轮询详情:架构数字员工在沙箱里干活,完成信号由后端定时任务读任务状态文件后落库。
  // 不轮询的话横幅要等用户手动刷新才消失,建需求/启动任务也一直是禁用态。到 ready 或回退 pending 即停。
  // 封顶后停轮询:后端收不了口时(状态文件读失败等)状态会长期停在进行中,没有上限就是无限刷 /project/get。
  // 员工在聊那段状态一直是 initialized(只多一个会话ID),只判 initializing 会漏掉它,等不到 ready。
  const architectChatting = project?.initStatus === 'initialized' && Number(project?.initSessionId || 0) > 0;
  useEffect(() => {
    if (!isDevelopProject || !onRefresh) return;
    if (project?.initStatus !== 'initializing' && !architectChatting) return;
    let rounds = 0;
    const timer = setInterval(() => {
      rounds += 1;
      if (rounds > INIT_POLL_MAX_ROUNDS) {
        clearInterval(timer);
        return;
      }
      onRefresh();
    }, INIT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isDevelopProject, project?.initStatus, architectChatting, onRefresh]);

  useEffect(() => {
    // 项目类型切换后若当前 Tab 不可见，则回退到该类型的首个业务分区。
    const currentTabHidden =
      activeSection === 'sessions' ||
      (!isOperationProject && activeSection === 'accounts') ||
      (!isDevelopProject && (activeSection === 'digitalAgents' || activeSection === 'integration')) ||
      (!showMembersSection && activeSection === 'members') ||
      (!showRequirementsSection && activeSection === 'requirements');
    if (currentTabHidden) {
      // 运营项目按“账号、需求、任务、资源、成员”展示，并默认进入账号管理。
      activateSection(isDevelopProject ? 'requirements' : isOperationProject ? 'accounts' : 'tasks');
    }
  }, [
    activateSection,
    activeSection,
    isDevelopProject,
    isOperationProject,
    showMembersSection,
    showRequirementsSection,
  ]);

  if (!project) {
    return <div className={styles.detailEmpty}>{intl.formatMessage({ id: 'projectSpace.selectProject' })}</div>;
  }

  // 大详情项目标签与左侧小列表使用同一套分类和短文案，普通项目继续区分个人、共享。
  const projectTagMeta = (() => {
    if (project.projectType === 'default') {
      return { className: styles.detailProjectTagDefault, messageId: 'projectSpace.scene.default' };
    }
    if (project.projectType === 'develop') {
      return { className: styles.detailProjectTagDevelopment, messageId: 'projectSpace.scene.development' };
    }
    if (project.projectType === 'operation') {
      return { className: styles.detailProjectTagOperation, messageId: 'projectSpace.scene.operation' };
    }
    if (project.sharedFlag) {
      return { className: styles.detailProjectTagShared, messageId: 'projectSpace.scene.shared' };
    }
    return { className: styles.detailProjectTagPersonal, messageId: 'projectSpace.scene.personal' };
  })();

  const renderSectionContent = (section: ProjectDetailSection) => {
    const sectionKeyword = sectionKeywordMap[section] || '';
    if (section === 'accounts') {
      return isOperationProject ? (
        <ProjectAccounts
          project={project}
          keyword={sectionKeyword}
          onToolbarChange={toolbarHandlers.accounts}
          onRefreshToolbarChange={refreshToolbarHandlers.accounts}
        />
      ) : null;
    }
    if (section === 'sessions') {
      return null;
    }
    if (section === 'tasks') {
      return (
        <ProjectTasks
          project={project}
          keyword={sectionKeyword}
          onOpenSession={onOpenSession}
          onToolbarChange={toolbarHandlers.tasks}
          onRefreshToolbarChange={refreshToolbarHandlers.tasks}
        />
      );
    }
    if (section === 'resources') {
      return (
        <ProjectResources
          project={project}
          onRefreshToolbarChange={refreshToolbarHandlers.resources}
          repositoryRefreshVersion={repositoryRefreshVersion}
          onProjectInitStarted={onRefresh}
          onOpenRepositoryManager={(repo) => {
            setEditingRepository(repo);
            setRepositoryManagerOpen(true);
          }}
        />
      );
    }
    if (section === 'digitalAgents') {
      return isDevelopProject ? (
        <ProjectDefaultAgentPanel
          projectId={Number(project.projectId)}
          active
          onChatWithAgent={onNewSession ? (target) => onNewSession(target) : undefined}
        />
      ) : null;
    }
    if (section === 'integration') {
      return isDevelopProject ? (
        <Integration active projectId={Number(project.projectId)} embedded onOpenSession={onOpenSession} />
      ) : null;
    }
    if (section === 'members') {
      return showMembersSection ? (
        <ProjectMembers
          project={project}
          keyword={sectionKeyword}
          onToolbarChange={toolbarHandlers.members}
          onRefreshToolbarChange={refreshToolbarHandlers.members}
        />
      ) : null;
    }
    return showRequirementsSection ? (
      <ProjectRequirements
        key={requirementsRefreshVersion}
        project={project}
        keyword={sectionKeyword}
        onRefreshToolbarChange={refreshToolbarHandlers.requirements}
        onStarted={() => activateSection('tasks')}
      />
    ) : null;
  };

  const handleCreateOperationRequirement = async (values: OperationTaskFormValues) => {
    if (!isOperationProject || operationRequirementSaving) return;
    setOperationRequirementSaving(true);
    try {
      const collectConfig = values.collectConfig
        ? {
          ...values.collectConfig,
          // 表单态使用 Dayjs，接口保存字符串；生效区间拆成后端校验使用的两个字段。
          onceTime: values.collectConfig.onceTime?.isValid()
            ? values.collectConfig.onceTime.format('YYYY-MM-DD HH:mm:ss')
            : undefined,
          periodTime: values.collectConfig.periodTime?.isValid()
            ? values.collectConfig.periodTime.format('HH:mm:ss')
            : undefined,
          periodYearDateTime: values.collectConfig.periodYearDateTime?.isValid()
            ? values.collectConfig.periodYearDateTime.format('YYYY-MM-DD HH:mm:ss')
            : undefined,
          effectiveStartDate: values.collectConfig.effectiveDateRange?.[0]?.isValid()
            ? values.collectConfig.effectiveDateRange[0].format('YYYY-MM-DD')
            : undefined,
          effectiveEndDate: values.collectConfig.effectiveDateRange?.[1]?.isValid()
            ? values.collectConfig.effectiveDateRange[1].format('YYYY-MM-DD')
            : undefined,
        }
        : undefined;
      await createOperationRequirement({
        projectId: Number(project.projectId),
        requirementName: values.taskName.trim(),
        sourceDescription: values.description?.trim() || undefined,
        operationType: values.taskType === 'content' ? 'publish' : values.taskType,
        assignee: values.assigneeId,
        dueTime: values.dueTime?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
        // 周期/间隔执行的字段由表单组件完整生成，这里不能只提交需求基础信息。
        config: collectConfig,
      });
      message.success(intl.formatMessage({ id: 'projectSpace.operation.requirement.createSuccess' }));
      setOperationRequirementModalOpen(false);
      // 新增需求完成后保持在需求 Tab，避免项目详情刷新或子组件重建跳回账号 Tab。
      activateSection('requirements');
      // 创建成功后重建需求列表组件，确保从第一页读取最新数据并重置滚动状态。
      setRequirementsRefreshVersion((current) => current + 1);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.operation.requirement.createFailed' }));
    } finally {
      setOperationRequirementSaving(false);
    }
  };

  return (
    <section className={styles.detail}>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeading}>
          <div className={styles.detailTitleRow}>
            <Button type="text" className={styles.detailBackButton} icon={<ArrowLeftOutlined />} onClick={onBack}>
              {intl.formatMessage({ id: 'projectSpace.backToList' })}
            </Button>
            <Typography.Title level={3} ellipsis={{ tooltip: project.projectName }}>
              {project.projectName}
            </Typography.Title>
            <Tag bordered={false} className={`${styles.detailProjectTag} ${projectTagMeta.className}`}>
              {intl.formatMessage({ id: projectTagMeta.messageId })}
            </Tag>
            {isDevelopProject && project.initStatus && project.initStatus !== 'ready' && (
              <Tag bordered={false} icon={<LoadingOutlined spin />} className={styles.detailInitializingTag}>
                {intl.formatMessage({ id: 'projectSpace.scene.initializing' })}
              </Tag>
            )}
            {(onEditProject || onDeleteProject) && (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    ...(onEditProject
                      ? [{ key: 'edit', label: intl.formatMessage({ id: 'projectSpace.detail.common.edit' }) }]
                      : []),
                    ...(onDeleteProject
                      ? [
                        {
                          key: 'delete',
                          danger: true,
                          label: intl.formatMessage({ id: 'projectSpace.detail.common.delete' }),
                        },
                      ]
                      : []),
                  ],
                  onClick: ({ key }) => {
                    if (key === 'edit') onEditProject?.(project);
                    if (key === 'delete') onDeleteProject?.(project);
                  },
                }}
              >
                {/* 更多按钮常驻显示，项目编辑和删除操作统一收口到菜单中。 */}
                <Button
                  type="text"
                  className={styles.detailProjectMoreButton}
                  icon={<EllipsisOutlined />}
                  aria-label={intl.formatMessage({ id: 'common.more' })}
                />
              </Dropdown>
            )}
          </div>
          <Typography.Text type="secondary" className={styles.detailDescription}>
            {project.description || intl.formatMessage({ id: 'projectSpace.projectCard.emptyDescription' })}
          </Typography.Text>
        </div>
        <div className={styles.detailHeaderActions}>
          {/* 资源 Tab 由各资源分栏直接展示完整数据，不提供无实际过滤能力的顶部搜索框。 */}
          {activeSection !== 'resources' && (
            <Input
              allowClear
              value={sectionKeywordMap[activeSection] || ''}
              prefix={<SearchOutlined />}
              placeholder={intl.formatMessage({ id: 'projectSpace.searchPlaceholder' })}
              onChange={(event) => {
                const value = event.target.value;
                setSectionKeywordMap((current) => ({ ...current, [activeSection]: value }));
              }}
            />
          )}
          {/* 运营项目只在需求 tab 显示新增需求入口，切换到其它 tab 后隐藏。 */}
          {isOperationProject && activeSection === 'requirements' && (
            <Button icon={<PlusOutlined />} onClick={() => setOperationRequirementModalOpen(true)}>
              {intl.formatMessage({ id: 'projectSpace.operation.requirement.new' })}
            </Button>
          )}
          {/* 研发项目的渠道配置与新增需求已迁到应用级「自动化」页，这里不再提供入口。 */}
          {/* 新增仓库属于研发项目资源维护操作，仅在资源 Tab 展示。 */}
          {isDevelopProject && activeSection === 'resources' && (
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingRepository(undefined);
                setRepositoryManagerOpen(true);
              }}
            >
              {intl.formatMessage({ id: 'projectSpace.repository.add' })}
            </Button>
          )}
          {sectionToolbarMap[activeSection]}
          {onNewSession && (
            // 不直接把 onNewSession 当 onClick，否则鼠标事件会被误当成数字员工参数传入。
            <Button icon={<PlusOutlined />} onClick={() => onNewSession()}>
              {intl.formatMessage({ id: 'projectSpace.newChatName' })}
            </Button>
          )}
          {/* 各 Tab 的顺序为业务操作、新建会话、刷新；账号 Tab 由账号筛选和新增账号组成业务操作。 */}
          {sectionRefreshToolbarMap[activeSection] || (
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRefreshProject}>
              {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
            </Button>
          )}
        </div>
      </div>
      {isDevelopProject && project.initStatus && project.initStatus !== 'ready' && (
        <Alert
          type="info"
          showIcon
          className={styles.projectInitAlert}
          // 带失败原因时优先回显原因:否则用户只看到「尚未初始化」,不知道是超时回退还是从未发起。
          // initialized 分两种:有会话=架构员工在聊,没会话=等用户去点「去跟架构聊天」。
          // 发起入口都在项目详情弹窗,这里只做状态回显。
          message={
            project.initStatus === 'initializing'
              ? intl.formatMessage({ id: 'projectSpace.detail.initGuard.bannerInitializing' })
              : architectChatting
                ? intl.formatMessage({ id: 'projectSpace.detail.initGuard.banner' })
                : project.initFailReason ||
                intl.formatMessage({
                  id:
                    project.initStatus === 'initialized'
                      ? 'projectSpace.detail.initGuard.bannerInitialized'
                      : 'projectSpace.detail.initGuard.bannerPending',
                })
          }
        />
      )}
      {isDevelopProject && !githubPatSaved && (
        <Alert
          type="warning"
          showIcon
          className={styles.projectInitAlert}
          message={
            <Button type="link" size="small" onClick={() => setGithubPatOpen(true)}>
              {intl.formatMessage({ id: 'projectSpace.github.notConfigured' })}
            </Button>
          }
        />
      )}
      <div className={styles.detailTabs}>
        <Segmented
          value={activeSection}
          options={detailSections.map((item) => ({
            label: intl.formatMessage({ id: item.labelId }),
            value: item.key,
          }))}
          onChange={(value) => activateSection(value as ProjectDetailSection)}
        />
      </div>
      <div className={styles.detailBody}>
        <div className={styles.detailBodyContent}>
          {detailSections
            .filter((section) => visitedSections.includes(section.key))
            .map((section) => (
              <div
                key={section.key}
                // display: contents 不增加额外布局层，隐藏时仍保留子组件状态和已请求的数据。
                style={{ display: activeSection === section.key ? 'contents' : 'none' }}
              >
                {renderSectionContent(section.key)}
              </div>
            ))}
        </div>
      </div>
      <OperationTaskFormModal
        open={operationRequirementModalOpen}
        entityLabel="requirement"
        simpleRequirement
        initialValues={{
          assigneeId: defaultRequirementAssignee,
          dueTime: dayjs().add(7, 'day'),
        }}
        options={{ assignees: operationAssignees }}
        loading={operationRequirementSaving}
        optionLoading={operationAssigneesLoading}
        onCancel={() => setOperationRequirementModalOpen(false)}
        onSubmit={handleCreateOperationRequirement}
      />
      {isDevelopProject && (
        <ProjectRepositoryManager
          project={project}
          open={repositoryManagerOpen}
          editingRepo={editingRepository}
          onClose={() => {
            setRepositoryManagerOpen(false);
            setEditingRepository(undefined);
          }}
          onChanged={() => {
            setRepositoryRefreshVersion((current) => current + 1);
            void onRefresh?.();
          }}
        />
      )}
      <Modal
        open={githubPatOpen}
        title={intl.formatMessage({ id: 'projectSpace.github.configure' })}
        okText={intl.formatMessage({ id: 'common.save' })}
        confirmLoading={githubPatLoading}
        onCancel={() => setGithubPatOpen(false)}
        onOk={async () => {
          if (!githubPat.trim() || githubPatLoading) return;
          setGithubPatLoading(true);
          try {
            await saveGitHubPat(githubPat.trim());
            message.success(intl.formatMessage({ id: 'projectSpace.github.saveSuccess' }));
            setGithubPatSaved(true);
            setGithubPat('');
            setGithubPatOpen(false);
          } catch (error: any) {
            message.error(error?.message || intl.formatMessage({ id: 'projectSpace.github.saveFailed' }));
          } finally {
            setGithubPatLoading(false);
          }
        }}
      >
        <Input.Password
          value={githubPat}
          placeholder={intl.formatMessage({ id: 'projectSpace.github.placeholder' })}
          onChange={(event) => setGithubPat(event.target.value)}
        />
      </Modal>
    </section>
  );
};

export default ProjectDetail;
