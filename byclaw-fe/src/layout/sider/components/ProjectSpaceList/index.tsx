import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Input, Modal, Skeleton, Spin, Tag, Tooltip, message } from 'antd';
import { DownOutlined, PlusOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import { useDispatch, useNavigate } from '@umijs/max';
import classNames from 'classnames';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import { PROJECT_TYPE_LABEL } from '@/pages/projectSpace/constants';
import ProjectFormModal, { ProjectFormValues } from '@/pages/projectSpace/components/ProjectFormModal';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { createProject, deleteProject, getProject, updateProject } from '@/pages/projectSpace/service';
import type { ProjectSession, ProjectSpace } from '@/pages/projectSpace/types';
import { normalizeProjectDetail } from '@/pages/projectSpace/utils';
import { processSessionContent, formatTime } from '../DialogueList/util';
import { SiderContentContext } from '../../siderContentContext';
import ProjectDetailPanel from './ProjectDetailModal';
import styles from './index.module.less';

const ALL_PROJECT_SCOPE_KEY = '__all_project_scope__';

const getSessionKeywordMatched = (session: ProjectSession, query: string) => {
  return (
    `${session.sessionName || ''}`.toLowerCase().includes(query) ||
    `${session.sessionContent || ''}`.toLowerCase().includes(query)
  );
};

const getProjectKeywordMatched = (project: ProjectSpace, query: string) => {
  return (
    project.projectName.toLowerCase().includes(query) ||
    `${project.description || ''}`.toLowerCase().includes(query) ||
    (project.sessions || []).some((session) => getSessionKeywordMatched(session, query))
  );
};

const sortProjectSessions = (sessions: ProjectSession[] = []) => {
  return [...sessions].sort((left, right) => {
    const leftTime = new Date(left.updateTime || left.createTime || 0).getTime();
    const rightTime = new Date(right.updateTime || right.createTime || 0).getTime();
    return rightTime - leftTime;
  });
};

const getProjectScene = (project: ProjectSpace) => {
  if (project.sharedFlag) {
    return { classSuffix: 'Shared', text: '共享' };
  }

  if (project.projectType === 'development') {
    return { classSuffix: 'Development', text: '研发' };
  }

  return { classSuffix: 'Personal', text: '个人' };
};

const getProjectIdFromSaveResponse = (response: any) => {
  // 创建接口有的环境返回 data.projectId，有的请求封装会直接返回 projectId，这里统一兜底取值。
  return `${response?.projectId || response?.id || response?.data?.projectId || response?.data?.id || ''}`;
};

const ProjectSpaceList: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { EventEmitter, setAgentId, setSessionId, sessionId } = useGlobal();
  const { clearDetailPanel } = React.useContext(SiderContentContext);
  const { projects, loading, keyword, setKeyword, fetchProjects } = useProjectList();
  const [projectScopeId, setProjectScopeId] = useState(ALL_PROJECT_SCOPE_KEY);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [projectDetailMap, setProjectDetailMap] = useState<Record<string, ProjectSpace>>({});
  const [detailLoadingMap, setDetailLoadingMap] = useState<Record<string, boolean>>({});
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectSpace>();
  const [projectCreating, setProjectCreating] = useState(false);
  const [detailProject, setDetailProject] = useState<ProjectSpace>();
  const hasAutoSelectedRef = useRef(false);

  const mergedProjects = useMemo(() => {
    return projects.map((project) => projectDetailMap[project.projectId] || project);
  }, [projectDetailMap, projects]);

  const visibleProjects = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const scopedProjects =
      projectScopeId === ALL_PROJECT_SCOPE_KEY
        ? mergedProjects
        : mergedProjects.filter((project) => project.projectId === projectScopeId);

    if (!query) return scopedProjects;
    return scopedProjects.filter((project) => getProjectKeywordMatched(project, query));
  }, [keyword, mergedProjects, projectScopeId]);

  const activeScopeProject = useMemo(() => {
    return mergedProjects.find((project) => project.projectId === projectScopeId);
  }, [mergedProjects, projectScopeId]);

  const newChatProject = useMemo(() => {
    return (
      activeScopeProject ||
      mergedProjects.find((project) => project.projectId === activeProjectId) ||
      visibleProjects[0] ||
      mergedProjects[0]
    );
  }, [activeProjectId, activeScopeProject, mergedProjects, visibleProjects]);

  const scopeTitle = activeScopeProject?.projectName || '全部项目空间';
  const scopeCount =
    projectScopeId === ALL_PROJECT_SCOPE_KEY
      ? projects.length
      : activeScopeProject?.sessionCount ?? activeScopeProject?.sessions?.length ?? 0;

  const projectScopeMenuItems = useMemo(() => {
    return [
      {
        key: ALL_PROJECT_SCOPE_KEY,
        label: '全部项目空间',
      },
      ...mergedProjects.map((project) => ({
        key: project.projectId,
        label: project.projectName || '未命名项目',
      })),
    ];
  }, [mergedProjects]);

  const projectFormInitialValues = useMemo(() => {
    if (!editingProject) return undefined;
    return {
      projectName: editingProject.projectName,
      description: editingProject.description,
      projectType: editingProject.projectType,
      sharedFlag: editingProject.sharedFlag,
    };
  }, [editingProject]);

  const fetchProjectDetail = useCallback(
    async (project: ProjectSpace, force = false) => {
      const projectId = project.projectId;
      if (!projectId) return project;
      if (!force && projectDetailMap[projectId]) return projectDetailMap[projectId];

      setDetailLoadingMap((prev) => ({ ...prev, [projectId]: true }));
      try {
        // 展开项目时按项目详情接口取最新会话，避免把所有项目会话提前混到全局会话列表里。
        const detail = await getProject(Number(projectId));
        const normalizedProject = normalizeProjectDetail(detail, project) || project;
        setProjectDetailMap((prev) => ({ ...prev, [projectId]: normalizedProject }));
        return normalizedProject;
      } catch (error) {
        console.error('Failed to load project detail:', error);
        message.error('项目会话加载失败');
        return project;
      } finally {
        setDetailLoadingMap((prev) => ({ ...prev, [projectId]: false }));
      }
    },
    [projectDetailMap]
  );

  useEffect(() => {
    if (!projects.length) {
      setProjectScopeId(ALL_PROJECT_SCOPE_KEY);
      setActiveProjectId(undefined);
      setExpandedProjectIds([]);
      hasAutoSelectedRef.current = false;
      return;
    }

    if (projectScopeId !== ALL_PROJECT_SCOPE_KEY && !projects.some((project) => project.projectId === projectScopeId)) {
      setProjectScopeId(ALL_PROJECT_SCOPE_KEY);
    }

    if (hasAutoSelectedRef.current) {
      return;
    }

    const firstProject = projects[0];
    hasAutoSelectedRef.current = true;
    setActiveProjectId(firstProject.projectId);
    setExpandedProjectIds([]);
  }, [projectScopeId, projects]);

  const handleToggleProject = (project: ProjectSpace) => {
    const projectId = project.projectId;
    setActiveProjectId(projectId);
    setExpandedProjectIds((prev) => {
      const isExpanded = prev.includes(projectId);
      if (!isExpanded) {
        void fetchProjectDetail(project);
        return [...prev, projectId];
      }
      return prev.filter((id) => id !== projectId);
    });
  };

  const handleSelectProjectScope = ({ key }: { key: string }) => {
    setProjectScopeId(key);
    if (key === ALL_PROJECT_SCOPE_KEY) {
      setExpandedProjectIds([]);
      return;
    }

    const selectedProject = mergedProjects.find((project) => project.projectId === key);
    if (!selectedProject) return;

    setActiveProjectId(key);
    setExpandedProjectIds([key]);
    // 下拉切换到单个项目时直接加载下钻会话，让切换后的内容立即对应当前项目。
    void fetchProjectDetail(selectedProject);
  };

  const handleProjectSessionBound = useCallback(
    (payload: { projectId?: string | number }) => {
      const projectId = `${payload?.projectId || ''}`;
      if (!projectId) return;
      const targetProject = mergedProjects.find((project) => project.projectId === projectId);
      if (!targetProject) {
        void fetchProjects();
        return;
      }

      setActiveProjectId(projectId);
      setExpandedProjectIds((prev) => (prev.includes(projectId) ? prev : [projectId, ...prev]));
      void fetchProjectDetail(targetProject, true);
      void fetchProjects();
    },
    [fetchProjectDetail, fetchProjects, mergedProjects]
  );

  useEffect(() => {
    EventEmitter.on('projectSpace-session-bound', handleProjectSessionBound);
    return () => {
      EventEmitter.off('projectSpace-session-bound', handleProjectSessionBound);
    };
  }, [EventEmitter, handleProjectSessionBound]);

  const handleNewChat = () => {
    if (!newChatProject?.projectId) {
      message.warning('请先新建或选择项目');
      return;
    }

    clearDetailPanel?.();
    // 项目侧栏的新会话只重置右侧聊天上下文，侧栏仍停留在项目分组视图。
    setAgentId?.('');
    setSessionId?.('');
    setActiveProjectId(newChatProject.projectId);
    setProjectScopeId(newChatProject.projectId);
    setExpandedProjectIds((prev) => [
      newChatProject.projectId,
      ...prev.filter((id) => id !== newChatProject.projectId),
    ]);
    void fetchProjectDetail(newChatProject);
    navigate('/chat', {
      state: {
        keepSiderActiveKey: 'projectSpace',
        from: 'projectSpace',
        projectId: newChatProject.projectId,
        projectName: newChatProject.projectName,
      },
    });
  };

  const handleOpenCreateProject = () => {
    setEditingProject(undefined);
    setProjectModalOpen(true);
  };

  const handleOpenProjectDetail = (project: ProjectSpace) => {
    setDetailProject(projectDetailMap[project.projectId] || project);
    // 详情视图占用左侧小列表区域，不弹遮罩，右侧聊天页保持原状态。
    void fetchProjectDetail(project, true).then(setDetailProject);
  };

  const handleOpenEditProject = (project: ProjectSpace) => {
    setEditingProject(projectDetailMap[project.projectId] || project);
    setProjectModalOpen(true);
  };

  const handleDeleteProject = (project: ProjectSpace) => {
    Modal.confirm({
      title: '确认删除项目',
      content: `确定要删除项目「${project.projectName || '未命名项目'}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProject(Number(project.projectId));
          message.success('项目已删除');
          setProjectDetailMap((prev) => {
            const next = { ...prev };
            delete next[project.projectId];
            return next;
          });
          if (projectScopeId === project.projectId) {
            setProjectScopeId(ALL_PROJECT_SCOPE_KEY);
          }
          if (activeProjectId === project.projectId) {
            setActiveProjectId(undefined);
          }
          setExpandedProjectIds((prev) => prev.filter((id) => id !== project.projectId));
          await fetchProjects();
        } catch (error) {
          console.error('Failed to delete project:', error);
          message.error('项目删除失败');
        }
      },
    });
  };

  const handleProjectAction = (project: ProjectSpace, actionKey: string) => {
    if (actionKey === 'detail') {
      void handleOpenProjectDetail(project);
      return;
    }
    if (actionKey === 'edit') {
      handleOpenEditProject(project);
      return;
    }
    if (actionKey === 'delete') {
      handleDeleteProject(project);
    }
  };

  const handleCreateProject = async (values: ProjectFormValues) => {
    setProjectCreating(true);
    try {
      if (editingProject) {
        await updateProject({
          projectId: Number(editingProject.projectId),
          projectName: values.projectName.trim(),
          description: values.description?.trim(),
        });
        message.success('项目已更新');
        setProjectDetailMap((prev) => ({
          ...prev,
          [editingProject.projectId]: {
            ...(prev[editingProject.projectId] || editingProject),
            projectName: values.projectName.trim(),
            description: values.description?.trim(),
          },
        }));
      } else {
        const res = await createProject({
          projectName: values.projectName.trim(),
          description: values.description?.trim(),
          // 当前项目空间入口只创建项目基础信息，项目类型/共享状态等待后端字段稳定后再透传。
        });
        const createdProjectId = getProjectIdFromSaveResponse(res);
        message.success('项目空间创建成功');
        if (createdProjectId) {
          setActiveProjectId(createdProjectId);
          setProjectScopeId(createdProjectId);
          setExpandedProjectIds((prev) => [createdProjectId, ...prev.filter((id) => id !== createdProjectId)]);
        }
      }
      setProjectModalOpen(false);
      setEditingProject(undefined);
      // 创建/更新接口成功后，列表刷新失败不能再覆盖成功提示。
      void fetchProjects().catch((error) => {
        console.error('Failed to refresh project list after saving:', error);
        message.warning('项目已保存，列表刷新失败，请稍后手动刷新');
      });
    } catch (error) {
      console.error('Failed to create project:', error);
      message.error(editingProject ? '项目更新失败' : '项目空间创建失败');
    } finally {
      setProjectCreating(false);
    }
  };

  const handleOpenSession = (project: ProjectSpace, session: ProjectSession) => {
    if (!session.sessionId) {
      message.warning('未找到会话ID');
      return;
    }

    clearDetailPanel?.();

    if (Array.isArray(session.sessionExts) && session.sessionExts.length > 0) {
      dispatch({
        type: 'session/saveExtParamsBySessionId',
        payload: {
          sessionId: session.sessionId,
          extParams: session.sessionExts.reduce((acc: Record<string, any>, item) => {
            acc[item.extParamCode] = item.extParamValue;
            return acc;
          }, {}),
        },
      });
    }

    // 项目空间只负责切换会话上下文，右侧仍然复用原聊天页。
    setSessionId?.(`${session.sessionId}`);
    setAgentId?.(session.objectId ? `${session.objectId}` : '');
    navigate('/chat', {
      state: {
        keepSiderActiveKey: 'projectSpace',
        projectId: project.projectId,
        projectName: project.projectName,
        from: 'projectSpace',
      },
    });
  };

  const renderSessionList = (project: ProjectSpace) => {
    const sessions = sortProjectSessions(project.sessions || []);
    const isLoading = detailLoadingMap[project.projectId];

    if (isLoading) {
      return (
        <div className={styles.sessionSkeleton}>
          <Skeleton active avatar={{ size: 24, shape: 'circle' }} paragraph={{ rows: 1 }} title={false} />
          <Skeleton active avatar={{ size: 24, shape: 'circle' }} paragraph={{ rows: 1 }} title={false} />
        </div>
      );
    }

    if (!sessions.length) {
      return <div className={styles.sessionEmpty}>暂无会话</div>;
    }

    return sessions.map((session) => {
      const active = `${sessionId}` === `${session.sessionId}`;
      return (
        <button
          type="button"
          key={session.sessionId}
          className={classNames(styles.sessionItem, active && styles.sessionItemActive)}
          onClick={() => handleOpenSession(project, session)}
        >
          <span className={styles.sessionIcon}>
            <AntdIcon type="icon-cebianlan-duihuajilu" />
          </span>
          <span className={styles.sessionMain}>
            <Tooltip placement="top" title={session.sessionName}>
              <span className={styles.sessionTitle}>{session.sessionName || '未命名会话'}</span>
            </Tooltip>
            <span className={styles.sessionDesc}>
              {processSessionContent(session.sessionContent) || '暂无会话摘要'}
            </span>
          </span>
          <span className={styles.sessionTime}>{formatTime(session.updateTime || '', session.createTime || '')}</span>
        </button>
      );
    });
  };

  return (
    <div className={styles.projectSpaceList}>
      {detailProject ? (
        <ProjectDetailPanel
          project={detailProject}
          onBack={() => setDetailProject(undefined)}
          onEditProject={handleOpenEditProject}
        />
      ) : (
        <>
          <div className={styles.header}>
            <div className={styles.searchInput}>
              <Input
                value={keyword}
                suffix={<SearchOutlined />}
                placeholder="请输入关键字"
                onChange={(event) => setKeyword(trim(event.target.value))}
              />
            </div>
            <Dropdown
              trigger={['click']}
              menu={{
                items: projectScopeMenuItems,
                selectedKeys: [projectScopeId],
                onClick: handleSelectProjectScope,
              }}
            >
              <button type="button" className={styles.scopeRow}>
                <span className={styles.scopeTitle}>{scopeTitle}</span>
                <span className={styles.scopeMeta}>
                  {scopeCount}
                  <DownOutlined />
                </span>
              </button>
            </Dropdown>
            <div className={styles.actionRow}>
              <Button type="primary" className={styles.newChatButton} icon={<PlusOutlined />} onClick={handleNewChat}>
                新会话
              </Button>
              <Tooltip title="新建项目">
                <Button className={styles.newProjectButton} icon={<PlusOutlined />} onClick={handleOpenCreateProject} />
              </Tooltip>
            </div>
          </div>

          <Spin spinning={loading} wrapperClassName={styles.spin}>
            <div className={styles.projectList}>
              {visibleProjects.length ? (
                visibleProjects.map((project) => {
                  const isExpanded = expandedProjectIds.includes(project.projectId);
                  const active = activeProjectId === project.projectId;
                  const sessionCount = project.sessionCount ?? project.sessions?.length ?? 0;
                  const scene = getProjectScene(project);

                  return (
                    <div
                      key={project.projectId}
                      className={classNames(styles.projectItem, active && styles.projectActive)}
                    >
                      <div className={styles.projectTop}>
                        <button
                          type="button"
                          className={styles.projectHeader}
                          onClick={() => handleToggleProject(project)}
                        >
                          <span className={styles.expandIcon}>{isExpanded ? <DownOutlined /> : <RightOutlined />}</span>
                          <span className={styles.projectMain}>
                            <span className={styles.projectTitleRow}>
                              <Tooltip placement="top" title={project.projectName}>
                                <span className={styles.projectName}>{project.projectName || '未命名项目'}</span>
                              </Tooltip>
                              <Tag
                                bordered={false}
                                className={classNames(styles.projectTag, styles[`projectTag${scene.classSuffix}`])}
                              >
                                {scene.text}
                              </Tag>
                            </span>
                            <span className={styles.projectDesc}>
                              {project.description ||
                                `${PROJECT_TYPE_LABEL[project.projectType]} · ${sessionCount} 个会话`}
                            </span>
                          </span>
                        </button>
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: [
                              { key: 'detail', label: '详情' },
                              { key: 'edit', label: '编辑' },
                              { key: 'delete', label: '删除', danger: true },
                            ],
                            onClick: ({ key }) => handleProjectAction(project, key),
                          }}
                        >
                          <button
                            type="button"
                            className={styles.projectAction}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <AntdIcon type="icon-a-Moregengduo" />
                          </button>
                        </Dropdown>
                      </div>
                      {isExpanded && <div className={styles.sessionList}>{renderSessionList(project)}</div>}
                    </div>
                  );
                })
              ) : (
                <div className={styles.emptyWrap}>
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目空间" />
                </div>
              )}
            </div>
          </Spin>
        </>
      )}

      <ProjectFormModal
        open={projectModalOpen}
        title={editingProject ? '编辑项目空间' : '新建项目空间'}
        loading={projectCreating}
        initialValues={projectFormInitialValues}
        onCancel={() => {
          setProjectModalOpen(false);
          setEditingProject(undefined);
        }}
        onSubmit={handleCreateProject}
      />
    </div>
  );
};

export default ProjectSpaceList;
