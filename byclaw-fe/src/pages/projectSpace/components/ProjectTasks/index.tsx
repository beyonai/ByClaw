import {
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import dayjs from 'dayjs';
import {
  deleteOperationTask,
  executeOperationTask,
  getOperationTask,
  listOperationTasks,
  listProjectMembers,
  listTasks,
  updateOperationTask,
  type DevloopTaskItem,
} from '@/service/devloop';
import TaskTemplateModal, { type TaskTemplateApplyResult } from '@/components/TaskTemplateModal';
import type { ProjectSession, ProjectSpace } from '../../types';
import { getArrayData, getPageTotal } from '../../utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import styles from '../../index.module.less';
import SessionOverviewDrawer from '@/layout/sider/components/ProjectSpaceList/SessionOverviewDrawer';
import {
  getDevloopTaskTypeIcon,
  getDevloopTaskTypeLabelId,
  normalizeDevloopTaskType,
  type DevloopTaskType,
} from '@/layout/sider/components/ProjectSpaceList/devloopTaskType';
import TaskDetailDrawer from '@/layout/sider/components/ProjectSpaceList/TaskDetailDrawer';
import { isCurrentUserTaskAssignee } from '@/layout/sider/components/ProjectSpaceList/taskAccess';

interface Props {
  project: ProjectSpace;
  keyword?: string;
  onOpenSession?: (session: ProjectSession) => void;
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;
}

const PAGE_SIZE = 30;

const normalizeTaskStatus = (task: DevloopTaskItem) => {
  const label = `${task.statusLabel || ''}`.trim().toLowerCase();
  if (label.includes('混合') || label.includes('部分失败')) return 'mixed';
  if (label.includes('进行中') || label.includes('运行')) return 'in_progress';
  if (label.includes('已完成') || label.includes('完成')) return 'completed';
  if (label.includes('失败')) return 'failed';
  if (label.includes('暂停')) return 'paused';
  if (label.includes('待开始') || label.includes('待启动') || label.includes('待处理')) return 'pending';
  // 运营任务列表同时存在 status、operationState、taskStatus、currentStatus 多套历史字段，
  // 统一回退读取，确保待开始任务能够显示启动按钮。
  return `${
    task.status ||
    (task as any).operationState ||
    (task as any).taskStatus ||
    (task as any).currentStatus ||
    task.statusLabel ||
    ''
  }`
    .trim()
    .toLowerCase();
};

// 任务接口在不同项目类型下可能返回 todo/doing 或 pending/in_progress 等编码，
// 卡片统一按详情页已有的国际化文案展示，避免把后端状态码直接呈现给用户。
const getTaskStatusLabel = (task: DevloopTaskItem, intl: ReturnType<typeof useIntl>) => {
  const status = normalizeTaskStatus(task);
  const statusMessageId: Record<string, string> = {
    todo: 'projectSpace.detail.task.status.pending',
    pending: 'projectSpace.detail.task.status.pending',
    not_started: 'projectSpace.detail.task.status.pending',
    waiting: 'projectSpace.detail.task.status.pending',
    doing: 'projectSpace.detail.task.status.inProgress',
    running: 'projectSpace.detail.task.status.inProgress',
    in_progress: 'projectSpace.detail.task.status.inProgress',
    paused: 'projectSpace.detail.task.status.paused',
    waiting_confirmation: 'projectSpace.detail.task.status.waitingConfirmation',
    done: 'projectSpace.detail.task.status.completed',
    completed: 'projectSpace.detail.task.status.completed',
    failed: 'projectSpace.detail.task.status.failed',
    mixed: 'projectSpace.detail.task.status.mixed',
  };
  const messageId = statusMessageId[status];
  return messageId ? intl.formatMessage({ id: messageId }) : task.statusLabel || '';
};

// 四角色各配一组图标配色，与项目详情弹窗的任务卡同一套色值。
const TASK_TYPE_ICON_CLASSES: Record<DevloopTaskType, string> = {
  architect: styles.taskTypeIconArchitect,
  requirement: styles.taskTypeIconRequirement,
  coder: styles.taskTypeIconCoder,
  tester: styles.taskTypeIconTester,
  chat: styles.taskTypeIconChat,
};

const getTaskStatusColor = (task: DevloopTaskItem) => {
  const status = normalizeTaskStatus(task);
  if (['done', 'completed', '完成', '已完成'].includes(status)) return 'success';
  if (['doing', 'running', 'in_progress', '进行中'].includes(status)) return 'processing';
  if (['failed', '失败'].includes(status)) return 'error';
  if (['paused', 'mixed', '暂停'].includes(status)) return 'warning';
  // 待开始使用橙黄色，进行中使用蓝色，避免两个状态都呈现为蓝色难以区分。
  return 'warning';
};

const getTaskStatusOrder = (task: DevloopTaskItem) => {
  const status = normalizeTaskStatus(task);
  if (
    ['done', 'completed', 'finished', 'success', 'failed', 'error', 'cancelled', '完成', '已完成', '失败'].includes(
      status
    )
  ) {
    return 2;
  }
  if (
    [
      'doing',
      'running',
      'in_progress',
      'paused',
      'waiting_confirmation',
      'mixed',
      'processing',
      'started',
      '进行中',
      '暂停',
    ].includes(status)
  ) {
    return 1;
  }
  // todo、pending、not_started、waiting 及历史空状态均视为待开始。
  return 0;
};

const getTaskCreateTime = (task: DevloopTaskItem) => {
  const value = task.createTime || (task as any).createdAt || (task as any).createDate;
  if (!value) return 0;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.valueOf() : 0;
};

const formatTaskCreateTime = (task: DevloopTaskItem) => {
  const timestamp = getTaskCreateTime(task);
  return timestamp ? dayjs(timestamp).format('YYYY-MM-DD HH:mm') : '-';
};

const sortTasks = (items: DevloopTaskItem[]) =>
  [...items].sort((left, right) => {
    const statusDifference = getTaskStatusOrder(left) - getTaskStatusOrder(right);
    if (statusDifference !== 0) return statusDifference;
    const timeDifference = getTaskCreateTime(right) - getTaskCreateTime(left);
    if (timeDifference !== 0) return timeDifference;
    // 创建时间相同时按任务主键倒序，确保列表顺序稳定。
    return Number(right.taskId || right.sessionId || 0) - Number(left.taskId || left.sessionId || 0);
  });

const ProjectTasks: React.FC<Props> = ({
  project,
  keyword = '',
  onOpenSession,
  onToolbarChange,
  onRefreshToolbarChange,
}) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const [tasks, setTasks] = useState<DevloopTaskItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 任务 Tab 两种模式：list 是卡片列表，board 就是原来右上角「任务视图」的看板，默认进看板。
  // 仅研发/运营项目有看板（看板按四状态分列查询），普通项目只有列表。
  const [taskViewMode, setTaskViewMode] = useState<'list' | 'board'>(
    project.projectType === 'develop' || project.projectType === 'operation' ? 'board' : 'list'
  );
  const requestingRef = useRef(false);
  const taskDetailRequestIdRef = useRef(0);
  const initialLoadKeyRef = useRef<string | null>(null);
  const [templateTask, setTemplateTask] = useState<DevloopTaskItem | null>(null);
  // 研发项目和运营项目都支持按当前登录用户筛选任务，默认保持只看我的视图。
  const [onlyMine, setOnlyMine] = useState(project.projectType === 'develop' || project.projectType === 'operation');
  const [detailTask, setDetailTask] = useState<DevloopTaskItem | null>(null);
  const [editingTask, setEditingTask] = useState<DevloopTaskItem | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [editingAssignee, setEditingAssignee] = useState<string | number>();
  const [editingDueTime, setEditingDueTime] = useState<dayjs.Dayjs | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [memberOptions, setMemberOptions] = useState<Array<{ label: string; value: string | number }>>([]);
  const currentUserId = userInfo.userId ?? userInfo.id;
  useEffect(() => {
    // 切换项目类型时同步筛选开关，避免沿用上一个项目的任务筛选状态。
    setOnlyMine(project.projectType === 'develop' || project.projectType === 'operation');
  }, [project.projectType]);

  const isTaskCreator = (task: DevloopTaskItem) =>
    task.canDelete === true ||
    (currentUserId !== undefined && task.createBy !== undefined && `${currentUserId}` === `${task.createBy}`) ||
    // 兼容历史任务未记录创建人的情况，和后端的项目创建人回退规则保持一致。
    ((task.createBy === null || task.createBy === undefined) &&
      currentUserId !== undefined &&
      project.createBy !== undefined &&
      `${currentUserId}` === `${project.createBy}`);
  const projectKnowledgeOptions = (project.resources || project.boundResources || [])
    .filter((resource) => resource.resourceType === 'knowledge')
    .map((resource) => ({
      value: resource.resourceId,
      label: resource.resourceName || `${resource.resourceId}`,
    }));
  const projectOntologyOptions = (project.resources || project.boundResources || [])
    .filter((resource) => resource.resourceType === 'ontology')
    .map((resource) => {
      const resourceDetail = resource as typeof resource & Record<string, any>;
      const code = resourceDetail.objectCode || resourceDetail.resourceCode || resourceDetail.code || '';
      const name = resource.resourceName || resourceDetail.objectName || resourceDetail.name || code;
      const description = resourceDetail.objectDesc || resourceDetail.resourceDesc || resourceDetail.description || '';
      return {
        value: resource.resourceId,
        label: name,
        // 项目绑定记录可能只保留 ID、名称；先补齐标准字段，模板提交时还会统一归一化别名。
        raw: {
          ...resourceDetail,
          id: resourceDetail.id,
          objectId: resourceDetail.objectId,
          resourceId: resource.resourceId,
          baseId: resourceDetail.baseId,
          code,
          objectCode: resourceDetail.objectCode || code,
          resourceCode: resourceDetail.resourceCode || code,
          name,
          objectName: resourceDetail.objectName || name,
          resourceName: resource.resourceName || name,
          description,
          objectDesc: resourceDetail.objectDesc || description,
          resourceDesc: resourceDetail.resourceDesc || description,
        },
      };
    });
  const projectAgentOptions = (project.resources || project.boundResources || [])
    .filter((resource) => resource.resourceType === 'digital_employee')
    .map((resource) => ({
      value: resource.resourceId,
      label: resource.resourceName || `${resource.resourceId}`,
    }));

  const loadTasks = useCallback(
    async (nextPage = 1) => {
      if (!project.projectId || (nextPage > 1 && requestingRef.current)) return;
      if (nextPage > 1) requestingRef.current = true;
      if (nextPage === 1) setLoading(true);
      else setLoadingMore(true);
      try {
        // 分支请求单独书写，避免条件表达式内对象缩进同时触发 ESLint 与 Prettier 的冲突提示。
        let response;
        if (project.projectType === 'operation') {
          response = await listOperationTasks({
            projectId: Number(project.projectId),
            keyword: keyword.trim() || undefined,
            onlyMine,
            pageNum: nextPage,
            pageSize: PAGE_SIZE,
          });
        } else {
          response = await listTasks({
            projectId: Number(project.projectId),
            pageNum: nextPage,
            pageSize: PAGE_SIZE,
            onlyMine: project.projectType === 'develop' ? onlyMine : false,
            taskName: keyword.trim() || undefined,
          });
        }
        const rows = getArrayData(response) as DevloopTaskItem[];
        setTasks((current) => sortTasks(nextPage === 1 ? rows : [...current, ...rows]));
        setPage(nextPage);
        const loadedCount = (nextPage - 1) * PAGE_SIZE + rows.length;
        // 部分环境不返回 total，满页时保留一个未知余量，确保底部哨兵仍会请求下一页。
        setTotal(getPageTotal(response, loadedCount + (rows.length === PAGE_SIZE ? 1 : 0)));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.tasks.loadFailed' }));
        if (nextPage === 1) setTasks([]);
      } finally {
        if (nextPage > 1) requestingRef.current = false;
        if (nextPage === 1) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [intl, keyword, onlyMine, project.projectId, project.projectType]
  );
  const loadTasksRef = useRef(loadTasks);

  useEffect(() => {
    loadTasksRef.current = loadTasks;
  }, [loadTasks]);

  useEffect(() => {
    setPage(0);
    setTotal(0);
    const loadKey = `${project.projectId}:${project.projectType}:${keyword}:${onlyMine}`;
    // React 严格模式会重复执行 effect，同一筛选条件只加载一次首屏任务数据。
    if (initialLoadKeyRef.current === loadKey) return undefined;
    const timer = window.setTimeout(() => {
      initialLoadKeyRef.current = loadKey;
      void loadTasksRef.current(1);
    }, 250);
    // 项目或顶部搜索条件变化时重置分页，避免把旧查询结果追加到当前列表。
    return () => window.clearTimeout(timer);
  }, [keyword, onlyMine, project.projectId, project.projectType]);

  useEffect(() => {
    onToolbarChange?.(
      <div className={styles.headerActions}>
        {/* 看板自带一份「只看我的」，两处同时出现会让人以为要一起勾，所以列表模式才显示这个。 */}
        {taskViewMode === 'list' && (project.projectType === 'develop' || project.projectType === 'operation') && (
          <Checkbox checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)}>
            {intl.formatMessage({ id: 'projectSpace.tasks.onlyMine' })}
          </Checkbox>
        )}
        {(project.projectType === 'develop' || project.projectType === 'operation') && (
          <Segmented
            size="small"
            value={taskViewMode}
            options={[
              { label: intl.formatMessage({ id: 'projectSpace.tasks.mode.list' }), value: 'list' },
              { label: intl.formatMessage({ id: 'projectSpace.tasks.mode.board' }), value: 'board' },
            ]}
            onChange={(value) => setTaskViewMode(value as 'list' | 'board')}
          />
        )}
      </div>
    );
    onRefreshToolbarChange?.(
      <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadTasks(1)}>
        {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
      </Button>
    );
    return () => {
      onToolbarChange?.(null);
      onRefreshToolbarChange?.(null);
    };
  }, [intl, loadTasks, loading, onRefreshToolbarChange, onToolbarChange, onlyMine, project.projectType, taskViewMode]);

  const hasMore = total > tasks.length || (total === 0 && tasks.length === PAGE_SIZE);
  const sentinelRef = useInfiniteScroll(() => {
    if (hasMore) void loadTasks(page + 1);
  }, hasMore && !loading && !loadingMore);

  const isOperationPendingTask = (task: DevloopTaskItem) => {
    const status = normalizeTaskStatus(task);
    return (
      project.projectType === 'operation' &&
      !task.sessionId &&
      ['pending', 'todo', 'not_started', 'waiting', '待开始', '待启动', '待处理'].includes(status)
    );
  };

  // 待处理首次执行，部分失败可再次执行；后者可能已有 sessionId。
  const isOperationExecutableTask = (task: DevloopTaskItem) => {
    const status = normalizeTaskStatus(task);
    if (project.projectType !== 'operation') return false;
    if (['mixed', '部分失败'].includes(status)) return true;
    return isOperationPendingTask(task);
  };

  const openTaskSession = (task: DevloopTaskItem) => {
    // 待执行任务尚未启动会话，只允许从卡片右上角进入模板执行流程。
    if (!task.sessionId || isOperationPendingTask(task)) return;
    onOpenSession?.({
      sessionId: `${task.sessionId}`,
      sessionName: task.title || intl.formatMessage({ id: 'projectSpace.tasks.unnamed' }),
      sessionContent: task.statusLabel || '',
      projectId: `${project.projectId}`,
      taskId: `${task.taskId || task.sessionId}`,
      updateTime: task.updateTime,
      createTime: task.createTime,
      // 透传会话绑定的员工，handleOpenSession 据此 setAgentId，输入框才能默认 @ 到该员工。
      objectType: task.objectType,
      objectId: task.objectId,
      // 名称/头像与 objectId 同源返回，一并带上:研发任务绑的是项目维度执行员工，不在 redux
      // 员工列表里，handleOpenSession 要靠这两个字段写 agentCache，否则 @ 会兜底成「AI 助手」。
      agentName: task.agentName,
      avatar: task.avatar,
    });
  };

  const openTaskDetail = (task: DevloopTaskItem) => {
    setDetailTask(task);
    if (project.projectType !== 'operation') return;

    const taskId = Number(task.taskId || task.sessionId);
    if (!Number.isFinite(taskId)) return;
    const requestId = ++taskDetailRequestIdRef.current;
    // 运营任务列表只返回摘要，打开抽屉后补查完整配置，并防止快速切换时旧请求覆盖新任务。
    void getOperationTask(taskId)
      .then((response: any) => {
        if (requestId !== taskDetailRequestIdRef.current) return;
        const detail = response?.data ?? response;
        if (detail) setDetailTask({ ...task, ...detail });
      })
      .catch(() => undefined);
  };

  const handleTaskCardOpen = (task: DevloopTaskItem) => {
    // 普通/默认项目先查看会话任务详情；结构化项目仅允许当前负责人直接进入自己的任务会话。
    if (project.projectType === 'normal' || project.projectType === 'default') {
      openTaskDetail(task);
      return;
    }
    if (isCurrentUserTaskAssignee(task, userInfo)) {
      openTaskSession(task);
      return;
    }
    openTaskDetail(task);
  };

  const openReadonlyTaskSession = (task: DevloopTaskItem) => {
    if (!task.sessionId) {
      message.warning(intl.formatMessage({ id: 'projectSpace.detail.task.noSession' }));
      return;
    }
    const sessionName = task.title || intl.formatMessage({ id: 'projectSpace.tasks.unnamed' });
    // 非负责人沿用小详情的只读会话抽屉，不切换当前聊天上下文。
    EventEmitter.emit('beyond-fullabsolute-driver-open-type', {
      drawerType: 'readonlysession',
      canClose: true,
      title: sessionName,
    });
    EventEmitter.emit('beyond-fullabsolute-driver-message', {
      sessionInfo: { sessionId: `${task.sessionId}`, sessionName },
    });
  };

  const openTaskEdit = (task: DevloopTaskItem) => {
    setEditingTask(task);
    setEditingTitle(task.title || '');
    setEditingDescription(task.description || task.taskDescription || '');
    setEditingAssignee(task.assigneeId);
    setEditingDueTime(task.dueTime && dayjs(task.dueTime).isValid() ? dayjs(task.dueTime) : null);
    if (!project.projectId) return;
    void listProjectMembers(Number(project.projectId))
      .then((response) => {
        setMemberOptions(
          getArrayData(response).map((member: any) => ({
            label: member.userName || member.userCode || `${member.userId ?? member.memberId}`,
            value: member.userId ?? member.memberId,
          }))
        );
      })
      .catch(() => setMemberOptions([]));
  };

  const handleUpdateTask = async () => {
    const taskId = Number(editingTask?.taskId || editingTask?.sessionId);
    if (!Number.isFinite(taskId) || !editingTitle.trim() || editingAssignee === undefined) {
      message.warning(intl.formatMessage({ id: 'projectSpace.tasks.editValidation' }));
      return;
    }
    setTaskSaving(true);
    try {
      await updateOperationTask({
        taskId,
        title: editingTitle.trim(),
        description: editingDescription.trim() || undefined,
        assignee: editingAssignee,
        dueTime: editingDueTime?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
      });
      message.success(intl.formatMessage({ id: 'projectSpace.tasks.updateSuccess' }));
      setEditingTask(null);
      setDetailTask(null);
      await loadTasks(1);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.tasks.updateFailed' }));
    } finally {
      setTaskSaving(false);
    }
  };

  const handleDeleteTask = (task: DevloopTaskItem) => {
    const taskId = Number(task.taskId || task.sessionId);
    if (!Number.isFinite(taskId)) {
      message.error(intl.formatMessage({ id: 'projectSpace.tasks.deleteInvalidId' }));
      return;
    }
    Modal.confirm({
      title: intl.formatMessage({ id: 'projectSpace.tasks.deleteConfirmTitle' }),
      content: intl.formatMessage(
        { id: 'projectSpace.tasks.deleteConfirmContent' },
        { task: task.title || intl.formatMessage({ id: 'projectSpace.tasks.currentTask' }) }
      ),
      okText: intl.formatMessage({ id: 'common.delete' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteOperationTask(taskId);
          message.success(intl.formatMessage({ id: 'projectSpace.tasks.deleteSuccess' }));
          setDetailTask(null);
          await loadTasks(1);
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'projectSpace.tasks.deleteFailed' }));
        }
      },
    });
  };

  // 看板模式整块替掉列表：它自带筛选、分页和任务详情，列表的 Spin/无限滚动都不参与。
  if (taskViewMode === 'board') {
    return (
      <div className={styles.dataPanel}>
        <SessionOverviewDrawer
          embedded
          open
          projectId={project.projectId}
          operationProject={project.projectType === 'operation'}
          canEnterSession={(task) => Boolean(task.sessionId)}
          onEnterSession={(task) => {
            if (task.sessionId) openTaskSession(task);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.dataPanel}>
      <Spin spinning={loading}>
        {tasks.length ? (
          <div className={styles.dataCardGrid}>
            {tasks.map((task) => {
              const taskType = normalizeDevloopTaskType(task);
              const taskMenuItems = [
                ...(isOperationPendingTask(task)
                  ? [{ key: 'edit', label: intl.formatMessage({ id: 'common.edit' }) }]
                  : []),
                ...(isTaskCreator(task)
                  ? [{ key: 'delete', label: intl.formatMessage({ id: 'common.delete' }), danger: true }]
                  : []),
              ];
              return (
                <article
                  key={`${task.taskId || task.sessionId}`}
                  className={styles.dataCard}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleTaskCardOpen(task)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') handleTaskCardOpen(task);
                  }}
                >
                  <div className={styles.dataCardHeader}>
                    {taskType && (
                      <Tooltip title={intl.formatMessage({ id: getDevloopTaskTypeLabelId(taskType) })} placement="top">
                        <span className={`${styles.taskTypeIcon} ${TASK_TYPE_ICON_CLASSES[taskType]}`}>
                          {getDevloopTaskTypeIcon(taskType)}
                        </span>
                      </Tooltip>
                    )}
                    <Typography.Text strong ellipsis={{ tooltip: task.title }}>
                      {task.title || intl.formatMessage({ id: 'projectSpace.tasks.unnamed' })}
                    </Typography.Text>
                    <div className={styles.taskCardHeaderActions}>
                      {getTaskStatusLabel(task, intl) && (
                        <Tag
                          color={getTaskStatusColor(task)}
                          className={isOperationExecutableTask(task) ? styles.taskPendingStatusTag : undefined}
                        >
                          {getTaskStatusLabel(task, intl)}
                        </Tag>
                      )}
                      {isOperationExecutableTask(task) && (
                        <Button
                          type="text"
                          size="small"
                          className={styles.taskExecuteButton}
                          aria-label={intl.formatMessage({ id: 'projectSpace.tasks.executeAriaLabel' })}
                          onClick={(event) => {
                            event.stopPropagation();
                            setTemplateTask(task);
                          }}
                        >
                          {intl.formatMessage({ id: 'projectSpace.operation.execute.action' })}
                        </Button>
                      )}
                      {project.projectType === 'operation' && (isOperationPendingTask(task) || isTaskCreator(task)) && (
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: taskMenuItems,
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              if (key === 'edit') openTaskEdit(task);
                              if (key === 'delete') handleDeleteTask(task);
                            },
                          }}
                        >
                          <Button
                            type="text"
                            size="small"
                            className={styles.cardMoreAction}
                            icon={<MoreOutlined />}
                            aria-label={intl.formatMessage({ id: 'projectSpace.tasks.actionsAriaLabel' })}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </Dropdown>
                      )}
                    </div>
                  </div>
                  <Typography.Paragraph className={styles.dataCardDescription} ellipsis={{ rows: 2 }}>
                    {project.projectType === 'normal' || project.projectType === 'default'
                      ? task.sessionContent || task.description || task.taskDescription || '-'
                      : task.description ||
                        task.taskDescription ||
                        task.requirementTitle ||
                        task.agentName ||
                        task.statusLabel ||
                        '-'}
                  </Typography.Paragraph>
                  {/* 卡片底部只放负责人与创建时间：查看会话入口收到任务详情抽屉里，卡片本身整块可点即进详情。 */}
                  <div className={styles.taskMeta}>
                    <Typography.Text type="secondary" ellipsis={{ tooltip: task.assignee || '-' }}>
                      {task.assignee || '-'}
                    </Typography.Text>
                    <Typography.Text
                      type="secondary"
                      title={intl.formatMessage({ id: 'projectSpace.tasks.createTime' })}
                      className={
                        project.projectType === 'operation' && (isOperationPendingTask(task) || isTaskCreator(task))
                          ? styles.taskCreateTimeWithAction
                          : undefined
                      }
                    >
                      {formatTaskCreateTime(task)}
                    </Typography.Text>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          !loading && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'projectSpace.tasks.empty' })}
            />
          )
        )}
        <div ref={sentinelRef} className={styles.loadMoreSentinel}>
          {loadingMore ? (
            <Spin size="small" />
          ) : hasMore ? (
            intl.formatMessage({ id: 'projectSpace.detail.requirement.loadMore' })
          ) : null}
        </div>
      </Spin>
      <TaskTemplateModal
        open={!!templateTask}
        agentOptions={projectAgentOptions}
        agentOptionsOnly
        initialTitle={templateTask?.title}
        initialDescription={(templateTask as any)?.description || templateTask?.requirementTitle}
        knowledgeOptions={projectKnowledgeOptions}
        knowledgeOptionsOnly
        ontologyOptions={projectOntologyOptions}
        ontologyOptionsOnly
        applyText={intl.formatMessage({ id: 'common.confirm' })}
        onCancel={() => setTemplateTask(null)}
        onApply={async (result: TaskTemplateApplyResult) => {
          const taskId = Number(templateTask?.taskId || templateTask?.sessionId);
          if (!Number.isFinite(taskId) || taskId <= 0) {
            message.error(intl.formatMessage({ id: 'projectSpace.tasks.executeInvalidId' }));
            return;
          }
          const selectedAgentId = Number(result.values.agentId);
          if (!Number.isFinite(selectedAgentId) || selectedAgentId <= 0) {
            message.error(intl.formatMessage({ id: 'projectSpace.tasks.agentRequired' }));
            return;
          }
          // 先把模板提示词和结构化字段交给后端，后端提交事务后发送首条消息，避免跳转到空会话。
          const executeResult = await executeOperationTask({
            taskId,
            // 数字员工由模板中显式选择，不再根据任务负责人查询成员绑定关系。
            agentIds: [selectedAgentId],
            templateId: result.template.templateId,
            config: {
              ...result.values,
              templateType: result.template.templateType,
              templateName: result.template.templateName,
              templatePrompt: result.prompt,
            },
          });
          const sessionId = executeResult?.sessionId || templateTask?.sessionId || templateTask?.taskId;
          if (!sessionId) {
            message.error(intl.formatMessage({ id: 'projectSpace.tasks.executeSessionMissing' }));
            return;
          }
          onOpenSession?.({
            sessionId: `${sessionId}`,
            sessionName: templateTask.title || intl.formatMessage({ id: 'projectSpace.tasks.unnamed' }),
            sessionContent: templateTask.statusLabel || '',
            projectId: `${project.projectId}`,
            taskId: `${templateTask.taskId || sessionId}`,
            // 跳转聊天页时同步所选数字员工，输入框可立即恢复默认 @，无需等待消息元数据返回。
            objectId: selectedAgentId,
            objectType: 'DigEmployee',
            // 模板选的是项目绑定员工,同样不在 redux 员工列表里,名字要从项目资源里反查带上,
            // 否则 handleOpenSession 写不了 agentCache,@ 会兜底成「AI 助手」。
            agentName: projectAgentOptions.find((agent) => `${agent.value}` === `${selectedAgentId}`)?.label,
            updateTime: templateTask.updateTime,
            createTime: templateTask.createTime,
          });
          setTemplateTask(null);
          void loadTasks(1);
        }}
      />
      <Modal
        open={!!editingTask}
        title={intl.formatMessage({ id: 'projectSpace.tasks.editTitle' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        confirmLoading={taskSaving}
        onCancel={() => setEditingTask(null)}
        onOk={() => void handleUpdateTask()}
        destroyOnClose
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <Typography.Text>{intl.formatMessage({ id: 'projectSpace.tasks.field.name' })}</Typography.Text>
            <Input
              style={{ marginTop: 8 }}
              maxLength={255}
              value={editingTitle}
              onChange={(event) => setEditingTitle(event.target.value)}
            />
          </div>
          <div>
            <Typography.Text>{intl.formatMessage({ id: 'projectSpace.tasks.field.description' })}</Typography.Text>
            <Input.TextArea
              style={{ marginTop: 8 }}
              rows={3}
              maxLength={1000}
              showCount
              value={editingDescription}
              onChange={(event) => setEditingDescription(event.target.value)}
            />
          </div>
          <div className={styles.taskEditRow}>
            <div>
              <Typography.Text>{intl.formatMessage({ id: 'projectSpace.tasks.field.assignee' })}</Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                value={editingAssignee}
                options={memberOptions}
                placeholder={intl.formatMessage({ id: 'projectSpace.tasks.field.assigneePlaceholder' })}
                onChange={setEditingAssignee}
              />
            </div>
            <div>
              <Typography.Text>{intl.formatMessage({ id: 'projectSpace.tasks.field.dueTime' })}</Typography.Text>
              <DatePicker style={{ width: '100%', marginTop: 8 }} value={editingDueTime} onChange={setEditingDueTime} />
            </div>
          </div>
        </div>
      </Modal>
      <TaskDetailDrawer
        task={detailTask}
        operationProject={project.projectType === 'operation'}
        simpleProject={project.projectType === 'normal' || project.projectType === 'default'}
        onClose={() => setDetailTask(null)}
        canEnterSession={
          detailTask
            ? project.projectType === 'normal' || project.projectType === 'default'
              ? Boolean(detailTask.sessionId)
              : isCurrentUserTaskAssignee(detailTask, userInfo)
            : false
        }
        onEnterSession={(task) => {
          openTaskSession(task as DevloopTaskItem);
          setDetailTask(null);
        }}
        onViewSession={(task) => {
          openReadonlyTaskSession(task as DevloopTaskItem);
          setDetailTask(null);
        }}
      />
    </div>
  );
};

export default ProjectTasks;
