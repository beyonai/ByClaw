import { AppstoreOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import { useEffect, useState } from 'react';
import { getProject } from '@/service/devloop';
import TaskTemplateModal, { type TaskTemplateApplyResult } from '.';

interface Props {
  projectId?: number;
  employees?: Array<Record<string, any>>;
  onApply: (result: TaskTemplateApplyResult) => void;
}

// 任务模板只出现在运营项目会话；项目类型由后端详情确认，避免普通和研发项目误展示入口。
const TaskTemplateEntry: React.FC<Props> = ({ projectId, onApply }) => {
  const [visible, setVisible] = useState(false);
  const [operationProject, setOperationProject] = useState(false);
  const [projectKnowledgeOptions, setProjectKnowledgeOptions] = useState<Array<{ label: string; value: string | number }>>(
    []
  );
  const [projectOntologyOptions, setProjectOntologyOptions] = useState<Array<{ label: string; value: string | number }>>(
    []
  );
  const [projectAgentOptions, setProjectAgentOptions] = useState<Array<{ label: string; value: string | number }>>([]);

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setOperationProject(false);
      return undefined;
    }
    void getProject(projectId)
      .then((project: any) => {
        if (!active) return;
        setOperationProject((project?.projectType || project?.type) === 'operation');
        setProjectKnowledgeOptions(
          (project?.resources || project?.boundResources || [])
            .filter((resource: any) => resource.resourceType === 'knowledge')
            .map((resource: any) => ({
              value: resource.resourceId,
              label: resource.resourceName || `${resource.resourceId}`,
            }))
        );
        setProjectOntologyOptions(
          (project?.resources || project?.boundResources || [])
            .filter((resource: any) => resource.resourceType === 'ontology')
            .map((resource: any) => ({
              value: resource.resourceId,
              label: resource.resourceName || `${resource.resourceId}`,
            }))
        );
        setProjectAgentOptions(
          (project?.resources || project?.boundResources || [])
            .filter((resource: any) => resource.resourceType === 'digital_employee')
            .map((resource: any) => ({
              value: resource.resourceId,
              label: resource.resourceName || `${resource.resourceId}`,
            }))
        );
      })
      .catch(() => {
        if (active) {
          setOperationProject(false);
          setProjectKnowledgeOptions([]);
          setProjectOntologyOptions([]);
          setProjectAgentOptions([]);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (!operationProject) return null;

  return (
    <>
      <Button icon={<AppstoreOutlined />} onClick={() => setVisible(true)}>
        任务模板
      </Button>
      <TaskTemplateModal
        open={visible}
        agentOptions={projectAgentOptions}
        agentOptionsOnly
        knowledgeOptions={projectKnowledgeOptions}
        knowledgeOptionsOnly
        ontologyOptions={projectOntologyOptions}
        ontologyOptionsOnly
        onCancel={() => setVisible(false)}
        onApply={(result) => {
          onApply(result);
          setVisible(false);
          message.success('模板内容已生成到对话框，可继续修改后发送');
        }}
      />
    </>
  );
};

export default TaskTemplateEntry;
