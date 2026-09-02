import { Button, Dropdown, Typography, message } from 'antd';
import { EllipsisOutlined, FullscreenExitOutlined, FullscreenOutlined, PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import {
  OperationTaskFormModal,
  type OperationSelectOption,
  type OperationTaskFormValues,
} from '@/layout/sider/components/ProjectSpaceList/operation';
import { createOperationRequirement, listProjectMembers } from '@/service/devloop';
import type { ProjectDetailSection } from '../../constants';
import { type DevloopProjectRepo } from '@/service/devloop';
import type { ProjectSession, ProjectSpace } from '../../types';
import { getArrayData } from '../../utils';
import { supportsProjectRepositories } from '../../projectCapabilities';
import ProjectAccounts from '../ProjectAccounts';
import ProjectMembers from '../ProjectMembers';
import ProjectRequirements from '../ProjectRequirements';
import ProjectResources from '../ProjectResources';
import ProjectTasks from '../ProjectTasks';
import { type ChatWithAgentTarget } from '../ProjectDefaultAgentPanel';
import ProjectRepositoryManager from '../ProjectRepositoryManager';
import AutomationEditor from '@/pages/automation/components/AutomationEditor';
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
  const [operationRequirementModalOpen, setOperationRequirementModalOpen] = useState(false);
  const [operationRequirementSaving, setOperationRequirementSaving] = useState(false);
  const [operationAssignees, setOperationAssignees] = useState<OperationSelectOption[]>([]);
  const [operationAssigneesLoading, setOperationAssigneesLoading] = useState(false);
  const [requirementsRefreshVersion, setRequirementsRefreshVersion] = useState(0);
  // 已访问 Tab 保持挂载以缓存列表数据；切换项目时只保留默认任务 Tab，避免复用上一个项目的数据。
  // 各 Tab 常驻后工具栏也要按 Tab 分开缓存，否则隐藏 Tab 的 effect 会覆盖当前 Tab 的按钮。
  const [sectionToolbarMap, setSectionToolbarMap] = useState<Partial<Record<ProjectDetailSection, React.ReactNode>>>(
    {}
  );
  const [, setSectionRefreshToolbarMap] = useState<Partial<Record<ProjectDetailSection, React.ReactNode>>>({});
  const [repositoryManagerOpen, setRepositoryManagerOpen] = useState(false);
  const [editingRepository, setEditingRepository] = useState<DevloopProjectRepo>();
  const [repositoryRefreshVersion, setRepositoryRefreshVersion] = useState(0);
  const [membersExpanded, setMembersExpanded] = useState(false);
  const [scheduleTaskCreating, setScheduleTaskCreating] = useState(false);
  const [editingScheduleTask, setEditingScheduleTask] = useState<any>();
  const [scheduleRefreshVersion, setScheduleRefreshVersion] = useState(0);
  const [resourceReferenceHandler, setResourceReferenceHandler] = useState<(resource: any) => void>(
    () => () => undefined
  );
  const isOperationProject = project?.projectType === 'operation';
  const repositoryProject = supportsProjectRepositories(project?.projectType);
  const currentUserId = userInfo.userId ?? userInfo.id;
  const defaultRequirementAssignee = operationAssignees.find(
    (option) => currentUserId !== undefined && `${option.value}` === `${currentUserId}`
  )?.value;
  // 研发需求入口已迁到应用级「自动化」页，运营项目大详情也不再展示需求页签。
  const showRequirementsSection = false;
  // 默认项目(-1)没有独立成员，右侧不展示项目成员模块。
  const showMembersSection = Number(project?.projectId) !== -1;

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

  useEffect(() => {
    // 仅在真正切换项目时初始化 Tab；能力配置异步完成或刷新项目详情时不应覆盖用户当前 Tab。
    setOperationRequirementModalOpen(false);
    setSectionToolbarMap({});
    setSectionRefreshToolbarMap({});
  }, [project?.projectId, project?.projectType]);

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

  if (!project) {
    return <div className={styles.detailEmpty}>{intl.formatMessage({ id: 'projectSpace.selectProject' })}</div>;
  }

  const renderSectionContent = (section: ProjectDetailSection) => {
    const sectionKeyword = '';
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
          viewMode="board"
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
          onOpenRepositoryManager={(repo) => {
            setEditingRepository(repo);
            setRepositoryManagerOpen(true);
          }}
          onOpenScheduleTaskCreate={() => {
            setEditingScheduleTask(undefined);
            setScheduleTaskCreating(true);
          }}
          onEditScheduleTask={(task) => {
            setEditingScheduleTask(task);
            setScheduleTaskCreating(true);
          }}
          scheduleRefreshVersion={scheduleRefreshVersion}
          onResourceReference={(resource) => resourceReferenceHandler(resource)}
        />
      );
    }
    if (section === 'integration') return null;
    if (section === 'members') {
      return showMembersSection ? (
        <ProjectMembers
          project={project}
          keyword={sectionKeyword}
          compact
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
        onStarted={() => undefined}
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
      <div className={styles.detailMain}>
        {!scheduleTaskCreating && (
          <div className={styles.detailHeader}>
            <div className={styles.detailHeading}>
              <div className={styles.detailTitleRow}>
                <nav className={styles.detailBreadcrumb} aria-label={intl.formatMessage({ id: 'sider.projectSpace' })}>
                  <button type="button" className={styles.detailBreadcrumbLink} onClick={onBack}>
                    {intl.formatMessage({ id: 'sider.projectSpace' })}
                  </button>
                  <span className={styles.detailBreadcrumbSeparator}>/</span>
                  <span className={styles.detailBreadcrumbCurrent} title={project.projectName}>
                    {project.projectName}
                  </span>
                </nav>
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
              {onNewSession && (
                <Button icon={<PlusOutlined />} onClick={() => onNewSession()}>
                  {intl.formatMessage({ id: 'projectSpace.newChatName' })}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className={styles.detailBody}>
          {scheduleTaskCreating ? (
            <AutomationEditor
              source={editingScheduleTask}
              projectId={project.projectId}
              projectCloudResourceId={project.cloudResourceId}
              breadcrumbLabel={project.projectName}
              onCancel={() => {
                setScheduleTaskCreating(false);
                setEditingScheduleTask(undefined);
              }}
              onSaved={() => {
                setScheduleTaskCreating(false);
                setEditingScheduleTask(undefined);
                setScheduleRefreshVersion((version) => version + 1);
              }}
              onResourceReferenceChange={(handler) => setResourceReferenceHandler(() => handler)}
            />
          ) : (
            renderSectionContent('tasks')
          )}
        </div>
      </div>
      <aside className={styles.detailSidebar}>
        {showMembersSection && (
          <div
            className={`${styles.detailSidebarSection} ${styles.detailMembersSection} ${
              membersExpanded ? styles.resourceCategoryCardExpanded : ''
            }`}
          >
            <div className={styles.detailSidebarSectionHeader}>
              <Typography.Text className={styles.detailSidebarSectionTitle}>
                {intl.formatMessage({ id: 'projectSpace.members.title', defaultMessage: '项目成员' })}
              </Typography.Text>
              <div className={styles.detailSidebarSectionActions}>
                {sectionToolbarMap.members}
                <Button
                  type="text"
                  size="small"
                  className={styles.resourceCardExpandButton}
                  icon={membersExpanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => setMembersExpanded((expanded) => !expanded)}
                />
              </div>
            </div>
            {renderSectionContent('members')}
          </div>
        )}
        <div className={`${styles.detailSidebarSection} ${styles.detailResourcesSection}`}>
          {renderSectionContent('resources')}
        </div>
      </aside>
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
      {repositoryProject && (
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
    </section>
  );
};

export default ProjectDetail;
