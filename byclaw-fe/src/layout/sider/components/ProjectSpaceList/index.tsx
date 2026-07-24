import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Input, Modal, Skeleton, Spin, Tag, Tooltip, message } from 'antd';
import { DownOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import { useDispatch, useIntl, useNavigate, useSelector } from '@umijs/max';
import classNames from 'classnames';
import { trim } from 'lodash';
import useGlobal from '@/hooks/useGlobal';
import ProjectFormModal, {
  type ProjectFormValues,
  type ProjectShareMember,
} from '@/pages/projectSpace/components/ProjectFormModal';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectTypeConfig } from '@/pages/projectSpace/hooks/useProjectTypeConfig';
import {
  createProject,
  deleteProject,
  getProject,
  listProjectSessionsByQo,
  updateProject,
} from '@/pages/projectSpace/service';
import type { ProjectSession, ProjectSpace } from '@/pages/projectSpace/types';
import { getArrayData, normalizeProjectDetail, normalizeProjectSession } from '@/pages/projectSpace/utils';
import { saveProjectMembers } from '@/service/devloop';
import AntdIcon from '@/components/AntdIcon';
import { SiderContentContext } from '../../siderContentContext';
import DialogueCard from '../DialogueList/DialogueCard';
import ProjectDetailPanel from './ProjectDetailModal';
import styles from './index.module.less';

const PROJECT_SESSION_PAGE_SIZE = 30;
// 左侧项目选择仅持久化项目 ID，刷新浏览器后由最新可见项目列表校验并恢复。
const PROJECT_SCOPE_STORAGE_KEY = 'byclaw.projectSpace.selectedProjectId';

type ProjectSessionPageState = {
  pageNum: number;
  pageSize: number;
  total: number;
  keyword?: string;
};

type ProjectSpaceTranslate = (id: string, values?: Record<string, string | number>) => string;

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

const getProjectScene = (project: ProjectSpace, t: ProjectSpaceTranslate) => {
  if (project.projectType === 'default') {
    return { classSuffix: 'Default', text: t('scene.default') };
  }

  // 研发项目即使强制共享，列表也优先展示业务类型标签。
  if (project.projectType === 'develop') {
    return { classSuffix: 'Development', text: t('scene.development') };
  }

  if (project.sharedFlag) {
    return { classSuffix: 'Shared', text: t('scene.shared') };
  }

  return { classSuffix: 'Personal', text: t('scene.personal') };
};

const renderProjectSceneTag = (project: ProjectSpace, t: ProjectSpaceTranslate, className?: string) => {
  const scene = getProjectScene(project, t);
  return (
    <Tag
      bordered={false}
      className={classNames(styles.projectTag, styles[`projectTag${scene.classSuffix}`], className)}
    >
      {scene.text}
    </Tag>
  );
};

const isDefaultProject = (project?: ProjectSpace) => project?.projectType === 'default';

const getStoredProjectScopeId = () => {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY)?.trim() || undefined;
  } catch {
    // 浏览器禁用本地存储时不影响当前会话中的项目切换。
    return undefined;
  }
};

const saveProjectScopeIdToStorage = (projectId?: string | number) => {
  if (typeof window === 'undefined') return;

  try {
    const normalizedProjectId = `${projectId ?? ''}`.trim();
    if (normalizedProjectId) {
      window.localStorage.setItem(PROJECT_SCOPE_STORAGE_KEY, normalizedProjectId);
      return;
    }
    window.localStorage.removeItem(PROJECT_SCOPE_STORAGE_KEY);
  } catch {
    // 浏览器禁用本地存储时不影响当前会话中的项目切换。
  }
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

const syncProjectShareMembers = async (projectId: string | number, desiredMembers: ProjectShareMember[] = []) => {
  const desiredMemberMap = new Map<string, ProjectShareMember>();

  desiredMembers.map(normalizeProjectMember).forEach((member) => {
    const userId = getShareMemberUserId(member);
    if (userId) {
      desiredMemberMap.set(String(userId), member);
    }
  });

  // 共享成员以最终成员数组一次保存，后端统一在事务内计算新增和删除成员。
  await saveProjectMembers({
    projectId: Number(projectId),
    userIds: Array.from(desiredMemberMap.values()).map((member) => getShareMemberUserId(member)),
  });
};

const ProjectSpaceList: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  // 项目侧栏全部静态文案复用同一翻译入口，避免散落的硬编码字符串。
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id: `projectSpace.${id}` }, values),
    [intl]
  );
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { clearDetailPanel } = React.useContext(SiderContentContext);
  const { projects, loading, fetchProjects } = useProjectList();
  // 项目类型配置决定研发闭环能力是否开放，侧栏表单和详情使用同一份结果。
  const { projectTypeOptions, projectTypeLoading, isDevelopProjectEnabled } = useProjectTypeConfig();
  const [projectScopeId, setProjectScopeId] = useState<string | undefined>(() => getStoredProjectScopeId());
  const [sessionKeyword, setSessionKeyword] = useState('');
  const [projectDetailMap, setProjectDetailMap] = useState<Record<string, ProjectSpace>>({});
  const [detailLoadingMap, setDetailLoadingMap] = useState<Record<string, boolean>>({});
  const [projectSessionPageMap, setProjectSessionPageMap] = useState<Record<string, ProjectSessionPageState>>({});
  const [sessionMoreLoadingMap, setSessionMoreLoadingMap] = useState<Record<string, boolean>>({});
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectSpace>();
  const [projectCreating, setProjectCreating] = useState(false);
  const [detailProject, setDetailProject] = useState<ProjectSpace>();
  const [inaccessibleProjectIds, setInaccessibleProjectIds] = useState<Set<string>>(() => new Set());
  const projectSavingRef = useRef(false);
  const sessionSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 新建项目的列表响应可能稍后才返回，期间保留待选 ID，避免被无效本地存储回退逻辑提前清除。
  const pendingCreatedProjectIdRef = useRef<string>();

  const updateProjectScopeId = useCallback((projectId?: string | number) => {
    const normalizedProjectId = `${projectId ?? ''}`.trim();
    // 选中项目与本地存储同步更新，刷新浏览器后可以恢复上次的项目上下文。
    setProjectScopeId(normalizedProjectId || undefined);
    saveProjectScopeIdToStorage(normalizedProjectId);
  }, []);

  const visibleProjects = useMemo(
    () => projects.filter((project) => !inaccessibleProjectIds.has(`${project.projectId}`)),
    [inaccessibleProjectIds, projects]
  );

  const mergedProjects = useMemo(() => {
    return visibleProjects.map((project) => {
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
  }, [projectDetailMap, projectSessionPageMap, visibleProjects]);

  const activeScopeProject = useMemo(() => {
    return mergedProjects.find((project) => project.projectId === projectScopeId);
  }, [mergedProjects, projectScopeId]);

  const scopeTitle = activeScopeProject?.projectName || t('selectProject');
  const currentUserId = userInfo.userId ?? userInfo.id;
  const isProjectCreator = (project?: ProjectSpace) =>
    Boolean(project?.createBy && currentUserId && `${project.createBy}` === `${currentUserId}`);

  const projectScopeMenuItems = useMemo(() => {
    return mergedProjects.map((project) => ({
      key: project.projectId,
      label: (
        <span className={styles.scopeMenuLabel}>
          <span className={styles.scopeMenuName}>{project.projectName || t('unnamedProject')}</span>
          {renderProjectSceneTag(project, t, styles.scopeMenuTag)}
        </span>
      ),
    }));
  }, [mergedProjects, t]);

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
    async (project: ProjectSpace, options: { force?: boolean; append?: boolean; keyword?: string } = {}) => {
      const { force = false, append = false } = options;
      const projectId = project.projectId;
      if (!projectId) return project;
      if (!force && !append && projectSessionPageMap[projectId]) return projectDetailMap[projectId] || project;

      const currentPage = projectSessionPageMap[projectId];
      const nextPageNum = append ? (currentPage?.pageNum || 0) + 1 : 1;
      const queryKeyword = options.keyword ?? currentPage?.keyword ?? '';
      const setLoadingMap = append ? setSessionMoreLoadingMap : setDetailLoadingMap;
      setLoadingMap((prev) => ({ ...prev, [projectId]: true }));
      try {
        // 切换项目或搜索时只查当前项目的会话页，避免一次加载所有项目会话。
        const pageData = await listProjectSessionsByQo(
          {
            projectId: Number(projectId),
            pageNum: nextPageNum,
            pageSize: PROJECT_SESSION_PAGE_SIZE,
            keyword: queryKeyword || undefined,
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
            keyword: queryKeyword,
          },
        }));
        return nextProject;
      } catch (error) {
        console.error('Failed to load project sessions:', error);
        message.error(t('message.sessionLoadFailed'));
        return project;
      } finally {
        setLoadingMap((prev) => ({ ...prev, [projectId]: false }));
      }
    },
    [projectDetailMap, projectSessionPageMap, t]
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
        message.error(t('message.detailLoadFailed'));
        return project;
      } finally {
        setDetailLoadingMap((prev) => ({ ...prev, [projectId]: false }));
      }
    },
    [projectDetailMap, projectSessionPageMap, t]
  );

  useEffect(() => {
    if (!visibleProjects.length) {
      // 无可见项目时仅在状态实际有内容时清理，避免空对象触发 effect 重复更新。
      setProjectScopeId((current) => current || undefined);
      setProjectSessionPageMap((current) => (Object.keys(current).length ? {} : current));
      setSessionMoreLoadingMap((current) => (Object.keys(current).length ? {} : current));
      return;
    }

    if (projectScopeId && inaccessibleProjectIds.has(`${projectScopeId}`)) {
      // 退出当前项目后不允许默认选择逻辑重新选中该项目。
      updateProjectScopeId();
      setSessionKeyword('');
      return;
    }

    if (projectScopeId && !visibleProjects.some((project) => project.projectId === projectScopeId)) {
      if (pendingCreatedProjectIdRef.current === projectScopeId) {
        // 新项目尚未进入列表时继续等待下一次列表刷新，暂不写入或删除本地存储。
        return;
      }
      // 本地保存的项目已删除或无访问权限时清除旧值，随后自动回退到默认项目。
      updateProjectScopeId();
      return;
    }

    if (projectScopeId && pendingCreatedProjectIdRef.current === projectScopeId) {
      // 项目已进入当前可见列表后再持久化，避免缓存尚不可访问的项目 ID。
      pendingCreatedProjectIdRef.current = undefined;
    }

    if (projectScopeId && projectSessionPageMap[projectScopeId]) {
      return;
    }

    const firstProject =
      visibleProjects.find((project) => project.projectId === projectScopeId) ||
      visibleProjects.find(isDefaultProject) ||
      visibleProjects[0];
    updateProjectScopeId(firstProject.projectId);
    setSessionKeyword('');
    // 打开项目模块时默认选择系统默认项目，让会话列表直接可见。
    void fetchProjectSessions(firstProject, { force: true, keyword: '' });
  }, [
    fetchProjectSessions,
    inaccessibleProjectIds,
    projectScopeId,
    projectSessionPageMap,
    updateProjectScopeId,
    visibleProjects,
  ]);

  const handleSelectProjectScope = ({ key }: { key: string }) => {
    if (sessionSearchTimerRef.current) {
      clearTimeout(sessionSearchTimerRef.current);
      sessionSearchTimerRef.current = null;
    }
    // 用户主动切换项目时取消新建项目的等待态，以当前选择为准。
    pendingCreatedProjectIdRef.current = undefined;
    updateProjectScopeId(key);
    const selectedProject = mergedProjects.find((project) => project.projectId === key);
    if (!selectedProject) return;

    // 新建会话尚未落库时，聊天页发送首条消息需要使用下拉框刚切换的项目，而不是新建时的旧路由状态。
    EventEmitter.emit('projectSpace-active-project-change', {
      projectId: selectedProject.projectId,
      projectName: selectedProject.projectName,
    });
    setSessionKeyword('');
    const cachedPage = projectSessionPageMap[key];
    if (cachedPage && !cachedPage.keyword) {
      // 项目会话已按默认条件加载过，切回时直接复用前端缓存。
      void fetchProjectSessions(selectedProject);
      return;
    }
    // 搜索结果不能当作完整缓存使用，切回项目时恢复默认会话列表。
    void fetchProjectSessions(selectedProject, { force: true, keyword: '' });
  };

  const handleProjectSessionBound = useCallback(
    (payload: {
      projectId?: string | number;
      sessionId?: string | number;
      clientRequestId?: string;
      session?: Partial<ProjectSession>;
    }) => {
      const projectId = `${payload?.projectId || ''}`;
      const sessionId = `${payload?.sessionId || ''}`;
      const pendingSessionId = payload?.clientRequestId ? `pending_${payload.clientRequestId}` : '';
      if (!projectId || !sessionId) return;

      if (!payload.session) {
        // 仅新建会话事件携带完整数据；已有会话补绑不覆盖当前侧栏缓存。
        return;
      }

      const targetProject = mergedProjects.find((project) => project.projectId === projectId);
      if (!targetProject) {
        void fetchProjects();
        return;
      }

      const sessionPage = projectSessionPageMap[projectId];
      if (sessionPage?.keyword) {
        // 搜索缓存仅保存命中当前关键词的数据，新会话是否命中未知，不修改该筛选结果。
        return;
      }

      const cachedProject = projectDetailMap[projectId] || targetProject;
      const cachedSessions = cachedProject.sessions || [];
      const alreadyCached = cachedSessions.some((session) => `${session.sessionId}` === sessionId);
      const pendingSession = pendingSessionId
        ? cachedSessions.find((session) => `${session.sessionId}` === pendingSessionId)
        : undefined;
      const createdSession = normalizeProjectSession(
        {
          ...payload.session,
          sessionId,
          projectId,
          sessionName: payload.session?.sessionName || pendingSession?.sessionName || t('newChatName'),
          // 与会话模块新增会话的排序逻辑保持一致，缺少服务端更新时间时置顶展示。
          updateTime: payload.session?.updateTime || new Date().toISOString(),
        },
        projectId
      );
      const isReplacingPendingSession = Boolean(pendingSession);
      const total = Math.max(
        Number(sessionPage?.total ?? cachedProject.sessionCount ?? cachedSessions.length) +
          (alreadyCached || isReplacingPendingSession ? 0 : 1),
        cachedSessions.length + (alreadyCached || isReplacingPendingSession ? 0 : 1)
      );

      // 真实会话创建成功后替换临时会话项，避免列表中同时存在临时 ID 和真实 ID。
      setProjectDetailMap((prev) => {
        const currentProject = prev[projectId] || cachedProject;
        const sessions = mergeProjectSessions(
          (currentProject.sessions || []).filter((session) => `${session.sessionId}` !== pendingSessionId),
          [createdSession]
        );
        return {
          ...prev,
          [projectId]: {
            ...currentProject,
            sessions,
            sessionCount: total,
          },
        };
      });
      setProjectSessionPageMap((prev) => ({
        ...prev,
        [projectId]: {
          pageNum: prev[projectId]?.pageNum || 1,
          pageSize: prev[projectId]?.pageSize || PROJECT_SESSION_PAGE_SIZE,
          total,
          keyword: '',
        },
      }));
    },
    [fetchProjects, mergedProjects, projectDetailMap, projectSessionPageMap, t]
  );

  const handleProjectSessionPending = useCallback(
    (payload: {
      projectId?: string | number;
      clientRequestId?: string;
      sessionName?: string;
      sessionContent?: string;
      updateTime?: string;
    }) => {
      const projectId = `${payload?.projectId || ''}`;
      const clientRequestId = payload?.clientRequestId || '';
      if (!projectId || !clientRequestId) return;

      const targetProject = mergedProjects.find((project) => project.projectId === projectId);
      if (!targetProject) {
        void fetchProjects();
        return;
      }

      const sessionPage = projectSessionPageMap[projectId];
      if (sessionPage?.keyword) {
        // 搜索结果只展示命中项，临时会话不确定是否命中当前关键词，不插入筛选列表。
        return;
      }

      const pendingSessionId = `pending_${clientRequestId}`;
      const cachedProject = projectDetailMap[projectId] || targetProject;
      const cachedSessions = cachedProject.sessions || [];
      if (cachedSessions.some((session) => `${session.sessionId}` === pendingSessionId)) return;

      const pendingSession = normalizeProjectSession(
        {
          sessionId: pendingSessionId,
          projectId,
          sessionName: payload.sessionName || t('newChatName'),
          sessionContent: payload.sessionContent || '',
          updateTime: payload.updateTime || new Date().toISOString(),
        },
        projectId
      );
      const total = Math.max(
        Number(sessionPage?.total ?? cachedProject.sessionCount ?? cachedSessions.length) + 1,
        cachedSessions.length + 1
      );

      setProjectDetailMap((prev) => {
        const currentProject = prev[projectId] || cachedProject;
        return {
          ...prev,
          [projectId]: {
            ...currentProject,
            sessions: mergeProjectSessions(currentProject.sessions || [], [pendingSession]),
            sessionCount: total,
          },
        };
      });
      setProjectSessionPageMap((prev) => ({
        ...prev,
        [projectId]: {
          pageNum: prev[projectId]?.pageNum || 1,
          pageSize: prev[projectId]?.pageSize || PROJECT_SESSION_PAGE_SIZE,
          total,
          keyword: '',
        },
      }));
    },
    [fetchProjects, mergedProjects, projectDetailMap, projectSessionPageMap, t]
  );

  useEffect(() => {
    EventEmitter.on('projectSpace-session-bound', handleProjectSessionBound);
    return () => {
      EventEmitter.off('projectSpace-session-bound', handleProjectSessionBound);
    };
  }, [EventEmitter, handleProjectSessionBound]);

  useEffect(() => {
    EventEmitter.on('projectSpace-session-pending', handleProjectSessionPending);
    return () => {
      EventEmitter.off('projectSpace-session-pending', handleProjectSessionPending);
    };
  }, [EventEmitter, handleProjectSessionPending]);

  useEffect(() => {
    return () => {
      // 组件卸载时清理会话搜索定时器，避免延迟请求落到已销毁的侧栏上。
      if (sessionSearchTimerRef.current) {
        clearTimeout(sessionSearchTimerRef.current);
      }
    };
  }, []);

  const handleOpenCreateProject = () => {
    setEditingProject(undefined);
    setProjectModalOpen(true);
  };

  const handleNewChat = useCallback(() => {
    if (!activeScopeProject?.projectId) {
      message.warning(t('message.selectProjectFirst'));
      return;
    }

    clearDetailPanel?.();
    // 从全局新建会话入口复用当前项目上下文，后续首轮对话会自动完成项目绑定。
    setAgentId?.('');
    setSessionId?.('');
    navigate('/chat', {
      state: {
        keepSiderActiveKey: 'sessions',
        from: 'projectSpace',
        projectId: activeScopeProject.projectId,
        projectName: activeScopeProject.projectName,
      },
    });
  }, [activeScopeProject, clearDetailPanel, navigate, setAgentId, setSessionId, t]);

  useEffect(() => {
    // 全局侧栏加号由当前项目选择器处理，确保新会话绑定到正在查看的项目。
    EventEmitter.on('projectSpace-create-session', handleNewChat);
    return () => {
      EventEmitter.off('projectSpace-create-session', handleNewChat);
    };
  }, [EventEmitter, handleNewChat]);

  const handleOpenProjectDetail = (project: ProjectSpace) => {
    setDetailProject(projectDetailMap[project.projectId] || project);
    // 详情视图占用左侧小列表区域，不弹遮罩，右侧聊天页保持原状态。
    const targetProjectId = `${project.projectId}`;
    void fetchProjectFullDetail(project, true).then((detail) => {
      // 详情请求可能在退出项目或切换详情后才返回，只回写仍处于当前详情的同一项目。
      setDetailProject((current) => (`${current?.projectId || ''}` === targetProjectId ? detail : current));
    });
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

  const handleCurrentUserRemovedFromProject = useCallback(
    (projectId: number) => {
      const targetProjectId = `${projectId || ''}`;
      if (!targetProjectId) return;

      // 退出项目后先从本地可见范围移除，再刷新后端列表，避免接口返回前短暂显示已无权限的项目。
      setInaccessibleProjectIds((prev) => {
        if (prev.has(targetProjectId)) return prev;
        const next = new Set(prev);
        next.add(targetProjectId);
        return next;
      });
      setProjectDetailMap((prev) => {
        const next = { ...prev };
        delete next[targetProjectId];
        return next;
      });
      setDetailLoadingMap((prev) => {
        const next = { ...prev };
        delete next[targetProjectId];
        return next;
      });
      setProjectSessionPageMap((prev) => {
        const next = { ...prev };
        delete next[targetProjectId];
        return next;
      });
      setSessionMoreLoadingMap((prev) => {
        const next = { ...prev };
        delete next[targetProjectId];
        return next;
      });
      setDetailProject((prev) => (`${prev?.projectId || ''}` === targetProjectId ? undefined : prev));
      if (`${projectScopeId || ''}` === targetProjectId) {
        updateProjectScopeId();
        setSessionKeyword('');
      }
      clearDetailPanel?.();
      void fetchProjects().catch((error) => {
        console.error('Failed to refresh project list after leaving project:', error);
      });
    },
    [clearDetailPanel, fetchProjects, projectScopeId, updateProjectScopeId]
  );

  const handleOpenEditProject = (project: ProjectSpace) => {
    if (!isProjectCreator(project)) {
      message.warning(t('message.onlyCreatorCanEdit'));
      return;
    }
    const cachedProject = projectDetailMap[project.projectId] || project;
    setEditingProject(cachedProject);
    setProjectModalOpen(true);
  };

  const handleDeleteProject = (project: ProjectSpace) => {
    if (!isProjectCreator(project)) {
      message.warning(t('message.onlyCreatorCanDelete'));
      return;
    }
    if (isDefaultProject(project)) {
      // 默认项目是系统内置分组，只允许查看和编辑基础信息，不允许删除。
      message.warning(t('message.defaultCannotDelete'));
      return;
    }

    let deleteProjectConfirm: ReturnType<typeof Modal.confirm> | undefined;
    deleteProjectConfirm = Modal.confirm({
      title: t('deleteProject.title'),
      content: t('deleteProject.content', { name: project.projectName || t('unnamedProject') }),
      okText: t('deleteProject.confirm'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProject(Number(project.projectId));
          // 删除接口成功后立即关闭二次确认，再进行提示和非阻塞列表刷新。
          deleteProjectConfirm?.destroy();
          message.success(t('message.deleteSuccess'));
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
            updateProjectScopeId();
            setSessionKeyword('');
            setDetailProject(undefined);
          }
          void fetchProjects();
        } catch (error) {
          console.error('Failed to delete project:', error);
          message.error(t('message.deleteFailed'));
        }
      },
    });
  };

  const handleSessionSearchChange = (value: string) => {
    const nextKeyword = trim(value);
    setSessionKeyword(nextKeyword);
    if (sessionSearchTimerRef.current) {
      clearTimeout(sessionSearchTimerRef.current);
    }

    sessionSearchTimerRef.current = setTimeout(() => {
      const selectedProject = mergedProjects.find((project) => project.projectId === projectScopeId);
      if (selectedProject) {
        // 搜索条件只作用于当前项目的会话，不再过滤项目下拉列表。
        void fetchProjectSessions(selectedProject, { force: true, keyword: nextKeyword });
      }
      sessionSearchTimerRef.current = null;
    }, 300);
  };

  const handleSessionSearchSubmit = () => {
    if (sessionSearchTimerRef.current) {
      clearTimeout(sessionSearchTimerRef.current);
      sessionSearchTimerRef.current = null;
    }
    const selectedProject = mergedProjects.find((project) => project.projectId === projectScopeId);
    if (selectedProject) {
      void fetchProjectSessions(selectedProject, { force: true, keyword: sessionKeyword });
    }
  };

  const handleCreateProject = async (values: ProjectFormValues) => {
    if (projectSavingRef.current) return;

    const projectName = normalizeProjectName(values.projectName);
    if (!projectName) {
      message.warning(t('message.projectNameRequired'));
      return;
    }

    const duplicateProject = mergedProjects.find((project) => {
      const isCurrentEditingProject = editingProject && project.projectId === editingProject.projectId;
      return !isCurrentEditingProject && normalizeProjectName(project.projectName) === projectName;
    });
    if (duplicateProject) {
      message.warning(t('message.projectNameDuplicate'));
      return;
    }

    projectSavingRef.current = true;
    setProjectCreating(true);
    const submitIsDevelopProject = isDevelopProjectEnabled && values.projectType === 'develop';
    // 默认项目固定不共享，研发项目是否强制共享取决于当前环境是否启用研发类型。
    const submitSharedFlag = values.projectType === 'default' ? false : submitIsDevelopProject || values.sharedFlag;
    const shareMembers = submitSharedFlag ? values.shareMembers || [] : [];
    let createdProjectId = '';
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
          await syncProjectShareMembers(editingProject.projectId, shareMembers);
        }
        message.success(t('message.updateSuccess'));
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
        createdProjectId = getProjectIdFromSaveResponse(res);
        if (createdProjectId && submitSharedFlag && shareMembers.length) {
          await syncProjectShareMembers(createdProjectId, shareMembers);
        }
        message.success(t('message.createSuccess'));
      }
      setProjectModalOpen(false);
      setEditingProject(undefined);
      const refreshedProjects = await fetchProjects();
      if (createdProjectId) {
        const createdProject = refreshedProjects.find((project) => `${project.projectId}` === createdProjectId);
        // 新项目已进入下拉数据后优先使用规范化数据；未命中时保留接口 ID，等待后续列表响应补齐。
        const selectedProjectId = createdProject?.projectId || createdProjectId;
        const selectedProjectName = createdProject?.projectName || projectName;
        if (createdProject) {
          updateProjectScopeId(selectedProjectId);
        } else {
          // 列表尚未返回新项目时仅保留当前会话选择，待项目可见后由 effect 写入本地存储。
          pendingCreatedProjectIdRef.current = selectedProjectId;
          setProjectScopeId(selectedProjectId);
        }
        setSessionKeyword('');
        EventEmitter.emit('projectSpace-active-project-change', {
          projectId: selectedProjectId,
          projectName: selectedProjectName,
        });
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      message.error(t(editingProject ? 'message.updateFailed' : 'message.createFailed'));
    } finally {
      projectSavingRef.current = false;
      setProjectCreating(false);
    }
  };

  const handleOpenSession = (project: ProjectSpace, session: ProjectSession) => {
    if (!session.sessionId) {
      message.warning(t('message.sessionIdMissing'));
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

    // 项目会话不一定已在普通会话缓存中，统一补齐后新增或覆盖缓存，保证聊天标题能立即读取名称和头像。
    const sessionCachePayload = {
      ...session,
      sessionId: `${session.sessionId}`,
      sessionName: session.sessionName || t('newChatName'),
      projectId: `${project.projectId}`,
    };

    dispatch({
      type: 'session/addSession',
      payload: sessionCachePayload,
    });

    // addSession 遇到同 ID 会话不会合并字段，额外完整更新一次，避免旧缓存覆盖最新标题。
    dispatch({
      type: 'session/updateSession',
      payload: sessionCachePayload,
    });

    // 项目空间只负责切换会话上下文，右侧仍然复用原聊天页。
    setSessionId?.(`${session.sessionId}`);
    setAgentId?.(session.objectId ? `${session.objectId}` : '');
    navigate('/chat', {
      state: {
        keepSiderActiveKey: 'sessions',
        projectId: project.projectId,
        projectName: project.projectName,
        from: 'projectSpace',
      },
    });
  };

  const handleProjectSessionNameChange = useCallback(
    (project: ProjectSpace, payload: { sessionId: string; sessionName: string }) => {
      const projectId = project.projectId;
      // 编辑时立即回写项目侧栏缓存；接口失败时同一处理器接收旧名称完成回滚。
      const updateSessionName = (sessions: ProjectSession[] = []) =>
        sessions.map((session) =>
          `${session.sessionId}` === `${payload.sessionId}` ? { ...session, sessionName: payload.sessionName } : session
        );

      setProjectDetailMap((prev) => {
        const cachedProject = prev[projectId] || project;
        return {
          ...prev,
          [projectId]: {
            ...cachedProject,
            sessions: updateSessionName(cachedProject.sessions),
          },
        };
      });
      setDetailProject((prev) =>
        prev?.projectId === projectId ? { ...prev, sessions: updateSessionName(prev.sessions) } : prev
      );
    },
    []
  );

  const handleProjectSessionDeleteOptimistic = useCallback((project: ProjectSpace, deletedSession: ProjectSession) => {
    const projectId = project.projectId;
    const sessionId = `${deletedSession.sessionId}`;
    // 删除确认后立即同步项目会话缓存和分页总数，列表无需等待接口响应。
    const removeSession = (sessions: ProjectSession[] = []) =>
      sessions.filter((session) => `${session.sessionId}` !== `${sessionId}`);

    setProjectDetailMap((prev) => {
      const cachedProject = prev[projectId] || project;
      const sessions = removeSession(cachedProject.sessions);
      const removedCount = (cachedProject.sessions || []).length - sessions.length;
      return {
        ...prev,
        [projectId]: {
          ...cachedProject,
          sessions,
          sessionCount: Math.max(
            0,
            Number(cachedProject.sessionCount ?? (cachedProject.sessions || []).length) - removedCount
          ),
        },
      };
    });
    setProjectSessionPageMap((prev) => {
      const sessionPage = prev[projectId];
      if (!sessionPage) return prev;
      return {
        ...prev,
        [projectId]: {
          ...sessionPage,
          total: Math.max(0, sessionPage.total - 1),
        },
      };
    });
    setDetailProject((prev) =>
      prev?.projectId === projectId
        ? {
          ...prev,
          sessions: removeSession(prev.sessions),
          sessionCount: Math.max(0, Number(prev.sessionCount ?? (prev.sessions || []).length) - 1),
        }
        : prev
    );
  }, []);

  const handleProjectSessionDeleteRollback = useCallback((project: ProjectSpace, restoredSession: ProjectSession) => {
    const projectId = project.projectId;
    const sessionId = `${restoredSession.sessionId}`;
    // 删除接口失败时将原会话插回缓存和分页总数，恢复用户确认前的列表状态。
    const restoreSession = (sessions: ProjectSession[] = []) => {
      if (sessions.some((session) => `${session.sessionId}` === sessionId)) return sessions;
      return mergeProjectSessions(sessions, [restoredSession]);
    };

    setProjectDetailMap((prev) => {
      const cachedProject = prev[projectId] || project;
      const alreadyRestored = (cachedProject.sessions || []).some((session) => `${session.sessionId}` === sessionId);
      return {
        ...prev,
        [projectId]: {
          ...cachedProject,
          sessions: restoreSession(cachedProject.sessions),
          sessionCount:
            Number(cachedProject.sessionCount ?? (cachedProject.sessions || []).length) + (alreadyRestored ? 0 : 1),
        },
      };
    });
    setProjectSessionPageMap((prev) => {
      const sessionPage = prev[projectId];
      if (!sessionPage) return prev;
      return {
        ...prev,
        [projectId]: {
          ...sessionPage,
          total: sessionPage.total + 1,
        },
      };
    });
    setDetailProject((prev) => {
      if (prev?.projectId !== projectId) return prev;
      const alreadyRestored = (prev.sessions || []).some((session) => `${session.sessionId}` === sessionId);
      return {
        ...prev,
        sessions: restoreSession(prev.sessions),
        sessionCount: Number(prev.sessionCount ?? (prev.sessions || []).length) + (alreadyRestored ? 0 : 1),
      };
    });
  }, []);

  const handleSessionListScroll = useCallback(
    (project: ProjectSpace, event: React.UIEvent<HTMLDivElement>) => {
      const projectId = project.projectId;
      const sessionPage = projectSessionPageMap[projectId];
      const loadedCount = projectDetailMap[projectId]?.sessions?.length ?? project.sessions?.length ?? 0;
      const total = sessionPage?.total ?? project.sessionCount ?? 0;
      const queryKeyword = sessionPage?.keyword ?? sessionKeyword;

      if (!sessionPage || loadedCount >= total || detailLoadingMap[projectId] || sessionMoreLoadingMap[projectId]) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight <= 80) {
        void fetchProjectSessions(project, { append: true, keyword: queryKeyword });
      }
    },
    [
      detailLoadingMap,
      fetchProjectSessions,
      projectDetailMap,
      projectSessionPageMap,
      sessionKeyword,
      sessionMoreLoadingMap,
    ]
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
      return (
        <Empty className={styles.sessionEmpty} image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('emptySessions')} />
      );
    }

    return (
      <>
        {sessions.map((session) => {
          // 项目会话复用会话模块卡片，保持头像、摘要、时间和选中态一致。
          return (
            <DialogueCard
              key={session.sessionId}
              item={session as any}
              // 项目会话沿用普通会话的编辑、删除操作，悬停时展示标准三点菜单。
              onSelect={(item) => handleOpenSession(project, item as ProjectSession)}
              onSessionEditOptimistic={(payload) => handleProjectSessionNameChange(project, payload)}
              onSessionEditRollback={(payload) => handleProjectSessionNameChange(project, payload)}
              onSessionDeleteOptimistic={(item) =>
                handleProjectSessionDeleteOptimistic(project, item as ProjectSession)
              }
              onSessionDeleteRollback={(item) => handleProjectSessionDeleteRollback(project, item as ProjectSession)}
            />
          );
        })}
        {isLoadingMore && <div className={styles.sessionMoreLoading}>{t('loading')}</div>}
      </>
    );
  };

  return (
    <div className={styles.projectSpaceList}>
      {detailProject ? (
        <ProjectDetailPanel
          project={detailProject}
          onBack={() => setDetailProject(undefined)}
          onEditProject={isProjectCreator(detailProject) ? handleOpenEditProject : undefined}
          onDeleteProject={isProjectCreator(detailProject) ? handleDeleteProject : undefined}
          onProjectSharedChange={handleProjectSharedChange}
          onCurrentUserRemoved={handleCurrentUserRemovedFromProject}
          developProjectEnabled={isDevelopProjectEnabled}
        />
      ) : (
        <>
          <div className={styles.header}>
            <div className={styles.scopeActionRow}>
              <Dropdown
                trigger={['click']}
                overlayClassName={styles.scopeDropdown}
                menu={{
                  items: projectScopeMenuItems,
                  selectedKeys: projectScopeId ? [projectScopeId] : [],
                  onClick: handleSelectProjectScope,
                }}
              >
                <button type="button" className={styles.scopeRow}>
                  <span className={styles.scopeTitle}>{scopeTitle}</span>
                  {/* 项目下拉只保留切换箭头，不展示会话数量统计。 */}
                  <span className={styles.scopeMeta}>
                    <DownOutlined />
                  </span>
                </button>
              </Dropdown>
              <Tooltip title={t('createProject')} placement="top">
                {/* 右侧仅保留新建项目入口，项目详情由下方快捷入口承载。 */}
                <Button className={styles.newProjectButton} icon={<PlusOutlined />} onClick={handleOpenCreateProject} />
              </Tooltip>
            </div>
            {activeScopeProject && (
              <button
                type="button"
                className={styles.enterProjectDetail}
                onClick={() => void handleOpenProjectDetail(activeScopeProject)}
              >
                {/* 使用笔记本图标，保持与员工侧栏“发现数字员工”一致的整行快捷入口结构。 */}
                <AntdIcon className={styles.enterProjectDetailIcon} type="icon-a-Notebook-onebijiben" />
                <span className={styles.enterProjectDetailText}>{t('enterProjectDetail')}</span>
                <AntdIcon className={styles.enterProjectDetailArrow} type="icon-a-Rightyou" />
              </button>
            )}
            {/* 会话搜索紧接项目详情入口，且始终只查询当前选中的项目。 */}
            <div className={styles.searchInput}>
              <Input
                value={sessionKeyword}
                suffix={<SearchOutlined onClick={handleSessionSearchSubmit} />}
                placeholder={t('searchPlaceholder')}
                onChange={(event) => handleSessionSearchChange(event.target.value)}
                onPressEnter={handleSessionSearchSubmit}
              />
            </div>
          </div>

          <Spin spinning={loading} wrapperClassName={styles.spin}>
            <div
              className={styles.projectList}
              onScroll={activeScopeProject ? (event) => handleSessionListScroll(activeScopeProject, event) : undefined}
            >
              {activeScopeProject ? (
                renderSessionList(activeScopeProject)
              ) : (
                <div className={styles.emptyWrap}>
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('emptyProjects')} />
                </div>
              )}
            </div>
          </Spin>
        </>
      )}

      <ProjectFormModal
        open={projectModalOpen}
        title={editingProject ? t('editProject') : t('createProject')}
        loading={projectCreating}
        initialValues={projectFormInitialValues}
        projectId={editingProject?.projectId}
        creatorId={editingProject?.createBy}
        projectTypeConfigOptions={projectTypeOptions}
        projectTypeLoading={projectTypeLoading}
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
