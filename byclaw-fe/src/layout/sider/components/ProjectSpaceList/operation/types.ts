import type { Dayjs } from 'dayjs';

// 运营模块中的业务主键均兼容后端数字 ID 与字符串 ID，避免不同资源接口之间发生类型转换错误。
export type OperationIdentifier = string | number;

// 运营任务、登录状态和工作流状态为前端统一枚举；接口适配层负责兼容后端的历史取值。
export type OperationTaskType = 'collect' | 'content' | 'analyze';

export type OperationLoginStatus = 'logged_in' | 'logged_out' | 'expired' | 'unknown';

export type OperationCollectionMode = 'once' | 'periodic';

export type OperationAnalysisScope = 'account' | 'works';

export type OperationConfirmationRule = 'manual' | 'auto';

export type OperationWorkflowStatus = 'pending' | 'in_progress' | 'waiting_confirmation' | 'completed' | 'failed';

// 所有下拉选项复用基础结构，keywords 仅供前端筛选，不作为接口提交字段。
export interface OperationSelectOption<T = OperationIdentifier> {
  label: string;
  value: T;
  disabled?: boolean;
  keywords?: string;
}

export interface OperationPlatformOption extends OperationSelectOption<string> {
  mark?: string;
}

// 账号数据既用于账号管理卡片，也用于内容发布和数据分析任务的关联选择。
export interface OperationAccountMetrics {
  followers?: string | number;
  works?: string | number;
  views?: string | number;
  interactions?: string | number;
  followerGrowth?: string | number;
}

export interface OperationAccount {
  id: OperationIdentifier;
  platformId: string;
  accountName: string;
  accountId: string;
  avatar?: string;
  loginStatus?: OperationLoginStatus;
  metrics?: OperationAccountMetrics;
  canEdit?: boolean;
}

export interface OperationAccountFormValues {
  platformId: string;
  accountName: string;
  accountId: string;
}

// 数字员工分为一个总控和多个执行者，表单始终以完整选择对象提交。
export interface OperationAgentOption extends OperationSelectOption<OperationIdentifier> {
  avatar?: string;
  description?: string;
}

export interface OperationAgentSelection {
  controllerAgentId?: OperationIdentifier;
  executorAgentIds?: OperationIdentifier[];
}

export interface OperationDirectoryOption extends OperationSelectOption<OperationIdentifier> {
  knowledgeBaseId?: OperationIdentifier;
}

export interface OperationWorkOption extends OperationSelectOption<OperationIdentifier> {
  accountId?: OperationIdentifier;
}

// 日期范围仅在表单态保存 Dayjs，提交接口前由项目详情容器序列化为字符串。
export type OperationDateRange = [Dayjs | null, Dayjs | null] | null;

// 三类运营任务配置独立声明，避免任务类型切换时将不相干的字段传给后端。
export interface OperationCollectConfig {
  channel?: string;
  accountOrAddress?: string;
  topic?: string;
  dateRange?: OperationDateRange;
  knowledgeBaseId?: OperationIdentifier;
  directoryId?: OperationIdentifier;
  mode?: OperationCollectionMode;
  schedule?: string;
  organize?: boolean;
  organizeTemplateId?: OperationIdentifier;
}

export interface OperationContentConfig {
  contentType?: string;
  publishChannel?: string;
  publishAccountId?: OperationIdentifier;
  topic?: string;
  plannedCount?: number;
  publishSchedule?: string;
  confirmationRule?: OperationConfirmationRule;
}

export interface OperationAnalyzeConfig {
  platformId?: string;
  accountId?: OperationIdentifier;
  scope?: OperationAnalysisScope;
  workIds?: OperationIdentifier[];
  dateRange?: OperationDateRange;
}

export interface OperationTaskFormValues {
  taskName: string;
  description?: string;
  taskType: OperationTaskType;
  assigneeId?: OperationIdentifier;
  dueTime?: Dayjs | null;
  agentSelection?: OperationAgentSelection;
  collectConfig?: OperationCollectConfig;
  contentConfig?: OperationContentConfig;
  analyzeConfig?: OperationAnalyzeConfig;
}

// 任务表单的候选数据全部由容器加载，组件不内置模拟账号、成员或作品数据。
export interface OperationTaskFormOptions {
  assignees?: OperationSelectOption[];
  agents?: OperationAgentOption[];
  collectChannels?: OperationPlatformOption[];
  knowledgeBases?: OperationSelectOption[];
  directories?: OperationDirectoryOption[];
  organizeTemplates?: OperationSelectOption[];
  contentTypes?: OperationSelectOption<string>[];
  publishChannels?: OperationPlatformOption[];
  accounts?: OperationAccount[];
  works?: OperationWorkOption[];
  analysisPlatforms?: OperationPlatformOption[];
}

// 工作流步骤兼容任务详情接口的不同来源字段，时间轴只消费归一后的数据。
export interface OperationWorkflowStep {
  id: OperationIdentifier;
  name: string;
  agentName?: string;
  status: OperationWorkflowStatus;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
}
