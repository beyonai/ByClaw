import { AppstoreOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { getProject } from '@/service/devloop';
import TaskTemplateModal, { type TaskTemplateApplyResult } from '.';

interface Props {
  projectId?: number;
  employees?: Array<Record<string, any>>;
  onApply: (result: TaskTemplateApplyResult) => void;
}

// 任务模板只出现在运营项目会话；项目类型由后端详情确认，避免普通和研发项目误展示入口。
const TaskTemplateEntry: React.FC<Props> = ({ projectId, employees = [], onApply }) => {
  const [visible, setVisible] = useState(false);
  const [operationProject, setOperationProject] = useState(false);

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setOperationProject(false);
      return undefined;
    }
    void getProject(projectId)
      .then((project: any) => {
        if (active) setOperationProject((project?.projectType || project?.type) === 'operation');
      })
      .catch(() => {
        if (active) setOperationProject(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const agentOptions = useMemo(
    () =>
      employees
        .map((employee) => ({
          label: employee.agentName || employee.resourceName || employee.name,
          value: employee.agentId || employee.resourceId || employee.id,
        }))
        .filter((item) => item.label && item.value),
    [employees]
  );

  if (!operationProject) return null;

  return (
    <>
      <Button icon={<AppstoreOutlined />} onClick={() => setVisible(true)}>
        任务模板
      </Button>
      <TaskTemplateModal
        open={visible}
        agentOptions={agentOptions}
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
