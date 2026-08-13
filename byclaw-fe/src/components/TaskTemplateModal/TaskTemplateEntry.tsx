import { AppstoreOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Empty, Modal, Spin, message } from 'antd';
import { getLocale } from '@umijs/max';
import { useEffect, useMemo, useState } from 'react';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { useChatResourceProject } from '@/components/ChatLayoutComp/ChatResourceWorkspace/useChatResourceProject';
import { useProjectScopeId } from '@/pages/projectSpace/hooks/useProjectScopeId';
import type { ProjectType } from '@/pages/projectSpace/types';
import TaskTemplateModal from '.';
import styles from './index.module.less';

interface Props {
  projectId?: number;
  onApply: (prompt: string) => void;
}

type RecommendedQuestionTemplate = {
  id: string;
  title: string;
  description: string;
  prompt: string;
};

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

// 公共会话输入框统一使用该入口，再按当前会话所属项目类型切换对应模板数据。
const TaskTemplateEntry: React.FC<Props> = ({ projectId, onApply }) => {
  const [visible, setVisible] = useState(false);
  const [recommendedQuestions, setRecommendedQuestions] = useState<RecommendedQuestionTemplate[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(false);
  const [selectedProjectId] = useProjectScopeId();
  // 任务模板使用会话、项目模块共用的当前项目；没有项目空间选择时再回退到当前会话归属。
  const sharedProjectId = Number(selectedProjectId);
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

  return (
    <>
      <Button icon={<AppstoreOutlined />} disabled={projectLoading} onClick={() => setVisible(true)}>
        任务模板
      </Button>
      {projectType === 'operation' ? (
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
                    <RightOutlined />
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
