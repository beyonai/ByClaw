import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Input, Modal, Skeleton, Spin, Tag, Tooltip, message } from 'antd';
import { DownOutlined, PlusOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import { useDispatch, useNavigate } from '@umijs/max';
import classNames from 'classnames';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import ChatAvatar from '@/components/ChatAvatar';
import useGlobal from '@/hooks/useGlobal';
import ProjectFormModal, {
  type ProjectFormValues,
  type ProjectShareMember,
} from '@/pages/projectSpace/components/ProjectFormModal';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import {
  createProject,
  deleteProject,
  getProject,
  listProjectSessionsByQo,
  updateProject,
} from '@/pages/projectSpace/service';
import type { ProjectSession, ProjectSpace } from '@/pages/projectSpace/types';
import { getArrayData, normalizeProjectDetail, normalizeProjectSession } from '@/pages/projectSpace/utils';
import { addProjectMember, listProjectMembers, removeProjectMember } from '@/service/devloop';
import { processSessionContent, formatTime } from '../DialogueList/util';
import { SiderContentContext } from '../../siderContentContext';
import ProjectDetailPanel from './ProjectDetailModal';
import styles from './index.module.less';

const ALL_PROJECT_SCOPE_KEY = '__all_project_scope__';
const PROJECT_SESSION_PAGE_SIZE = 30;

type ProjectSessionPageState = {
  pageNum: number;
  pageSize: number;
  total: number;
};

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

const mergeProjectSessions = (cachedSessions: ProjectSession[] = [], nextSessions: ProjectSession[] = []) => {
  // 分页追加时按 sessionId 去重，避免重复加载或会话更新后列表出现两条同一会话。
  const sessionMap = new Map<string, ProjectSession>();
  [...cachedSessions, ...nextSessions].forEach((session, index) => {
    const sessionKey = `${session.sessionId || `${session.projectId || 'project'}_${index}`}`;
    sessionMap.set(sessionKey, {
      ...(sessionMap.get(sessionKey) || {}),
      ...session,
    });
  });
  return Array.from(sessionMap.values());
};

const getProjectScene = (project: ProjectSpace) => {
  if (project.projectType === 'default') {
    return { classSuffix: 'Default', text: '默认' };
  }

  // 研发项目即使强制共享，列表也优先展示业务类型标签。
  if (project.projectType === 'develop') {
    return { classSuffix: 'Development', text: '研发' };
  }

  if (project.sharedFlag) {
    return { classSuffix: 'Shared', text: '共享' };
  }

  return { classSuffix: 'Personal', text: '个人' };
};

const renderProjectSceneTag = (project: ProjectSpace, className?: string) => {
  const scene = getProjectScene(project);
  return (
    <Tag
      bordered={false}
      className={classNames(styles.projectTag, styles[`projectTag${scene.classSuffix}`], className)}
    >
      {scene.text}
    </Tag>
  );
};

const getProjectIdFromSaveResponse = (response: any) => {
  // 创建接口有的环境返回 data.projectId，有的请求封装会直接返回 projectId，这里统一兜底取值。
  return `${response?.projectId || response?.id || response?.data?.projectId || response?.data?.id || ''}`;
};

const normalizeProjectName = (name?: string) => trim(name || '');

const getShareMemberUserId = (member: ProjectShareMember | any) =>
  member.userId ?? String(member.id || '').replace(/^user_/, '');

const normalizeProjectMember = (member: ProjectShareMember | any): ProjectShareMember => {
  const userId = getShareMemberUserId(member);
  const userName = member.userName || member.name || `${userId || ''}`;
  return {
    ...member,
    id: member.id || `user_${userId}`,
    type: 'USER',
    userId,
    userCode: member.userCode,
    userName,
    name: userName,
    memberId: member.memberId,
    role: member.role,
  };
};

const syncProjectShareMembers = async (
  projectId: string | number,
  desiredMembers: ProjectShareMember[] = [],
  options: { allowRemove?: boolean } = {}
) => {
  const currentMembers = await listProjectMembers(Number(projectId));
  const currentList = Array.isArray(currentMembers) ? currentMembers : [];
  const currentUserIdSet = new Set(currentList.map((member) => String(member.userId)));
  const desiredMemberMap = new Map<string, ProjectShareMember>();

  desiredMembers.map(normalizeProjectMember).forEach((member) => {
    const userId = getShareMemberUserId(member);
    if (userId) {
      desiredMemberMap.set(String(userId), member);
    }
  });

  const pendingMembers = Array.from(desiredMemberMap.values()).filter(
    (member) => !currentUserIdSet.has(String(getShareMemberUserId(member)))
  );

  await Promise.all(
    pendingMembers.map((member) =>
      addProjectMember({
        projectId: Number(projectId),
        userId: getShareMemberUserId(member),
        userCode: member.userCode,
        userName: member.userName || member.name,
      })
    )
  );

  if (!options.allowRemove) return;

  await Promise.all(
    currentList
      .filter((member) => member.role !== 'owner' && !desiredMemberMap.has(String(member.userId)) && member.memberId)
      .map((member) => removeProjectMember(member.memberId))
  );
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
  const [projectSessionPageMap, setProjectSessionPageMap] = useState<Record<string, ProjectSessionPageState>>({});
  const [sessionMoreLoadingMap, setSessionMoreLoadingMap] = useState<Record<string, boolean>>({});
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectSpace>();
  const [projectCreating, setProjectCreating] = useState(false);
  const [detailProject, setDetailProject] = useState<ProjectSpace>();
  const hasAutoSelectedRef = useRef(false);
  const projectClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProjectClickTimer = useCallback(() => {
    if (!projectClickTimerRef.current) {
      return;
    }
    clearTimeout(projectClickTimerRef.current);
    projectClickTimerRef.current = null;
  }, []);
  const projectSavingRef = useRef(false);

  const mergedProjects = useMemo(() => {
    return projects.map((project) => {
      const cachedProject = projectDetailMap[project.projectId];
      if (!cachedProject) return project;
      return {
        ...cachedProject,
        ...project,
        // 详情页内添加成员会先本地回写共享状态，列表标签需要优先使用详情缓存避免刷新前滞后。
        isShare: cachedProject.isShare,
        sharedFlag: cachedProject.sharedFlag,
        repos: cachedProject.repos,
        shareTargets: cachedProject.shareTargets,
        sessions: cachedProject.sessions,
        sessionCount:
          projectSessionPageMap[project.projectId]?.total ?? project.sessionCount ?? cachedProject.sessionCount,
      };
    });
  }, [projectDetailMap, projectSessionPageMap, projects]);

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
        label: (
          <span className={styles.scopeMenuLabel}>
            <span className={styles.scopeMenuName}>{project.projectName || '未命名项目'}</span>
            {renderProjectSceneTag(project, styles.scopeMenuTag)}
          </span>
        ),
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
      shareMembers: (editingProject.members || []).map(normalizeProjectMember),
    };
  }, [editingProject]);

  const fetchProjectSessions = useCallback(
    async (project: ProjectSpace, options: { force?: boolean; append?: boolean } = {}) => {
      const { force = false, append = false } = options;
      const projectId = project.projectId;
      if (!projectId) return project;
      if (!force && !append && projectSessionPageMap[projectId]) return projectDetailMap[projectId] || project;

      const currentPage = projectSessionPageMap[projectId];
      const nextPageNum = append ? (currentPage?.pageNum || 0) + 1 : 1;
      const setLoadingMap = append ? setSessionMoreLoadingMap : setDetailLoadingMap;
      setLoadingMap((prev) => ({ ...prev, [projectId]: true }));
      try {
        // 展开项目时只查当前项目的会话页，项目列表本身只保留 sessionCount。
        const pageData = await listProjectSessionsByQo(
          {
            projectId: Number(projectId),
            pageNum: nextPageNum,
            pageSize: PROJECT_SESSION_PAGE_SIZE,
          },
          { responseCfg: { hideErrorTips: true } }
        );
        const nextSessions = getArrayData(pageData).map((item) => normalizeProjectSession(item, projectId));
        const total = Number(pageData?.total ?? project.sessionCount ?? nextSessions.length);
        const cachedProject = projectDetailMap[projectId] || project;
        const mergedSessions = append ? mergeProjectSessions(cachedProject.sessions || [], nextSessions) : nextSessions;
        const nextProject = {
          ...cachedProject,
          ...project,
          repos: cachedProject.repos,
          shareTargets: cachedProject.shareTargets,
          sessions: mergedSessions,
          sessionCount: total,
        };
        setProjectDetailMap((prev) => ({ ...prev, [projectId]: nextProject }));
        setProjectSessionPageMap((prev) => ({
          ...prev,
          [projectId]: {
            pageNum: Number(pageData?.pageNum || nextPageNum),
            pageSize: Number(pageData?.pageSize || PROJECT_SESSION_PAGE_SIZE),
            total,
          },
        }));
        return nextProject;
      } catch (error) {
        console.error('Failed to load project sessions:', error);
        message.error('项目会话加载失败');
        return project;
      } finally {
        setLoadingMap((prev) => ({ ...prev, [projectId]: false }));
      }
    },
    [projectDetailMap, projectSessionPageMap]
  );

  const fetchProjectFullDetail = useCallback(
    async (project: ProjectSpace, force = false) => {
      const projectId = project.projectId;
      if (!projectId) return project;
      const cachedProject = projectDetailMap[projectId];
      if (!force && cachedProject?.repos) return cachedProject;

      setDetailLoadingMap((prev) => ({ ...prev, [projectId]: true }));
      try {
        // 详情需要 repos 等完整字段，和左侧会话分页加载分开处理。
        const detail = await getProject(Number(projectId));
        const normalizedProject = normalizeProjectDetail(detail, project) || project;
        const shouldKeepPagedSessions = Boolean(projectSessionPageMap[projectId]);
        const cachedSessions = cachedProject?.sessions || project.sessions || [];
        const nextProject = {
          ...normalizedProject,
          // 详情接口可能带出全量 sessions，左侧会话缓存始终以 session/listByQo 分页结果为准。
          sessions: shouldKeepPagedSessions ? cachedProject?.sessions : cachedSessions,
          sessionCount: shouldKeepPagedSessions
            ? cachedProject?.sessionCount ?? normalizedProject.sessionCount
            : project.sessionCount ?? normalizedProject.sessionCount,
        };
        setProjectDetailMap((prev) => ({ ...prev, [projectId]: nextProject }));
        return nextProject;
      } catch (error) {
        console.error('Failed to load project detail:', error);
        message.error('项目详情加载失败');
        return project;
      } finally {
        setDetailLoadingMap((prev) => ({ ...prev, [projectId]: false }));
      }
    },
    [projectDetailMap, projectSessionPageMap]
  );

  useEffect(() => {
    if (!projects.length) {
      setProjectScopeId(ALL_PROJECT_SCOPE_KEY);
      setActiveProjectId(undefined);
      setExpandedProjectIds([]);
      setProjectSessionPageMap({});
      setSessionMoreLoadingMap({});
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
    // 打开项目空间列表时默认展开第一个项目，让项目卡片和会话列表直接可见。
    setExpandedProjectIds([firstProject.projectId]);
    void fetchProjectSessions(firstProject);
  }, [fetchProjectSessions, projectScopeId, projects]);

  const handleToggleProject = (project: ProjectSpace) => {
    const projectId = project.projectId;
    setActiveProjectId(projectId);
    setExpandedProjectIds((prev) => {
      const isExpanded = prev.includes(projectId);
      if (!isExpanded) {
        void fetchProjectSessions(project);
        // 项目列表按手风琴交互处理：展开当前项目时自动收起其它项目。
        return [projectId];
      }
      return [];
    });
  };

  const handleProjectHeaderClick = (project: ProjectSpace) => {
    clearProjectClickTimer();
    // 区分单击和双击，避免双击详情时触发两次单击导致项目被展开后又折叠。
    projectClickTimerRef.current = setTimeout(() => {
      handleToggleProject(project);
      projectClickTimerRef.current = null;
    }, 220);
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
    void fetchProjectSessions(selectedProject);
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
      setExpandedProjectIds([projectId]);
      void fetchProjectSessions(targetProject, { force: true });
      void fetchProjects();
    },
    [fetchProjectSessions, fetchProjects, mergedProjects]
  );

  useEffect(() => {
    EventEmitter.on('projectSpace-session-bound', handleProjectSessionBound);
    return () => {
      EventEmitter.off('projectSpace-session-bound', handleProjectSessionBound);
    };
  }, [EventEmitter, handleProjectSessionBound]);

  useEffect(() => {
    return () => {
      clearProjectClickTimer();
    };
  }, [clearProjectClickTimer]);

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
    setExpandedProjectIds([newChatProject.projectId]);
    void fetchProjectSessions(newChatProject);
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
    void fetchProjectFullDetail(project, true).then(setDetailProject);
  };

  const handleProjectSharedChange = useCallback(
    (projectId: string | number) => {
      const targetProjectId = `${projectId || ''}`;
      if (!targetProjectId) return;
      const patchSharedProject = (project: ProjectSpace): ProjectSpace => ({
        ...project,
        isShare: 'Y',
        sharedFlag: true,
      });

      // 成员 tab 添加成员后后端会同步 isShare，前端先本地回写，避免详情和标签状态滞后。
      setProjectDetailMap((prev) => {
        const cachedProject =
          prev[targetProjectId] ||
          (detailProject && `${detailProject.projectId}` === targetProjectId ? detailProject : undefined) ||
          projects.find((project) => `${project.projectId}` === targetProjectId);
        if (!cachedProject) return prev;
        return {
          ...prev,
          [targetProjectId]: patchSharedProject(cachedProject),
        };
      });
      setDetailProject((prev) => (prev && `${prev.projectId}` === targetProjectId ? patchSharedProject(prev) : prev));
      void fetchProjects().catch((error) => {
        console.error('Failed to refresh project list after member adding:', error);
      });
    },
    [detailProject, fetchProjects, projects]
  );

  const handleProjectHeaderDoubleClick = (project: ProjectSpace) => {
    clearProjectClickTimer();
    setActiveProjectId(project.projectId);
    handleOpenProjectDetail(project);
  };

  const handleOpenEditProject = (project: ProjectSpace) => {
    const cachedProject = projectDetailMap[project.projectId] || project;
    setEditingProject(cachedProject);
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
          setProjectSessionPageMap((prev) => {
            const next = { ...prev };
            delete next[project.projectId];
            return next;
          });
          setSessionMoreLoadingMap((prev) => {
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
    if (projectSavingRef.current) return;

    const projectName = normalizeProjectName(values.projectName);
    if (!projectName) {
      message.warning('请输入项目名称');
      return;
    }

    const duplicateProject = mergedProjects.find((project) => {
      const isCurrentEditingProject = editingProject && project.projectId === editingProject.projectId;
      return !isCurrentEditingProject && normalizeProjectName(project.projectName) === projectName;
    });
    if (duplicateProject) {
      message.warning('项目名称已存在，请修改后再保存');
      return;
    }

    projectSavingRef.current = true;
    setProjectCreating(true);
    const submitSharedFlag = values.projectType === 'develop' || values.sharedFlag;
    const shareMembers = submitSharedFlag ? values.shareMembers || [] : [];
    try {
      if (editingProject) {
        const updatePayload = {
          projectId: Number(editingProject.projectId),
          projectName,
          description: values.description?.trim(),
          projectType: values.projectType,
          isShare: submitSharedFlag ? 'Y' : 'N',
          shareTargets: [],
        };
        await updateProject(updatePayload);
        if (submitSharedFlag && values.shareMembersLoaded) {
          await syncProjectShareMembers(editingProject.projectId, shareMembers, { allowRemove: true });
        }
        message.success('项目已更新');
        setProjectDetailMap((prev) => ({
          ...prev,
          [editingProject.projectId]: {
            ...(prev[editingProject.projectId] || editingProject),
            projectName,
            description: values.description?.trim(),
            projectType: values.projectType,
            isShare: submitSharedFlag ? 'Y' : 'N',
            sharedFlag: submitSharedFlag,
            members:
              submitSharedFlag && values.shareMembersLoaded
                ? shareMembers.map(normalizeProjectMember)
                : prev[editingProject.projectId]?.members,
            shareTargets: [],
          },
        }));
      } else {
        const res = await createProject({
          projectName,
          description: values.description?.trim(),
          // 新增项目空间只提交当前表单字段。
          projectType: values.projectType,
          isShare: submitSharedFlag ? 'Y' : 'N',
          shareTargets: [],
        });
        const createdProjectId = getProjectIdFromSaveResponse(res);
        if (createdProjectId && submitSharedFlag && shareMembers.length) {
          await syncProjectShareMembers(createdProjectId, shareMembers);
        }
        message.success('项目空间创建成功');
        if (createdProjectId) {
          setActiveProjectId(createdProjectId);
          setProjectScopeId(createdProjectId);
          setExpandedProjectIds([createdProjectId]);
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
      projectSavingRef.current = false;
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

  const handleSessionListScroll = useCallback(
    (project: ProjectSpace, event: React.UIEvent<HTMLDivElement>) => {
      const projectId = project.projectId;
      const sessionPage = projectSessionPageMap[projectId];
      const loadedCount = projectDetailMap[projectId]?.sessions?.length ?? project.sessions?.length ?? 0;
      const total = sessionPage?.total ?? project.sessionCount ?? 0;

      if (!sessionPage || loadedCount >= total || detailLoadingMap[projectId] || sessionMoreLoadingMap[projectId]) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight <= 80) {
        void fetchProjectSessions(project, { append: true });
      }
    },
    [detailLoadingMap, fetchProjectSessions, projectDetailMap, projectSessionPageMap, sessionMoreLoadingMap]
  );

  const renderSessionList = (project: ProjectSpace) => {
    const sessions = sortProjectSessions(project.sessions || []);
    const isLoading = detailLoadingMap[project.projectId];
    const isLoadingMore = sessionMoreLoadingMap[project.projectId];

    if (isLoading) {
      return (
        <div className={styles.sessionSkeleton}>
          <Skeleton active avatar={{ size: 24, shape: 'circle' }} paragraph={{ rows: 1 }} title={false} />
          <Skeleton active avatar={{ size: 24, shape: 'circle' }} paragraph={{ rows: 1 }} title={false} />
        </div>
      );
    }

    if (!sessions.length) {
      return <Empty className={styles.sessionEmpty} image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" />;
    }

    return (
      <>
        {sessions.map((session) => {
          const active = `${sessionId}` === `${session.sessionId}`;
          return (
            <button
              type="button"
              key={session.sessionId}
              className={classNames(styles.sessionItem, active && styles.sessionItemActive)}
              onClick={() => handleOpenSession(project, session)}
            >
              <span className={styles.sessionAvatar}>
                <ChatAvatar session={session as any} size={32} />
              </span>
              <span className={styles.sessionMain}>
                <span className={styles.sessionTextWrap}>
                  <span className={styles.sessionTitle}>{session.sessionName || '未命名会话'}</span>
                  <span className={styles.sessionDesc}>
                    {processSessionContent(session.sessionContent) || '暂无会话摘要'}
                  </span>
                  <span className={styles.sessionTime}>
                    {formatTime(session.updateTime || '', session.createTime || '')}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
        {isLoadingMore && <div className={styles.sessionMoreLoading}>加载中...</div>}
      </>
    );
  };

  return (
    <div className={styles.projectSpaceList}>
      {detailProject ? (
        <ProjectDetailPanel
          project={detailProject}
          onBack={() => setDetailProject(undefined)}
          onEditProject={handleOpenEditProject}
          onProjectSharedChange={handleProjectSharedChange}
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
              overlayClassName={styles.scopeDropdown}
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

                  return (
                    <div
                      key={project.projectId}
                      className={classNames(styles.projectItem, isExpanded && styles.projectItemExpanded)}
                    >
                      <div className={styles.projectTop}>
                        <button
                          type="button"
                          className={styles.projectHeader}
                          onClick={() => handleProjectHeaderClick(project)}
                          onDoubleClick={() => handleProjectHeaderDoubleClick(project)}
                        >
                          <span className={styles.expandIcon}>{isExpanded ? <DownOutlined /> : <RightOutlined />}</span>
                          <span className={styles.projectMain}>
                            <span className={styles.projectTitleRow}>
                              <Tooltip placement="top" title={project.projectName}>
                                <span className={styles.projectName}>{project.projectName || '未命名项目'}</span>
                              </Tooltip>
                            </span>
                          </span>
                          {renderProjectSceneTag(project, styles.projectHeaderTag)}
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
                      {isExpanded && (
                        <div
                          className={styles.sessionList}
                          onScroll={(event) => handleSessionListScroll(project, event)}
                        >
                          {renderSessionList(project)}
                        </div>
                      )}
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
        projectId={editingProject?.projectId}
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
