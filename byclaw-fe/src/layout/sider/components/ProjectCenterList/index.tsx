import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Spin, Tooltip, message } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import classNames from 'classnames';
import useGlobal from '@/hooks/useGlobal';
import { createProject, saveDefaultAgent, saveProjectMembers } from '@/service/devloop';
import ProjectOnboardingWizard, {
  type ArchitectChatTarget,
} from '@/pages/projectSpace/components/ProjectOnboardingWizard';
import { setAgentCache } from '@/components/QueryInput/RichInput/agentCache';
import getElementData from '@/components/QueryInput/RichInput/utils/getElementData';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';
import { agentTypeMap } from '@/constants/agent';
import type { ProjectFormValues, ProjectShareMember } from '@/pages/projectSpace/components/ProjectFormModal';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectTypeConfig } from '@/pages/projectSpace/hooks/useProjectTypeConfig';
import { getStoredProjectScopeId, saveProjectScopeIdToStorage } from '@/pages/projectSpace/constants';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import styles from './index.module.less';

const getProjectIdFromResponse = (response: any) =>
  `${response?.projectId || response?.id || response?.data?.projectId || response?.data?.id || ''}`;

// 请求层可能以字符串、Error 或响应对象 reject，统一优先提取后端返回的 msg。
const getProjectMutationErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, any>;
    return (
      record.msg ||
      record.data?.msg ||
      record.response?.data?.msg ||
      record.message ||
      record.response?.data?.message ||
      fallback
    );
  }
  return fallback;
};

const normalizeMemberId = (member: ProjectShareMember | any) =>
  member?.userId ?? String(member?.id || '').replace(/^user_/, '');

const getProjectTypeClassName = (project: ProjectSpace) => {
  if (project.projectType === 'develop') return styles.projectDevelop;
  if (project.projectType === 'operation') return styles.projectOperation;
  if (project.projectType === 'default') return styles.projectDefault;
  return project.sharedFlag ? styles.projectShared : styles.projectNormal;
};

// 项目头像直接展示业务类型，研发和运营项目优先于共享属性，普通共享项目显示“共享”。
const getProjectTypeAvatarText = (project: ProjectSpace) => {
  if (project.projectType === 'develop') return '研发';
  if (project.projectType === 'operation') return '运营';
  if (project.sharedFlag) return '共享';
  return '普通';
};

// 项目主菜单的左侧列表只负责项目切换和新建；
// 原会话菜单的项目分组与会话操作保持不变。
const ProjectCenterList: React.FC = () => {
  const intl = useIntl();
  const location = useLocation();
  const navigate = useNavigate();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { projects, loading, keyword, setKeyword, fetchProjects } = useProjectList();
  const { projectTypeOptions, projectTypeLoading } = useProjectTypeConfig();
  const [createWizardOpen, setCreateWizardOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const createdProjectNameRef = React.useRef('');
  const queryProjectId = useMemo(
    () => new URLSearchParams(location.search).get('projectId') || getStoredProjectScopeId(),
    [location.search]
  );

  const selectProject = useCallback(
    (project: ProjectSpace) => {
      const projectId = `${project.projectId}`;
      saveProjectScopeIdToStorage(projectId);
      EventEmitter.emit('projectSpace-active-project-change', {
        projectId,
        projectName: project.projectName,
      });
      navigate(`/projectSpace?projectId=${encodeURIComponent(projectId)}`);
    },
    [EventEmitter, navigate]
  );

  useEffect(() => {
    const refresh = () => {
      void fetchProjects();
    };
    EventEmitter.on('projectSpace-list-refresh', refresh);
    return () => EventEmitter.off('projectSpace-list-refresh', refresh);
  }, [EventEmitter, fetchProjects]);

  const handleCreateProject = useCallback(
    async (values: ProjectFormValues): Promise<string> => {
      if (createLoading) return '';
      setCreateLoading(true);
      createdProjectNameRef.current = values.projectName.trim();
      const isShared = values.projectType === 'develop' || values.projectType === 'operation' || values.sharedFlag;
      try {
        const response = await createProject(
          {
            projectName: values.projectName.trim(),
            description: values.description?.trim(),
            projectType: values.projectType,
            isShare: isShared ? 'Y' : 'N',
            shareTargets: [],
            resources: values.resources || [],
          },
          { responseCfg: { hideErrorTips: true } }
        );
        const projectId = getProjectIdFromResponse(response);
        if (!projectId) throw new Error('项目创建成功但未返回项目 ID');

        if (isShared && values.shareMembers?.length) {
          await saveProjectMembers({
            projectId: Number(projectId),
            userIds: values.shareMembers.map(normalizeMemberId).filter(Boolean),
          });
        }
        if (values.projectType === 'develop' && values.defaultAgents) {
          await saveDefaultAgent({ ...values.defaultAgents, projectId: Number(projectId) });
        }

        message.success(intl.formatMessage({ id: 'projectSpace.message.createSuccess' }));
        // 新建完成后清空项目搜索，确保新项目立即出现在左侧列表并高亮。
        setKeyword('');
        await fetchProjects('');
        EventEmitter.emit('projectSpace-list-refresh');
        return projectId;
      } catch (error: any) {
        message.error(
          getProjectMutationErrorMessage(
            error,
            intl.formatMessage({ id: 'projectSpace.message.createFailed', defaultMessage: '创建项目失败' })
          )
        );
        return '';
      } finally {
        setCreateLoading(false);
      }
    },
    [EventEmitter, createLoading, fetchProjects, intl, setKeyword]
  );

  const handleCreateWizardFinish = useCallback(
    (projectId: string) => {
      setCreateWizardOpen(false);
      saveProjectScopeIdToStorage(projectId);
      EventEmitter.emit('projectSpace-active-project-change', {
        projectId,
        projectName: createdProjectNameRef.current,
      });
      navigate(`/projectSpace?projectId=${encodeURIComponent(projectId)}`);
    },
    [EventEmitter, navigate]
  );

  const handleEnterArchitectChat = useCallback(
    (projectId: string, architect?: ArchitectChatTarget) => {
      setCreateWizardOpen(false);
      // 架构员工是项目维度的,不在 redux 员工列表里,useDefaultAgentElement 查不到就兜底成「AI 助手」。
      // agentCache 在那个 hook 里优先于 redux 查表,所以先把整份员工写进去再跳。
      if (architect?.agentId && architect.agentName) {
        setAgentCache(
          getElementData(ResourceType.digitalEmployee, {
            agentId: architect.agentId,
            name: architect.agentName,
            agentType: agentTypeMap.agent,
          })
        );
      }
      // 与项目详情页「查看会话」同一套:置全局会话上下文才是真正打开那条会话。
      // 置空会落到空白新会话,且聊天页的 @ 恢复要等全局会话与 state.sessionId 对上才触发。
      setAgentId?.(architect?.agentId || '');
      setSessionId?.(architect?.sessionId || '');
      // 带上后端下发初始化时建的会话ID,直达架构助理那条会话;缺省才新开。
      navigate('/chat', {
        state: {
          keepSiderActiveKey: 'sessions',
          from: 'projectSpace',
          projectId,
          projectName: createdProjectNameRef.current,
          sessionId: architect?.sessionId,
          // 聊天页据此在挂载后恢复 @ 员工。不能在这里直接 setAgentId:
          // ChatLayoutComp 挂载时会按「无会话员工」清空一次,早设的值会被抹掉。
          selectedAgentId: architect?.agentId,
          selectedAgentObjectType: architect?.agentId ? 'DigEmployee' : undefined,
        },
      });
    },
    [navigate, setAgentId, setSessionId]
  );

  return (
    <div className={styles.projectCenterList}>
      <div className={styles.header}>
        <Input
          allowClear
          value={keyword}
          prefix={<SearchOutlined />}
          placeholder={intl.formatMessage({ id: 'projectSpace.projectSearchPlaceholder' })}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Tooltip title={intl.formatMessage({ id: 'projectSpace.createProject' })} placement="top">
          {/* 与会话模块的项目下拉框一致，新建入口使用搜索框右侧的轻量图标按钮。 */}
          <Button
            className={styles.newProjectButton}
            icon={<PlusOutlined />}
            aria-label={intl.formatMessage({ id: 'projectSpace.createProject' })}
            onClick={() => setCreateWizardOpen(true)}
          />
        </Tooltip>
      </div>

      <Spin spinning={loading} className={styles.loading}>
        <div className={styles.list}>
          {projects.length ? (
            projects.map((project) => {
              const projectId = `${project.projectId}`;
              const isActive = projectId === queryProjectId;
              return (
                <button
                  type="button"
                  key={projectId}
                  className={classNames(styles.projectItem, isActive && styles.projectItemActive)}
                  onClick={() => selectProject(project)}
                >
                  <span className={classNames(styles.projectIcon, getProjectTypeClassName(project))}>
                    {getProjectTypeAvatarText(project)}
                  </span>
                  <span className={styles.projectMain}>
                    <strong>{project.projectName}</strong>
                    <small>
                      {project.description || intl.formatMessage({ id: 'projectSpace.projectCard.emptyDescription' })}
                    </small>
                  </span>
                </button>
              );
            })
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'projectSpace.emptyProjects' })}
            />
          )}
        </div>
      </Spin>

      <ProjectOnboardingWizard
        open={createWizardOpen}
        projectTypeConfigOptions={projectTypeOptions}
        projectTypeLoading={projectTypeLoading}
        onCancel={() => setCreateWizardOpen(false)}
        onCreateProject={handleCreateProject}
        onFinish={handleCreateWizardFinish}
        onEnterArchitectChat={handleEnterArchitectChat}
      />
    </div>
  );
};

export default ProjectCenterList;
