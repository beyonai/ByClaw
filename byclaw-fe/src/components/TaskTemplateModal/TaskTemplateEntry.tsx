import { PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Divider, Empty, Modal, Select, Spin, message } from 'antd';
import { getLocale } from '@umijs/max';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { createProject, saveProjectMembers } from '@/service/devloop';
import { useChatResourceProject } from '@/components/ChatLayoutComp/ChatResourceWorkspace/useChatResourceProject';
import useGlobal from '@/hooks/useGlobal';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectScopeId } from '@/pages/projectSpace/hooks/useProjectScopeId';
import { useProjectTypeConfig } from '@/pages/projectSpace/hooks/useProjectTypeConfig';
import ProjectOnboardingWizard from '@/pages/projectSpace/components/ProjectOnboardingWizard';
import type { ProjectFormValues } from '@/pages/projectSpace/components/ProjectFormModal';
import type { ProjectSpace, ProjectType } from '@/pages/projectSpace/types';
import TaskTemplateModal from '.';
import styles from './index.module.less';

interface Props {
  projectId?: number;
  sessionId?: string;
  onApply: (prompt: string) => void;
  onProjectChange?: (project: { projectId: string; projectName: string }) => void;
}

type RecommendedQuestionTemplate = {
  id: string;
  title: string;
  description: string;
  prompt: string;
};

type ProjectOption = Pick<ProjectSpace, 'projectId' | 'projectName'>;

const normalizeProjectType = (projectType?: ProjectType): Exclude<ProjectType, 'default'> => {
  // 默认项目按普通项目处理；会话没有项目归属时 useChatResourceProject 也会解析到默认项目。
  if (projectType === 'operation' || projectType === 'develop') return projectType;
  return 'normal';
};

const PROJECT_TYPE_TITLE: Record<Exclude<ProjectType, 'default'>, string> = {
  // 三类项目统一采用运营项目弹窗的“项目类型 · 选择任务模板”标题格式。
  normal: '普通项目 · 选择任务模板',
  develop: '研发项目 · 选择任务模板',
  operation: '运营项目 · 选择任务模板',
};

const getSavedProjectId = (response: any) =>
  `${response?.projectId || response?.id || response?.data?.projectId || response?.data?.id || ''}`;

// 公共会话输入框统一使用该入口，再按当前会话所属项目类型切换对应模板数据。
const TaskTemplateEntry: React.FC<Props> = ({ projectId, sessionId, onApply, onProjectChange }) => {
  const { EventEmitter } = useGlobal();
  const [visible, setVisible] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectLoading, setCreateProjectLoading] = useState(false);
  const [recommendedQuestions, setRecommendedQuestions] = useState<RecommendedQuestionTemplate[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(false);
  const [createdProjectOption, setCreatedProjectOption] = useState<ProjectOption>();
  const [selectedProjectOverride, setSelectedProjectOverride] = useState<string>();
  const createdProjectNameRef = useRef('');
  const [selectedProjectId, updateProjectScopeId] = useProjectScopeId();
  const { projects, loading: projectsLoading, fetchProjects } = useProjectList();
  const { projectTypeOptions, projectTypeLoading } = useProjectTypeConfig();
  const projectRequestStartedRef = useRef(projectsLoading);
  const [projectListReady, setProjectListReady] = useState(() => projects.length > 0);

  const projectOptions = useMemo(() => {
    const projectMap = new Map<string, ProjectOption>(projects.map((project) => [project.projectId, project]));
    if (createdProjectOption && !projectMap.has(createdProjectOption.projectId)) {
      projectMap.set(createdProjectOption.projectId, createdProjectOption);
    }
    return Array.from(projectMap.values());
  }, [createdProjectOption, projects]);
  const selectedProjectValue = selectedProjectOverride || selectedProjectId;
  const selectedProjectExists = projectOptions.some(
    (project) => `${project.projectId}` === `${selectedProjectValue || ''}`
  );
  const showProjectSelector =
    projectListReady && (!projectOptions.length || !selectedProjectValue || selectedProjectExists);

  useEffect(() => {
    if (projectsLoading) {
      projectRequestStartedRef.current = true;
      return;
    }
    if (projectRequestStartedRef.current || projects.length > 0) {
      setProjectListReady(true);
    }
  }, [projects.length, projectsLoading]);

  useEffect(() => {
    if (sessionId || !selectedProjectValue) return;
    const selectedProject = projectOptions.find((project) => `${project.projectId}` === `${selectedProjectValue}`);
    if (selectedProject) {
      onProjectChange?.({
        projectId: `${selectedProject.projectId}`,
        projectName: selectedProject.projectName,
      });
    }
  }, [onProjectChange, projectOptions, selectedProjectValue, sessionId]);

  useEffect(() => {
    if (!projectOptions.length) return;

    const storedProject = selectedProjectValue
      ? projectOptions.find((project) => `${project.projectId}` === `${selectedProjectValue}`)
      : undefined;
    const nextProject = storedProject || projectOptions[0];
    if (nextProject && `${nextProject.projectId}` !== `${selectedProjectValue || ''}`) {
      updateProjectScopeId(nextProject.projectId);
    }
  }, [projectOptions, selectedProjectValue, updateProjectScopeId]);

  // 任务模板使用会话、项目模块共用的当前项目；项目选择器负责首次默认和本地恢复。
  const sharedProjectId = Number(selectedProjectValue);
  const effectiveProjectId = Number.isFinite(sharedProjectId) && sharedProjectId !== 0 ? sharedProjectId : projectId;
  const { project, loading: projectLoading } = useChatResourceProject(effectiveProjectId);
  const projectType = normalizeProjectType(project?.projectType);
  const projectResources = project?.resources || project?.boundResources || [];

  useEffect(() => {
    // 当前项目切换后关闭并清理旧项目弹窗，避免项目详情加载期间继续展示上一项目类型和资源。
    setVisible(false);
    setRecommendedQuestions([]);
  }, [effectiveProjectId]);

  useEffect(() => {
    if (!visible || projectType !== 'normal') return undefined;
    let active = true;
    setRecommendedLoading(true);
    void getDcSystemConfigListByStandType(
      { standType: 'RECOMMENDED_QUESTIONS' },
      { responseCfg: { hideErrorTips: true } }
    )
      .then((response: any) => {
        if (!active) return;
        const data = response?.data ?? response;
        const rows = Array.isArray(data) ? data : data?.rows || data?.list || [];
        const isEnglish = getLocale().includes('en');
        setRecommendedQuestions(
          rows.map((item: any, index: number) => {
            const title =
              (isEnglish ? item.paramEnName : item.paramName) ||
              item.paramName ||
              item.paramValue ||
              `推荐问题 ${index + 1}`;
            const prompt = (isEnglish ? item.paramDesc : item.paramValue) || item.paramValue || title;
            return {
              id: `${item.paramId ?? index}`,
              title,
              description: prompt,
              prompt,
            };
          })
        );
      })
      .catch(() => {
        if (active) setRecommendedQuestions([]);
      })
      .finally(() => {
        if (active) setRecommendedLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectType, visible]);

  const projectKnowledgeOptions = useMemo(
    () =>
      projectResources
        .filter((resource) => resource.resourceType === 'knowledge')
        .map((resource) => ({
          value: resource.resourceId,
          label: resource.resourceName || `${resource.resourceId}`,
        })),
    [projectResources]
  );
  const projectOntologyOptions = useMemo(
    () =>
      projectResources
        .filter((resource) => resource.resourceType === 'ontology')
        .map((resource) => ({
          value: resource.resourceId,
          label: resource.resourceName || `${resource.resourceId}`,
        })),
    [projectResources]
  );
  const projectAgentOptions = useMemo(
    () =>
      projectResources
        .filter((resource) => resource.resourceType === 'digital_employee')
        .map((resource) => ({
          value: resource.resourceId,
          label: resource.resourceName || `${resource.resourceId}`,
        })),
    [projectResources]
  );

  const applyPrompt = (prompt: string) => {
    onApply(prompt);
    setVisible(false);
    message.success(projectType === 'normal' ? '推荐问题已填入对话框' : '模板内容已生成到对话框，可继续修改后发送');
  };

  const handleCreateProject = async (values: ProjectFormValues) => {
    if (createProjectLoading) return;

    setCreateProjectLoading(true);
    try {
      const sharedFlag = values.projectType === 'develop' || values.projectType === 'operation' || values.sharedFlag;
      const response = await createProject(
        {
          projectName: values.projectName.trim(),
          description: values.description?.trim(),
          projectType: values.projectType,
          isShare: sharedFlag ? 'Y' : 'N',
          shareTargets: [],
          resources: values.resources || [],
        },
        { responseCfg: { hideErrorTips: true } }
      );
      const savedProjectId = getSavedProjectId(response);
      if (!savedProjectId) throw new Error('项目创建失败');

      await saveProjectMembers({
        projectId: Number(savedProjectId),
        userIds: sharedFlag
          ? (values.shareMembers || [])
            .map((member) => member.userId)
            .filter((userId): userId is string | number => Boolean(userId))
          : [],
      });
      const refreshedProjects = await fetchProjects();
      const refreshedProject = refreshedProjects.find((project) => `${project.projectId}` === savedProjectId);
      const createdProject = refreshedProject || {
        projectId: savedProjectId,
        projectName: values.projectName.trim(),
      };
      createdProjectNameRef.current = createdProject.projectName;
      setCreatedProjectOption(createdProject);
      setSelectedProjectOverride(savedProjectId);
      updateProjectScopeId(savedProjectId);
      onProjectChange?.({
        projectId: `${createdProject.projectId}`,
        projectName: createdProject.projectName,
      });
      EventEmitter.emit('projectSpace-list-refresh', { projectId: savedProjectId });
      message.success('项目创建成功');
      return savedProjectId;
    } catch (error: any) {
      message.error(error?.message || '项目创建失败');
      return '';
    } finally {
      setCreateProjectLoading(false);
    }
  };

  const handleCreateWizardFinish = useCallback(
    (createdProjectId: string) => {
      setCreateProjectOpen(false);
      updateProjectScopeId(createdProjectId);
      const createdProject =
        projectOptions.find((project) => `${project.projectId}` === createdProjectId) || createdProjectOption;
      const projectName = createdProject?.projectName || createdProjectNameRef.current;
      if (projectName) {
        onProjectChange?.({
          projectId: createdProjectId,
          projectName,
        });
      }
    },
    [createdProjectOption, onProjectChange, projectOptions, updateProjectScopeId]
  );

  const loadingModal = (
    <Modal
      open={visible}
      width={760}
      centered
      destroyOnClose
      footer={null}
      className={styles.modal}
      title="选择任务模板"
      onCancel={() => setVisible(false)}
    >
      <div className={styles.projectLoading}>
        <Spin />
      </div>
    </Modal>
  );

  return (
    <>
      <div className={styles.taskTemplateTools}>
        {!sessionId && showProjectSelector && (
          <Select
            className={styles.projectSelect}
            showSearch
            loading={projectsLoading}
            value={selectedProjectValue || undefined}
            placeholder="选择项目"
            showArrow
            popupMatchSelectWidth={260}
            optionFilterProp="label"
            options={projectOptions.map((item) => ({
              value: `${item.projectId}`,
              label: item.projectName || '未命名项目',
            }))}
            onChange={(value) => {
              setSelectedProjectOverride(`${value}`);
              updateProjectScopeId(value);
              const selectedProject = projectOptions.find((project) => `${project.projectId}` === `${value}`);
              if (selectedProject) {
                onProjectChange?.({
                  projectId: `${selectedProject.projectId}`,
                  projectName: selectedProject.projectName,
                });
              }
            }}
            aria-label="选择项目"
            dropdownRender={(menu) => (
              <>
                {menu}
                <Divider className={styles.projectSelectDivider} />
                <Button
                  type="text"
                  className={styles.createProjectButton}
                  icon={<PlusOutlined />}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setCreateProjectOpen(true)}
                >
                  新建项目
                </Button>
              </>
            )}
          />
        )}
      </div>
      <ProjectOnboardingWizard
        open={createProjectOpen}
        projectTypeConfigOptions={projectTypeOptions}
        projectTypeLoading={projectTypeLoading}
        onCancel={() => setCreateProjectOpen(false)}
        onCreateProject={handleCreateProject}
        onFinish={handleCreateWizardFinish}
      />
      {projectLoading && !project ? (
        loadingModal
      ) : projectType === 'operation' ? (
        <TaskTemplateModal
          key={`task-template-${effectiveProjectId || 'default'}`}
          open={visible}
          agentOptions={projectAgentOptions}
          agentOptionsOnly
          knowledgeOptions={projectKnowledgeOptions}
          knowledgeOptionsOnly
          ontologyOptions={projectOntologyOptions}
          ontologyOptionsOnly
          categoryLabel="运营项目"
          onCancel={() => setVisible(false)}
          onApply={(result) => applyPrompt(result.prompt)}
        />
      ) : (
        <Modal
          open={visible}
          width={760}
          centered
          destroyOnClose
          footer={null}
          className={styles.modal}
          title={PROJECT_TYPE_TITLE[projectType]}
          onCancel={() => setVisible(false)}
        >
          <Spin spinning={recommendedLoading}>
            {projectType === 'normal' && recommendedQuestions.length ? (
              <div className={styles.templateGrid}>
                {recommendedQuestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.templateCard}
                    onClick={() => applyPrompt(item.prompt)}
                  >
                    <i>{item.title.slice(0, 2)}</i>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <RightOutlined style={{ color: '#b8c1ce' }} />
                  </button>
                ))}
              </div>
            ) : !recommendedLoading ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={projectType === 'develop' ? '暂无可用研发项目任务模板' : '暂无推荐问题'}
              />
            ) : null}
          </Spin>
        </Modal>
      )}
    </>
  );
};

export default TaskTemplateEntry;
