import { ApartmentOutlined, BugOutlined, CodeOutlined, FileTextOutlined, MessageOutlined } from '@ant-design/icons';

// 研发任务的四角色类型对照后端 DevloopTaskType：会话表没有类型列，后端按各创建链路的关联行反查得出。
// 与运营任务的 operationType 是两套独立枚举，不能互相兜底。
// 三个任务入口(项目详情弹窗、任务 Tab、整体任务视图看板)共用这份映射，避免各自抄一遍后出现图标不一致。
export const DEVLOOP_TASK_TYPES = ['architect', 'requirement', 'coder', 'tester', 'chat'] as const;

export type DevloopTaskType = (typeof DEVLOOP_TASK_TYPES)[number];

// 类型只靠图标表达而非标签：三个入口的卡片头部都已有状态标签和操作入口，再塞标签会挤掉任务名。
const DEVLOOP_TASK_TYPE_ICONS: Record<DevloopTaskType, React.ReactNode> = {
  architect: <ApartmentOutlined />,
  requirement: <FileTextOutlined />,
  coder: <CodeOutlined />,
  tester: <BugOutlined />,
  chat: <MessageOutlined />,
};

// 未知取值不猜：后端新增类型时宁可回退成各入口的默认图标，也不要显示成错的那一类。
export const normalizeDevloopTaskType = (task: any): DevloopTaskType | undefined => {
  const taskType = `${task?.taskType || ''}`.trim().toLowerCase();
  return DEVLOOP_TASK_TYPES.find((type) => type === taskType);
};

export const getDevloopTaskTypeIcon = (taskType?: DevloopTaskType): React.ReactNode =>
  taskType ? DEVLOOP_TASK_TYPE_ICONS[taskType] : undefined;

// 三个入口共用同一组文案 key，翻译只维护一份。
export const getDevloopTaskTypeLabelId = (taskType: DevloopTaskType): string =>
  `projectSpace.detail.task.type.${taskType}`;
