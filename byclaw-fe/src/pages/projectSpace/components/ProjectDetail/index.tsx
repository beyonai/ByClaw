import { Button, Dropdown, Input, Segmented, Spin, Tag, Typography, message } from 'antd';
import { MoreOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import {
  OperationTaskFormModal,
  type OperationSelectOption,
  type OperationTaskFormValues,
} from '@/layout/sider/components/ProjectSpaceList/operation';
import { createOperationRequirement, listProjectMembers } from '@/service/devloop';
import { PROJECT_DETAIL_SECTIONS, PROJECT_TYPE_MESSAGE_ID, type ProjectDetailSection } from '../../constants';
import { useProjectSessions } from '../../hooks/useProjectSessions';
import { useProjectTypeConfig } from '../../hooks/useProjectTypeConfig';
import type { ProjectSession, ProjectSpace } from '../../types';
import { getArrayData } from '../../utils';
import ProjectAccounts from '../ProjectAccounts';
import ManualRequirementModal from '../ManualRequirementModal';
import ProjectMembers from '../ProjectMembers';
import ProjectRequirements from '../ProjectRequirements';
import ProjectResources from '../ProjectResources';
import ProjectSessionList from '../ProjectSessionList';
import ProjectTasks from '../ProjectTasks';
import ProjectDefaultAgentPanel from '../ProjectDefaultAgentPanel';
import Integration from '@/layout/sider/components/ProjectSpaceList/Integration';
import styles from '../../index.module.less';

interface Props {
  project?: ProjectSpace;
  loading?: boolean;
  onRefresh?: () => void;
  onOpenSession?: (session: ProjectSession) => void;
  onNewSession?: () => void;
  onEditProject?: (project: ProjectSpace) => void;
  onDeleteProject?: (project: ProjectSpace) => void;
}

// 项目主菜单使用独立详情页；会话侧栏仍由 ProjectDetailModal 维护，两者不共享详情布局和状态。
const ProjectDetail: React.FC<Props> = ({
  project,
  loading,
  onRefresh,
  onOpenSession,
  onNewSession,
  onEditProject,
  onDeleteProject,
}) => {
  const intl = useIntl();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const [activeSection, setActiveSection] = useState<ProjectDetailSection>('sessions');
  const [keyword, setKeyword] = useState('');
  const [operationRequirementModalOpen, setOperationRequirementModalOpen] = useState(false);
  const [operationRequirementSaving, setOperationRequirementSaving] = useState(false);
  const [operationAssignees, setOperationAssignees] = useState<OperationSelectOption[]>([]);
  const [operationAssigneesLoading, setOperationAssigneesLoading] = useState(false);
  const [requirementsRefreshVersion, setRequirementsRefreshVersion] = useState(0);
  const [manualRequirementModalOpen, setManualRequirementModalOpen] = useState(false);
  const [accountToolbar, setAccountToolbar] = useState<React.ReactNode>(null);
  // 各详情 Tab 自己提供刷新按钮，统一挂到详情页右上角，避免内容区重复放置工具栏。
  const [sectionToolbar, setSectionToolbar] = useState<React.ReactNode>(null);
  const taskFallbackProjectRef = useRef<string | null>(null);
  const { sessions, total } = useProjectSessions(project);
  const { isDevelopProjectEnabled, isOperationProjectEnabled } = useProjectTypeConfig();
  // 研发和运营能力均以静态参数为准，避免未启用环境误展示对应的业务分区。
  const isDevelopProject = isDevelopProjectEnabled && project?.projectType === 'develop';
  const isOperationProject = isOperationProjectEnabled && project?.projectType === 'operation';
  const currentUserId = userInfo.userId ?? userInfo.id;
  const defaultRequirementAssignee = operationAssignees.find(
    (option) => currentUserId !== undefined && `${option.value}` === `${currentUserId}`
  )?.value;
  // 运营项目和研发项目都需要需求入口；普通共享项目仍可查看成员但不显示需求管理。
  const showRequirementsSection = isDevelopProject || isOperationProject;
  const showMembersSection = isDevelopProject || isOperationProject || !!project?.sharedFlag;
  const showSessionsSection = !isOperationProject && !isDevelopProject;
  const detailSections = useMemo(
    () =>
      PROJECT_DETAIL_SECTIONS.filter((item) => {
        if (item.key === 'accounts') return isOperationProject;
        if (item.key === 'digitalAgents' || item.key === 'integration') return isDevelopProject;
        if (item.key === 'sessions') return showSessionsSection;
        if (item.key === 'members') return showMembersSection;
        if (item.key === 'requirements') return showRequirementsSection;
        return true;
      }).sort((left, right) => {
        const order = isDevelopProject
          ? ['requirements', 'tasks', 'resources', 'digitalAgents', 'members', 'integration']
          : isOperationProject
          ? ['accounts', 'requirements', 'tasks', 'resources', 'members']
          : ['sessions', 'tasks', 'resources', 'members'];
        return order.indexOf(left.key) - order.indexOf(right.key);
      }),
    [isDevelopProject, isOperationProject, showMembersSection, showRequirementsSection, showSessionsSection]
  );

  useEffect(() => {
    // 仅在真正切换项目时初始化 Tab；能力配置异步完成或刷新项目详情时不应覆盖用户当前 Tab。
    setActiveSection('tasks');
    taskFallbackProjectRef.current = null;
    setKeyword('');
    setOperationRequirementModalOpen(false);
    setAccountToolbar(null);
    setSectionToolbar(null);
  }, [project?.projectId, project?.projectType]);

  const handleTasksInitialLoad = useCallback(
    (hasTasks: boolean) => {
      const projectKey = `${project?.projectId ?? ''}`;
      if (
        hasTasks ||
        !projectKey ||
        !showRequirementsSection ||
        activeSection !== 'tasks' ||
        taskFallbackProjectRef.current === projectKey
      ) {
        return;
      }
      // 每个项目只在首次打开且任务首屏为空时自动回退一次，避免刷新空列表时反复抢占用户选择。
      taskFallbackProjectRef.current = projectKey;
      setActiveSection('requirements');
    },
    [activeSection, project?.projectId, showRequirementsSection]
  );

  useEffect(() => {
    // 切换 Tab 时先清空上一个 Tab 的工具栏，待新 Tab 挂载后重新注册。
    setSectionToolbar(null);
  }, [activeSection]);

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

  useEffect(() => {
    // 运营项目不展示会话页，其他项目隐藏成员或需求页时回退到首个可见分区。
    const currentTabHidden =
      (!showSessionsSection && activeSection === 'sessions') ||
      (!isOperationProject && activeSection === 'accounts') ||
      (!isDevelopProject && (activeSection === 'digitalAgents' || activeSection === 'integration')) ||
      (!showMembersSection && activeSection === 'members') ||
      (!showRequirementsSection && activeSection === 'requirements');
    if (currentTabHidden) {
      // 运营项目按“账号、需求、任务、资源、成员”展示，并默认进入账号管理。
      setActiveSection(isDevelopProject ? 'requirements' : isOperationProject ? 'accounts' : 'sessions');
    }
  }, [
    activeSection,
    isDevelopProject,
    isOperationProject,
    showMembersSection,
    showRequirementsSection,
    showSessionsSection,
  ]);

  if (!project) {
    return <div className={styles.detailEmpty}>{intl.formatMessage({ id: 'projectSpace.selectProject' })}</div>;
  }

  const renderSessionList = () => (
    <ProjectSessionList
      projectId={project.projectId}
      sessions={sessions}
      loading={loading}
      keyword={keyword}
      onRefresh={onRefresh}
      onOpenSession={onOpenSession}
    />
  );

  const renderContent = () => {
    if (activeSection === 'accounts') {
      return isOperationProject ? (
        <ProjectAccounts project={project} keyword={keyword} onToolbarChange={setAccountToolbar} />
      ) : (
        renderSessionList()
      );
    }
    if (activeSection === 'sessions') {
      return renderSessionList();
    }
    if (activeSection === 'tasks') {
      return (
        <ProjectTasks
          project={project}
          keyword={keyword}
          onOpenSession={onOpenSession}
          onToolbarChange={setSectionToolbar}
          onInitialLoad={handleTasksInitialLoad}
        />
      );
    }
    if (activeSection === 'resources') return <ProjectResources project={project} />;
    if (activeSection === 'digitalAgents') {
      return isDevelopProject ? (
        <ProjectDefaultAgentPanel projectId={Number(project.projectId)} active />
      ) : (
        renderSessionList()
      );
    }
    if (activeSection === 'integration') {
      return isDevelopProject ? (
        <Integration
          active
          projectId={Number(project.projectId)}
          repos={(project.repos || [])
            .filter((repo) => repo.repoId !== undefined && repo.repoId !== null)
            .map((repo) => ({
              repoId: Number(repo.repoId),
              repoFullName: repo.repoFullName,
              repoUrl: repo.repoUrl,
              defaultBranch: repo.defaultBranch,
            }))}
        />
      ) : (
        renderSessionList()
      );
    }
    if (activeSection === 'members') {
      return showMembersSection ? (
        <ProjectMembers project={project} keyword={keyword} onToolbarChange={setSectionToolbar} />
      ) : (
        renderSessionList()
      );
    }
    return showRequirementsSection ? (
      <ProjectRequirements
        key={requirementsRefreshVersion}
        project={project}
        keyword={keyword}
        onToolbarChange={setSectionToolbar}
        onStarted={() => setActiveSection('tasks')}
      />
    ) : (
      renderSessionList()
    );
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
      setActiveSection('requirements');
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
            <Typography.Title level={3} ellipsis={{ tooltip: project.projectName }}>
              {project.projectName}
            </Typography.Title>
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
                {/* 更多按钮只在名称区域悬停时显示，项目操作统一收口到菜单中。 */}
                <Button
                  type="text"
                  className={styles.detailProjectMoreButton}
                  icon={<MoreOutlined />}
                  aria-label={intl.formatMessage({ id: 'common.more' })}
                />
              </Dropdown>
            )}
          </div>
          <Tag
            color={project.projectType === 'develop' ? 'purple' : project.projectType === 'operation' ? 'cyan' : 'blue'}
          >
            {intl.formatMessage({ id: PROJECT_TYPE_MESSAGE_ID[project.projectType] })}
          </Tag>
          <Typography.Text type="secondary">
            {project.description || intl.formatMessage({ id: 'projectSpace.projectCard.emptyDescription' })}
            {showSessionsSection && (
              <>
                {' · '}
                {intl.formatMessage({ id: 'projectSpace.projectCard.sessionCount' }, { count: total })}
              </>
            )}
          </Typography.Text>
        </div>
        <div className={styles.detailHeaderActions}>
          <Input
            allowClear
            value={keyword}
            prefix={<SearchOutlined />}
            placeholder={intl.formatMessage({ id: 'projectSpace.searchPlaceholder' })}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {activeSection === 'accounts' ? accountToolbar : sectionToolbar}
          {/* 运营项目的新增需求入口固定放在详情页顶部，切换其它 tab 时仍保持可用。 */}
          {isOperationProject && (
            <Button icon={<PlusOutlined />} onClick={() => setOperationRequirementModalOpen(true)}>
              {intl.formatMessage({ id: 'projectSpace.operation.requirement.new' })}
            </Button>
          )}
          {isDevelopProject && activeSection === 'requirements' && (
            <Button icon={<PlusOutlined />} onClick={() => setManualRequirementModalOpen(true)}>
              {intl.formatMessage({ id: 'projectSpace.manualRequirement.button' })}
            </Button>
          )}
          {onNewSession && (
            <Button type="primary" icon={<PlusOutlined />} onClick={onNewSession}>
              {intl.formatMessage({ id: 'projectSpace.newChatName' })}
            </Button>
          )}
        </div>
      </div>
      <div className={styles.detailTabs}>
        <Segmented
          value={activeSection}
          options={detailSections.map((item) => ({
            label: intl.formatMessage({ id: item.labelId }),
            value: item.key,
          }))}
          onChange={(value) => setActiveSection(value as ProjectDetailSection)}
        />
      </div>
      <div className={styles.detailBody}>
        <Spin spinning={!!loading}>{renderContent()}</Spin>
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
      <ManualRequirementModal
        project={project}
        open={manualRequirementModalOpen}
        onCancel={() => setManualRequirementModalOpen(false)}
        onCreated={() => {
          setManualRequirementModalOpen(false);
          setRequirementsRefreshVersion((current) => current + 1);
        }}
      />
    </section>
  );
};

export default ProjectDetail;
