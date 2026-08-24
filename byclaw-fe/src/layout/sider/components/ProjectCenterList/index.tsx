import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Spin, Tag, Tooltip, message } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import useGlobal from '@/hooks/useGlobal';
import { createProject, saveProjectMembers } from '@/service/devloop';
import ProjectOnboardingWizard from '@/pages/projectSpace/components/ProjectOnboardingWizard';
import type { ProjectFormValues, ProjectShareMember } from '@/pages/projectSpace/components/ProjectFormModal';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectScopeId } from '@/pages/projectSpace/hooks/useProjectScopeId';
import { useProjectTypeConfig } from '@/pages/projectSpace/hooks/useProjectTypeConfig';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import { getProjectTagMeta } from '@/pages/projectSpace/utils';
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

// 项目主菜单的左侧列表只负责项目切换和新建；
// 原会话菜单的项目分组与会话操作保持不变。
const ProjectCenterList: React.FC = () => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const { projects, loading, keyword, setKeyword, fetchProjects } = useProjectList();
  const { projectTypeOptions, projectTypeLoading } = useProjectTypeConfig();
  const [createWizardOpen, setCreateWizardOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const createdProjectNameRef = React.useRef('');
  const [projectScopeId, updateProjectScopeId] = useProjectScopeId();

  const selectProject = useCallback(
    (project: ProjectSpace) => {
      const projectId = `${project.projectId}`;
      updateProjectScopeId(projectId);
      EventEmitter.emit('projectSpace-active-project-change', {
        projectId,
        projectName: project.projectName,
      });
    },
    [EventEmitter, updateProjectScopeId]
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
        if (!projectId) throw new Error(intl.formatMessage({ id: 'projectSpace.message.createFailed' }));

        if (isShared && values.shareMembers?.length) {
          await saveProjectMembers({
            projectId: Number(projectId),
            userIds: values.shareMembers.map(normalizeMemberId).filter(Boolean),
          });
        }
        message.success(intl.formatMessage({ id: 'projectSpace.message.createSuccess' }));
        // 创建接口返回项目 ID 后立即切换当前项目；研发项目后续即使仍停留在仓库/初始化步骤，
        // 关闭向导时也会保持选中新项目，不再回落到创建前的项目。
        updateProjectScopeId(projectId);
        EventEmitter.emit('projectSpace-active-project-change', {
          projectId,
          projectName: createdProjectNameRef.current,
        });
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
    [EventEmitter, createLoading, fetchProjects, intl, setKeyword, updateProjectScopeId]
  );

  const handleCreateWizardFinish = useCallback(
    (projectId: string) => {
      setCreateWizardOpen(false);
      updateProjectScopeId(projectId);
      EventEmitter.emit('projectSpace-active-project-change', {
        projectId,
        projectName: createdProjectNameRef.current,
      });
    },
    [EventEmitter, updateProjectScopeId]
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
              const isActive = projectId === projectScopeId;
              const projectTag = getProjectTagMeta(project);
              return (
                <button
                  type="button"
                  key={projectId}
                  className={classNames(styles.projectItem, isActive && styles.projectItemActive)}
                  onClick={() => selectProject(project)}
                >
                  <span className={styles.projectMain}>
                    <span className={styles.projectTitleRow}>
                      <Tag
                        bordered={false}
                        className={classNames(styles.projectTag, styles[`projectTag${projectTag.classSuffix}`])}
                      >
                        {intl.formatMessage({ id: projectTag.messageId })}
                      </Tag>
                      <strong>{project.projectName}</strong>
                    </span>
                    <small>{project.description || '-'}</small>
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
      />
    </div>
  );
};

export default ProjectCenterList;
