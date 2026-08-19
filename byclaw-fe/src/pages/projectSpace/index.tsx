import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Empty, Input, Modal, Tag, message } from 'antd';
import {
  ShareAltOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useIntl, useLocation, useNavigate, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import classNames from 'classnames';
import useGlobal from '@/hooks/useGlobal';
import { setAgentCache } from '@/components/QueryInput/RichInput/agentCache';
import getElementData from '@/components/QueryInput/RichInput/utils/getElementData';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';
import { agentTypeMap } from '@/constants/agent';
import { clearEasyConfirmInputDraft } from '@/components/ChatLayoutComp/components/EasyConfirm';
import { getPublicPath } from '@/utils';
import {
  createProject,
  deleteProject,
  saveProjectMembers,
  saveProjectResources,
  updateProject,
} from '@/service/devloop';
import ProjectFormModal, { type ProjectFormValues } from './components/ProjectFormModal';
import ProjectOnboardingWizard, { type ArchitectChatTarget } from './components/ProjectOnboardingWizard';
import ProjectDetail from './components/ProjectDetail';
import { type ChatWithAgentTarget } from './components/ProjectDefaultAgentPanel';
import { useProjectDetail } from './hooks/useProjectDetail';
import { useProjectList } from './hooks/useProjectList';
import { useProjectScopeId } from './hooks/useProjectScopeId';
import { useProjectTypeConfig } from './hooks/useProjectTypeConfig';
import type { ProjectSession, ProjectSpace } from './types';
import styles from './index.module.less';

const getProjectId = (value?: string | number) => `${value ?? ''}`.trim();

interface ProjectSpaceNavigationState {
  openProjectList?: boolean;
  openProjectDetail?: boolean;
  projectId?: string | number;
}

const formatProjectCreateTime = (value?: string) => {
  if (!value) return '';
  const normalizedValue = /^\d+$/.test(value) ? Number(value) : value;
  const createTime = dayjs(normalizedValue);
  return createTime.isValid() ? createTime.format('YYYY-MM-DD') : '';
};

const getProjectIdFromSaveResponse = (response: any) =>
  getProjectId(response?.projectId || response?.id || response?.data?.projectId || response?.data?.id);

const isProjectCreator = (project: ProjectSpace | undefined, userInfo: any) => {
  const currentUserId = userInfo.userId ?? userInfo.id;
  return Boolean(
    project?.createBy !== undefined &&
      project?.createBy !== null &&
      currentUserId !== undefined &&
      currentUserId !== null &&
      `${project.createBy}` === `${currentUserId}`
  );
};

const getProjectFormInitialValues = (project?: ProjectSpace): Partial<ProjectFormValues> | undefined => {
  if (!project) return undefined;
  return {
    projectName: project.projectName,
    description: project.description,
    projectType: project.projectType,
    sharedFlag: project.sharedFlag,
    shareMembers: (project.members || []).map((member) => ({
      id: `${member.memberId || `user_${member.userId}`}`,
      type: 'USER' as const,
      userId: member.userId,
      userCode: member.userCode,
      userName: member.userName,
      name: member.userName,
      memberId: member.memberId,
      role: member.role,
    })),
    resources: project.resources || project.boundResources || [],
  };
};

// 项目大详情与会话模块共用同一份当前项目状态，不再通过 URL 查询参数重复维护选中值。
const ProjectSpacePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const intl = useIntl();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const {
    projects,
    loading: projectsLoading,
    keyword: projectKeyword,
    setKeyword: setProjectKeyword,
    fetchProjects,
    hasMore,
    loadMoreProjects,
  } = useProjectList();
  const { projectTypeOptions, projectTypeLoading } = useProjectTypeConfig();
  const [selectedProjectId, setSelectedProjectId] = useProjectScopeId();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectSpace>();
  const [editLoading, setEditLoading] = useState(false);
  const [renameProject, setRenameProject] = useState<ProjectSpace>();
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showProjectList, setShowProjectList] = useState(true);

  useEffect(() => {
    const navigationState = location.state as ProjectSpaceNavigationState | null;
    if (navigationState?.openProjectList) {
      setShowProjectList(true);
      return;
    }
    if (navigationState?.openProjectDetail) {
      const projectId = getProjectId(navigationState.projectId);
      if (projectId) {
        setSelectedProjectId(projectId);
        setShowProjectList(false);
      }
    }
  }, [location.key, location.state, setSelectedProjectId]);

  const { activeProject, refreshProject } = useProjectDetail(projects, selectedProjectId);
  const canManageProject = useMemo(() => isProjectCreator(activeProject, userInfo), [activeProject, userInfo]);

  useEffect(() => {
    const refresh = () => {
      void fetchProjects();
    };
    EventEmitter.on('projectSpace-list-refresh', refresh);
    return () => EventEmitter.off('projectSpace-list-refresh', refresh);
  }, [EventEmitter, fetchProjects]);

  useEffect(() => {
    if (projectsLoading) return;
    // 首次请求前列表也为空，不能因此清除会话模块已经保存的当前项目。
    if (!projects.length) return;

    const storedProject =
      selectedProjectId && projects.find((project) => getProjectId(project.projectId) === selectedProjectId);
    if (selectedProjectId && !storedProject) {
      if (hasMore) void loadMoreProjects();
      // 另一模块可能刚创建或切换项目，列表刷新完成前保留共享值，不能回退覆盖。
      return;
    }
    const fallbackProject =
      storedProject || projects.find((project) => project.projectType === 'default') || projects[0];
    const nextProjectId = getProjectId(fallbackProject?.projectId);
    if (!nextProjectId) return;

    if (selectedProjectId !== nextProjectId) setSelectedProjectId(nextProjectId);
  }, [hasMore, loadMoreProjects, projects, projectsLoading, selectedProjectId, setSelectedProjectId]);

  useEffect(() => {
    if (!activeProject?.projectId) return;
    const projectId = getProjectId(activeProject.projectId);
    EventEmitter.emit('projectSpace-active-project-change', {
      projectId,
      projectName: activeProject.projectName,
    });
  }, [EventEmitter, activeProject?.projectId, activeProject?.projectName]);

  const handleOpenSession = useCallback(
    (session: ProjectSession) => {
      if (!session.sessionId) return;
      // 项目详情切换会话时丢弃目标会话遗留的多员工草稿，只使用详情返回的默认员工。
      clearEasyConfirmInputDraft(session.sessionId);
      // 研发任务会话绑的是项目维度执行员工，不在 redux employeesList/agentList 里,
      // useDefaultAgentElement 查不到就兜底成「AI 助手」。agentCache 在那个 hook 里优先于 redux 查表,
      // 所以带了名字就先把整份员工写进去。只在有 agentName 时写:会话列表那条路没有这个字段,
      // 写个没名字的条目反而会盖掉 redux 里查得到的正确员工。
      if (session.agentName && session.objectId !== undefined && session.objectId !== null) {
        setAgentCache(
          getElementData(ResourceType.digitalEmployee, {
            agentId: `${session.objectId}`,
            name: session.agentName,
            chatAvatar: session.avatar,
            agentType: agentTypeMap.agent,
          })
        );
      }
      // 项目详情页只负责切换全局会话上下文，聊天页仍负责渲染会话内容。
      setAgentId?.(session.objectId !== undefined && session.objectId !== null ? `${session.objectId}` : '');
      setSessionId?.(session.sessionId);
      navigate('/chat', {
        state: {
          keepSiderActiveKey: 'sessions',
          from: 'projectSpace',
          projectId: activeProject?.projectId,
          projectName: activeProject?.projectName,
          sessionId: session.sessionId,
          autoSendContent: session.initialChatContent,
          selectedAgentId: session.objectId,
          selectedAgentObjectType: session.objectType,
        },
      });
    },
    [activeProject?.projectId, activeProject?.projectName, navigate, setAgentId, setSessionId]
  );

  const handleEditProject = useCallback((project: ProjectSpace) => {
    setEditingProject(project);
    setEditModalOpen(true);
  }, []);

  const handleCreateProject = useCallback(() => {
    setProjectKeyword('');
    setEditingProject(undefined);
    setWizardOpen(true);
  }, [setProjectKeyword]);

  const handleSaveProject = useCallback(
    async (values: ProjectFormValues) => {
      if (editLoading) return '';
      const projectName = values.projectName.trim();
      if (!projectName) {
        message.warning(intl.formatMessage({ id: 'projectSpace.message.projectNameRequired' }));
        return '';
      }
      const duplicateProject = projects.some(
        (project) =>
          getProjectId(project.projectId) !== getProjectId(editingProject?.projectId) &&
          project.projectName.trim().toLocaleLowerCase() === projectName.toLocaleLowerCase()
      );
      if (duplicateProject) {
        message.warning(intl.formatMessage({ id: 'projectSpace.message.projectNameDuplicate' }));
        return '';
      }

      setEditLoading(true);
      try {
        const sharedFlag =
          values.projectType === 'default'
            ? false
            : values.projectType === 'develop' || values.projectType === 'operation' || values.sharedFlag;
        const resources = values.resources || [];
        let savedProjectId = getProjectId(editingProject?.projectId);

        if (editingProject?.projectId) {
          await updateProject({
            projectId: Number(editingProject.projectId),
            projectName,
            description: values.description?.trim(),
            projectType: values.projectType,
            isShare: sharedFlag ? 'Y' : 'N',
            shareTargets: [],
            resources,
          });
          await saveProjectResources({
            projectId: Number(editingProject.projectId),
            resources,
          });
        } else {
          const response = await createProject(
            {
              projectName,
              description: values.description?.trim(),
              projectType: values.projectType,
              isShare: sharedFlag ? 'Y' : 'N',
              shareTargets: [],
              resources,
            },
            { responseCfg: { hideErrorTips: true } }
          );
          savedProjectId = getProjectIdFromSaveResponse(response);
          if (!savedProjectId) throw new Error(intl.formatMessage({ id: 'projectSpace.message.createFailed' }));
        }

        await saveProjectMembers({
          projectId: Number(savedProjectId),
          userIds: sharedFlag
            ? (values.shareMembers || [])
              .map((member) => member.userId)
              .filter((userId): userId is string | number => Boolean(userId))
            : [],
        });
        message.success(
          intl.formatMessage({
            id: editingProject ? 'projectSpace.message.updateSuccess' : 'projectSpace.message.createSuccess',
          })
        );
        setEditModalOpen(false);
        setEditingProject(undefined);
        const refreshedProjects = await fetchProjects();
        if (!editingProject && savedProjectId) {
          const createdProject = refreshedProjects.find(
            (project) => getProjectId(project.projectId) === savedProjectId
          );
          setSelectedProjectId(getProjectId(createdProject?.projectId || savedProjectId));
        } else {
          await refreshProject();
        }
        EventEmitter.emit('projectSpace-list-refresh');
        return savedProjectId;
      } catch (error: any) {
        message.error(
          error?.message ||
            intl.formatMessage({
              id: editingProject ? 'projectSpace.message.updateFailed' : 'projectSpace.message.createFailed',
            })
        );
        return '';
      } finally {
        setEditLoading(false);
      }
    },
    [EventEmitter, editLoading, editingProject, fetchProjects, intl, projects, refreshProject, setSelectedProjectId]
  );

  const handleOpenRenameProject = useCallback((project: ProjectSpace) => {
    setRenameProject(project);
    setRenameValue(project.projectName || '');
  }, []);

  const handleRenameProject = useCallback(async () => {
    if (!renameProject?.projectId || renameLoading) return;
    const projectName = renameValue.trim();
    if (!projectName) {
      message.warning(intl.formatMessage({ id: 'projectSpace.message.projectNameRequired' }));
      return;
    }
    const duplicateProject = projects.some(
      (project) =>
        getProjectId(project.projectId) !== getProjectId(renameProject.projectId) &&
        project.projectName.trim().toLocaleLowerCase() === projectName.toLocaleLowerCase()
    );
    if (duplicateProject) {
      message.warning(intl.formatMessage({ id: 'projectSpace.message.projectNameDuplicate' }));
      return;
    }

    setRenameLoading(true);
    try {
      await updateProject({ projectId: Number(renameProject.projectId), projectName });
      message.success(intl.formatMessage({ id: 'projectSpace.message.updateSuccess' }));
      setRenameProject(undefined);
      await fetchProjects();
      if (getProjectId(activeProject?.projectId) === getProjectId(renameProject.projectId)) {
        await refreshProject();
      }
      EventEmitter.emit('projectSpace-list-refresh');
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.message.updateFailed' }));
    } finally {
      setRenameLoading(false);
    }
  }, [
    EventEmitter,
    activeProject?.projectId,
    fetchProjects,
    intl,
    projects,
    refreshProject,
    renameLoading,
    renameProject,
    renameValue,
  ]);

  const handleDeleteProject = useCallback(
    (project: ProjectSpace) => {
      if (project.projectType === 'default') {
        message.warning(intl.formatMessage({ id: 'projectSpace.message.defaultCannotDelete' }));
        return;
      }
      Modal.confirm({
        title: intl.formatMessage({ id: 'projectSpace.message.deleteConfirmTitle' }),
        content: intl.formatMessage({ id: 'projectSpace.message.deleteConfirmContent' }, { name: project.projectName }),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteProject(Number(project.projectId));
            message.success(intl.formatMessage({ id: 'projectSpace.message.deleteSuccess' }));
            setSelectedProjectId(undefined);
            await fetchProjects();
            EventEmitter.emit('projectSpace-list-refresh');
          } catch (error: any) {
            message.error(error?.message || intl.formatMessage({ id: 'projectSpace.message.deleteFailed' }));
          }
        },
      });
    },
    [EventEmitter, fetchProjects, intl, setSelectedProjectId]
  );

  const handleProjectCardClick = useCallback(
    (project: ProjectSpace) => {
      const projectId = getProjectId(project.projectId);
      if (!projectId) return;
      setSelectedProjectId(projectId);
      EventEmitter.emit('projectSpace-active-project-change', {
        projectId,
        projectName: project.projectName,
      });
      setShowProjectList(false);
    },
    [EventEmitter, setSelectedProjectId]
  );

  const handleWizardFinish = useCallback(
    (projectId: string) => {
      setWizardOpen(false);
      setSelectedProjectId(projectId);
      setShowProjectList(false);
    },
    [setSelectedProjectId]
  );

  const handleWizardEnterArchitectChat = useCallback(
    (projectId: string, target?: ArchitectChatTarget) => {
      const project = projects.find((item) => getProjectId(item.projectId) === projectId);
      setWizardOpen(false);
      if (target?.agentId && target.agentName) {
        setAgentCache(
          getElementData(ResourceType.digitalEmployee, {
            agentId: target.agentId,
            name: target.agentName,
            agentType: agentTypeMap.agent,
          })
        );
      }
      setAgentId?.(target?.agentId || '');
      setSessionId?.(target?.sessionId || '');
      navigate('/chat', {
        state: {
          keepSiderActiveKey: 'sessions',
          from: 'projectSpace',
          projectId,
          projectName: project?.projectName,
          sessionId: target?.sessionId,
          selectedAgentId: target?.agentId,
          selectedAgentObjectType: target?.agentId ? 'DigEmployee' : undefined,
        },
      });
    },
    [navigate, projects, setAgentId, setSessionId]
  );

  const renderProjectCards = () => {
    return (
      <div className={styles.projectListPage}>
        <div className={styles.projectHero}>
          <div className={styles.projectHeroContent}>
            <h1>{intl.formatMessage({ id: 'sider.projectSpace' })}</h1>
            <p>{intl.formatMessage({ id: 'projectSpace.heroSubtitle' })}</p>
            <Button className={styles.projectCreateButton} icon={<PlusOutlined />} onClick={handleCreateProject}>
              {intl.formatMessage({ id: 'projectSpace.createProject' })}
            </Button>
          </div>
          <div className={styles.projectHeroIllustration} aria-hidden="true">
            <img src={`${getPublicPath()}beyond/emptyBg.png`} alt="" />
          </div>
        </div>
        <div className={styles.projectListHeader}>
          <h2>{intl.formatMessage({ id: 'projectSpace.myProjects' })}</h2>
          <Input
            allowClear
            className={styles.projectSearchInput}
            prefix={<SearchOutlined />}
            placeholder={intl.formatMessage({ id: 'projectSpace.projectSearchPlaceholder' })}
            value={projectKeyword}
            onChange={(event) => setProjectKeyword(event.target.value)}
          />
        </div>
        {projectsLoading && !projects.length ? (
          <div className={styles.projectCardGrid} aria-busy="true">
            {Array.from({ length: 9 }, (_, index) => (
              <div key={index} className={styles.projectSkeletonCard} aria-hidden="true">
                <span className={styles.projectSkeletonIcon} />
                <span className={styles.projectSkeletonBody}>
                  <span className={styles.projectSkeletonTitle} />
                  <span className={styles.projectSkeletonDescription} />
                </span>
              </div>
            ))}
          </div>
        ) : !projects.length ? (
          <div className={styles.projectListFeedback}>
            <Empty
              description={
                projectKeyword
                  ? intl.formatMessage({ id: 'projectSpace.projectSearchEmpty' })
                  : intl.formatMessage({ id: 'projectSpace.selectProject' })
              }
            />
          </div>
        ) : (
          <div className={styles.projectCardGrid}>
            {projects.map((project) => {
              const canManageCard = isProjectCreator(project, userInfo);
              const createTime = formatProjectCreateTime(project.createTime);
              return (
                <div
                  key={getProjectId(project.projectId)}
                  className={styles.projectListCard}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleProjectCardClick(project)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleProjectCardClick(project);
                    }
                  }}
                >
                  <span className={styles.projectCardIcon}>
                    <ShareAltOutlined />
                  </span>
                  <span className={styles.projectCardBody}>
                    <span className={styles.projectCardTitleRow}>
                      <strong>
                        {project.projectName || intl.formatMessage({ id: 'projectSpace.unnamedProject' })}
                      </strong>
                      {project.projectType === 'develop' || project.projectType === 'operation' ? (
                        <Tag
                          bordered={false}
                          className={classNames(
                            styles.projectTypeTag,
                            project.projectType === 'develop'
                              ? styles.projectTypeTagDevelopment
                              : styles.projectTypeTagOperation
                          )}
                        >
                          {intl.formatMessage({
                            id:
                              project.projectType === 'develop'
                                ? 'projectSpace.scene.development'
                                : 'projectSpace.scene.operation',
                          })}
                        </Tag>
                      ) : null}
                    </span>
                    <small>
                      {createTime
                        ? intl.formatMessage({ id: 'projectSpace.projectCard.createdAt' }, { time: createTime })
                        : project.description ||
                          intl.formatMessage({ id: 'projectSpace.projectCard.emptyDescription' })}
                    </small>
                  </span>
                  {canManageCard && (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'rename',
                            icon: <EditOutlined />,
                            label: intl.formatMessage({ id: 'common.rename' }),
                          },
                          ...(project.projectType === 'default'
                            ? []
                            : [
                              {
                                key: 'delete',
                                icon: <DeleteOutlined />,
                                label: intl.formatMessage({ id: 'common.delete' }),
                                danger: true,
                              },
                            ]),
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'rename') handleOpenRenameProject(project);
                          if (key === 'delete') handleDeleteProject(project);
                        },
                      }}
                    >
                      <button
                        type="button"
                        className={styles.projectCardMore}
                        aria-label={intl.formatMessage({ id: 'common.more' })}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <MoreOutlined />
                      </button>
                    </Dropdown>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <main className={styles.page}>
      {showProjectList ? (
        renderProjectCards()
      ) : !activeProject ? (
        <div className={styles.pageEmpty}>
          <Empty description={intl.formatMessage({ id: 'projectSpace.selectProject' })} />
        </div>
      ) : (
        <div className={styles.detailHost}>
          {/* 详情数据静默更新，由当前 Tab 独立展示 loading，避免打开项目时出现两层加载图标。 */}
          <ProjectDetail
            project={activeProject}
            onBack={() => setShowProjectList(true)}
            onRefresh={refreshProject}
            onOpenSession={handleOpenSession}
            onNewSession={(target?: ChatWithAgentTarget) => {
              setSessionId?.('');
              // 只有数字员工卡的「去聊天」带员工;工具栏「新建会话」不带,行为不变。
              // 面板员工可能不在 redux employeesList 里(个人创建的员工走 queryMyCreated),
              // 光给 agentId 会让 useDefaultAgentElement 查不到人而兜底成「AI 助手」。
              // 先把整份员工写进 agentCache,它在那个 hook 里优先于 redux 查表。
              if (target?.agentId) {
                setAgentCache(
                  getElementData(ResourceType.digitalEmployee, {
                    agentId: `${target.agentId}`,
                    name: target.name,
                    chatAvatar: target.chatAvatar,
                    agentType: target.agentType,
                  })
                );
              }
              navigate('/chat', {
                state: {
                  keepSiderActiveKey: 'sessions',
                  from: 'projectSpace',
                  projectId: activeProject.projectId,
                  projectName: activeProject.projectName,
                  // 聊天页据此在挂载后恢复 @ 员工。不能在这里直接 setAgentId:
                  // ChatLayoutComp 挂载时会按「无会话员工」清空一次,早设的值会被抹掉。
                  selectedAgentId: target?.agentId,
                  selectedAgentObjectType: target?.agentId ? 'DigEmployee' : undefined,
                },
              });
            }}
            onEditProject={canManageProject ? handleEditProject : undefined}
            onDeleteProject={canManageProject ? handleDeleteProject : undefined}
          />
        </div>
      )}

      <ProjectFormModal
        open={editModalOpen}
        loading={editLoading}
        projectId={editingProject?.projectId}
        creatorId={editingProject?.createBy}
        initialValues={getProjectFormInitialValues(editingProject)}
        projectTypeConfigOptions={projectTypeOptions}
        projectTypeLoading={projectTypeLoading}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingProject(undefined);
        }}
        onSubmit={handleSaveProject}
      />

      <ProjectOnboardingWizard
        open={wizardOpen}
        projectTypeConfigOptions={projectTypeOptions}
        projectTypeLoading={projectTypeLoading}
        onCancel={() => setWizardOpen(false)}
        onCreateProject={handleSaveProject}
        onFinish={handleWizardFinish}
        onEnterArchitectChat={handleWizardEnterArchitectChat}
      />

      <Modal
        open={Boolean(renameProject)}
        title={intl.formatMessage({ id: 'common.rename' })}
        confirmLoading={renameLoading}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        onCancel={() => setRenameProject(undefined)}
        onOk={() => void handleRenameProject()}
        destroyOnClose
      >
        <Input
          autoFocus
          maxLength={15}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void handleRenameProject()}
        />
      </Modal>
    </main>
  );
};

export default ProjectSpacePage;
