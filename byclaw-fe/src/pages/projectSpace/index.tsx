import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Modal, Spin, message } from 'antd';
import { useIntl, useLocation, useNavigate, useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { clearEasyConfirmInputDraft } from '@/components/ChatLayoutComp/components/EasyConfirm';
import { deleteProject, saveDefaultAgent, saveProjectMembers, saveProjectResources, updateProject } from '@/service/devloop';
import ProjectFormModal, { type ProjectFormValues } from './components/ProjectFormModal';
import ProjectDetail from './components/ProjectDetail';
import { useProjectDetail } from './hooks/useProjectDetail';
import { useProjectList } from './hooks/useProjectList';
import { useProjectTypeConfig } from './hooks/useProjectTypeConfig';
import { getStoredProjectScopeId, saveProjectScopeIdToStorage } from './constants';
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

// 项目页面使用 URL 作为唯一的选中状态来源，
// 左侧小列表和浏览器刷新都能稳定恢复当前详情。
const ProjectSpacePage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const intl = useIntl();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const { projects, loading: projectsLoading, fetchProjects } = useProjectList();
  const { projectTypeOptions, projectTypeLoading } = useProjectTypeConfig();
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectSpace>();
  const [editLoading, setEditLoading] = useState(false);

  const urlProjectId = useMemo(
    () => new URLSearchParams(location.search).get('projectId') || undefined,
    [location.search]
  );
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
    if (!projects.length) {
      setSelectedProjectId(undefined);
      return;
    }

    const storedProjectId = getStoredProjectScopeId();
    const requestedProject =
      urlProjectId && projects.find((project) => getProjectId(project.projectId) === urlProjectId);
    const storedProject =
      storedProjectId && projects.find((project) => getProjectId(project.projectId) === storedProjectId);
    const fallbackProject =
      requestedProject || storedProject || projects.find((project) => project.projectType === 'default') || projects[0];
    const nextProjectId = getProjectId(fallbackProject?.projectId);
    if (!nextProjectId) return;

    setSelectedProjectId(nextProjectId);
    saveProjectScopeIdToStorage(nextProjectId);
    if (urlProjectId !== nextProjectId) {
      navigate(`/projectSpace?projectId=${encodeURIComponent(nextProjectId)}`, { replace: true });
    }
  }, [navigate, projects, urlProjectId]);

  useEffect(() => {
    if (!activeProject?.projectId) return;
    const projectId = getProjectId(activeProject.projectId);
    saveProjectScopeIdToStorage(projectId);
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
            saveProjectScopeIdToStorage();
            await fetchProjects();
            EventEmitter.emit('projectSpace-list-refresh');
            navigate('/projectSpace');
          } catch (error: any) {
            message.error(error?.message || intl.formatMessage({ id: 'projectSpace.message.deleteFailed' }));
          }
        },
      });
    },
    [EventEmitter, fetchProjects, intl, navigate]
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
              onNewSession={() => {
                setSessionId?.('');
                navigate('/chat', {
                  state: {
                    keepSiderActiveKey: 'sessions',
                    from: 'projectSpace',
                    projectId: activeProject.projectId,
                    projectName: activeProject.projectName,
                  },
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
