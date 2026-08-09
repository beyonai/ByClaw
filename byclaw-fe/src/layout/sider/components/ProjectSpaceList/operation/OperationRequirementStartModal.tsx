import React, { useMemo } from 'react';
import { message } from 'antd';
import TaskTemplateModal, { type TaskTemplateApplyResult } from '@/components/TaskTemplateModal';
import type { OperationSelectOption } from './types';

export type OperationRequirementStartTask = {
  title: string;
  description?: string;
  assignee?: string | number;
  dueTime?: string;
  templateId?: number;
  config?: Record<string, unknown>;
};

export interface OperationRequirementStartModalProps {
  open: boolean;
  requirement?: {
    title?: string;
    requirementName?: string;
    description?: string;
    sourceDescription?: string;
    operationType?: string;
    dueTime?: string;
  } | null;

  /** 旧接口仍会传入初始任务，这里只复用其负责人作为模板任务负责人。 */
  initialTasks?: OperationRequirementStartTask[];
  assignees?: OperationSelectOption[];
  agentOptions?: OperationSelectOption[];
  agentGroupOptions?: OperationSelectOption[];
  knowledgeOptions?: OperationSelectOption[];
  ontologyOptions?: OperationSelectOption[];
  accountOptions?: OperationSelectOption[];
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (tasks: OperationRequirementStartTask[]) => void | Promise<void>;
}

/**
 * 启动运营需求只保留模板选择和模板详情填写，避免旧的 AI 拆解表单覆盖模板执行配置。
 * 需求负责人仍作为任务承接成员保存，数字员工则随模板 config 保存并在执行阶段实时校验绑定关系。
 */
const OperationRequirementStartModal: React.FC<OperationRequirementStartModalProps> = ({
  open,
  requirement,
  initialTasks = [],
  assignees = [],
  agentOptions = [],
  agentGroupOptions = [],
  knowledgeOptions = [],
  ontologyOptions = [],
  accountOptions = [],
  loading = false,
  onCancel,
  onSubmit,
}) => {
  const defaultAssignee = useMemo(() => {
    const validAssignee = initialTasks.find((task) =>
      assignees.some((member) => `${member.value}` === `${task.assignee ?? ''}`)
    )?.assignee;
    return validAssignee ?? assignees[0]?.value;
  }, [assignees, initialTasks]);

  const handleApply = async (result: TaskTemplateApplyResult) => {
    if (defaultAssignee === undefined || defaultAssignee === null) {
      message.error('当前项目暂无可用负责人，请先添加项目成员');
      return;
    }

    await onSubmit([
      {
        title: result.values.title.trim(),
        description: result.values.description.trim(),
        assignee: defaultAssignee,
        dueTime: requirement?.dueTime,
        templateId: result.template.templateId,
        // 保留可读提示词和结构化字段，任务执行时优先使用模板提示词。
        config: {
          ...result.values,
          templateType: result.template.templateType,
          templateName: result.template.templateName,
          templatePrompt: result.prompt,
        },
      },
    ]);
  };

  return (
    <TaskTemplateModal
      open={open}
      agentOptions={agentOptions}
      agentOptionsOnly
      agentGroupOptions={agentGroupOptions}
      initialTitle={requirement?.title || requirement?.requirementName}
      initialDescription={requirement?.description || requirement?.sourceDescription}
      knowledgeOptions={knowledgeOptions}
      knowledgeOptionsOnly
      ontologyOptions={ontologyOptions}
      ontologyOptionsOnly
      accountOptions={accountOptions}
      applyText="确定并启动任务"
      applying={loading}
      onCancel={onCancel}
      onApply={handleApply}
    />
  );
};

export default OperationRequirementStartModal;
