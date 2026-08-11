import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Modal, Spin, message } from 'antd';
import { useIntl, useNavigate, useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { getDigitalEmployeeMentionItem } from '@/components/MessageList/utils';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';
import { clearEasyConfirmInputDraft } from '@/components/ChatLayoutComp/components/EasyConfirm';
import { deleteProject, saveDefaultAgent, saveProjectMembers, saveProjectResources, updateProject } from '@/service/devloop';
import ProjectFormModal, { type ProjectFormValues } from './components/ProjectFormModal';
import ProjectDetail from './components/ProjectDetail';
import { type ChatWithAgentTarget } from './components/ProjectDefaultAgentPanel';
import { useProjectDetail } from './hooks/useProjectDetail';
import { useProjectList } from './hooks/useProjectList';
import { useProjectScopeId } from './hooks/useProjectScopeId';
import { useProjectTypeConfig } from './hooks/useProjectTypeConfig';
import type { ProjectSession, ProjectSpace } from './types';
import styles from './index.module.less';

const getProjectId = (value?: string | number) => `${value ?? ''}`.trim();

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
  const intl = useIntl();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const { projects, loading: projectsLoading, fetchProjects, hasMore, loadMoreProjects } = useProjectList();
  const { projectTypeOptions, projectTypeLoading } = useProjectTypeConfig();
  const [selectedProjectId, setSelectedProjectId] = useProjectScopeId();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectSpace>();
  const [editLoading, setEditLoading] = useState(false);

  const { activeProject, loading: detailLoading, refreshProject } = useProjectDetail(projects, selectedProjectId);
  const canManageProject = useMemo(() => {
    const currentUserId = userInfo.userId ?? userInfo.id;
    return Boolean(
      activeProject?.createBy !== undefined &&
        activeProject?.createBy !== null &&
        currentUserId !== undefined &&
        currentUserId !== null &&
        `${activeProject.createBy}` === `${currentUserId}`
    );
  }, [activeProject?.createBy, userInfo.id, userInfo.userId]);

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

  const handleUpdateProject = useCallback(
    async (values: ProjectFormValues) => {
      if (!editingProject?.projectId || editLoading) return;
      setEditLoading(true);
      try {
        await updateProject({
          projectId: Number(editingProject.projectId),
          projectName: values.projectName.trim(),
          description: values.description?.trim(),
          projectType: values.projectType,
          isShare: values.sharedFlag ? 'Y' : 'N',
          shareTargets: [],
          resources: values.resources || [],
        });
        await saveProjectResources({
          projectId: Number(editingProject.projectId),
          resources: values.resources || [],
        });
        // 编辑项目沿用新建表单的成员和研发默认员工配置，
        // 避免页面级入口只更新基本信息。
        // 共享开关关闭时也要提交空成员集合，及时清理旧授权；开启时保存当前最终成员列表。
        await saveProjectMembers({
          projectId: Number(editingProject.projectId),
          userIds: values.sharedFlag
            ? (values.shareMembers || [])
              .map((member) => member.userId)
              .filter((userId): userId is string | number => Boolean(userId))
            : [],
        });
        if (values.projectType === 'develop' && values.defaultAgents) {
          await saveDefaultAgent({ ...values.defaultAgents, projectId: Number(editingProject.projectId) });
        }
        message.success(intl.formatMessage({ id: 'projectSpace.message.updateSuccess' }));
        setEditModalOpen(false);
        await fetchProjects();
        await refreshProject();
        EventEmitter.emit('projectSpace-list-refresh');
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.message.updateFailed' }));
      } finally {
        setEditLoading(false);
      }
    },
    [EventEmitter, editLoading, editingProject?.projectId, fetchProjects, intl, refreshProject]
  );

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

  return (
    <main className={styles.page}>
      {projectsLoading && !projects.length ? (
        <div className={styles.pageLoading}>
          <Spin />
        </div>
      ) : !activeProject ? (
        <div className={styles.pageEmpty}>
          <Empty description={intl.formatMessage({ id: 'projectSpace.selectProject' })} />
        </div>
      ) : (
        <div className={styles.detailHost}>
          {/* Spin 的包裹层必须占满详情宿主，内部 Tab 才能获得确定高度并正常纵向滚动。 */}
          <Spin spinning={detailLoading} wrapperClassName={styles.detailSpin}>
            {/* 主菜单项目页使用独立的大详情组件，不复用会话侧栏的项目小详情面板。 */}
            <ProjectDetail
              project={activeProject}
              onRefresh={refreshProject}
              onOpenSession={handleOpenSession}
              onNewSession={(target?: ChatWithAgentTarget) => {
                setSessionId?.('');
                navigate('/chat', {
                  state: {
                    keepSiderActiveKey: 'sessions',
                    from: 'projectSpace',
                    projectId: activeProject.projectId,
                    projectName: activeProject.projectName,
                  },
                });
                // 只有数字员工卡的「去聊天」带员工;工具栏「新建会话」不带,行为不变。
                // 走 queryInput-insert-item(RichInput 直接 insertItem)而不是 queryInput-set-schema:
                // 后者的落点 setCommonStateBySchema 只认 queryQuestion/inputSchema/mentionItem/payload,
                // 压根不读 agentId,光发它输入框不会出现 @。
                // 员工信息整份带过去,不能只给 agentId:输入框的 useDefaultAgentElement 拿 agentId 去
                // redux employees 列表里查,这些员工不在那份列表里,查不到就兜底成「AI 助手」。
                if (!target?.agentId) return;
                const mentionItem = getDigitalEmployeeMentionItem({
                  agentId: target.agentId,
                  name: target.name,
                  chatAvatar: target.chatAvatar,
                  agentType: target.agentType,
                } as any);
                if (!mentionItem) return;
                // 聊天页此刻还在挂载,RichInput 的监听要等它挂上才存在。用 rAF 双帧让出导航后的首帧渲染,
                // 比裸 setTimeout(150) 稳:150ms 只是猜的,挂载慢于它事件就整个丢掉。
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    EventEmitter.emit('queryInput-insert-item', {
                      item: mentionItem,
                      type: ResourceType.digitalEmployee,
                    });
                  });
                });
              }}
              onEditProject={canManageProject ? handleEditProject : undefined}
              onDeleteProject={canManageProject ? handleDeleteProject : undefined}
            />
          </Spin>
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
        onCancel={() => setEditModalOpen(false)}
        onSubmit={handleUpdateProject}
      />
    </main>
  );
};

export default ProjectSpacePage;
