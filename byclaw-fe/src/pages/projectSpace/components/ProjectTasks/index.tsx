import { Button, Checkbox, Empty, Spin, Tag, Typography, message } from 'antd';
import { AppstoreOutlined, MessageOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import {
  executeOperationTask,
  listOperationTasks,
  listProjectMembers,
  listTasks,
  type DevloopTaskItem,
} from '@/service/devloop';
import TaskTemplateModal, { type TaskTemplateApplyResult } from '@/components/TaskTemplateModal';
import type { ProjectSession, ProjectSpace } from '../../types';
import { getArrayData, getPageTotal } from '../../utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import styles from '../../index.module.less';
import SessionOverviewDrawer from '@/layout/sider/components/ProjectSpaceList/SessionOverviewDrawer';
import TaskDetailDrawer from '@/layout/sider/components/ProjectSpaceList/TaskDetailDrawer';
import { isCurrentUserTaskAssignee } from '@/layout/sider/components/ProjectSpaceList/taskAccess';

interface Props {
  project: ProjectSpace;
  keyword?: string;
  onOpenSession?: (session: ProjectSession) => void;
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;

  /** 首屏任务加载完成后通知详情页，用于空列表时切换到需求 tab。 */
  onInitialLoad?: (hasTasks: boolean) => void;
}

const PAGE_SIZE = 30;

const normalizeTaskStatus = (task: DevloopTaskItem) => {
  const label = `${task.statusLabel || ''}`.trim().toLowerCase();
  if (label.includes('进行中') || label.includes('运行')) return 'in_progress';
  if (label.includes('已完成') || label.includes('完成')) return 'completed';
  if (label.includes('失败')) return 'failed';
  if (label.includes('暂停')) return 'paused';
  if (label.includes('待开始') || label.includes('待启动')) return 'pending';
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
  };
  const messageId = statusMessageId[status];
  return messageId ? intl.formatMessage({ id: messageId }) : task.statusLabel || '';
};

const getTaskStatusColor = (task: DevloopTaskItem) => {
  const status = normalizeTaskStatus(task);
  if (['done', 'completed', '完成', '已完成'].includes(status)) return 'success';
  if (['doing', 'running', 'in_progress', '进行中'].includes(status)) return 'processing';
  if (['failed', '失败'].includes(status)) return 'error';
  if (['paused', '暂停'].includes(status)) return 'warning';
  // 待开始使用橙黄色，进行中使用蓝色，避免两个状态都呈现为蓝色难以区分。
  return 'warning';
};

const ProjectTasks: React.FC<Props> = ({
  project,
  keyword = '',
  onOpenSession,
  onToolbarChange,
  onRefreshToolbarChange,
  onInitialLoad,
}) => {
  const intl = useIntl();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const [tasks, setTasks] = useState<DevloopTaskItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const requestingRef = useRef(false);
  const initialLoadKeyRef = useRef<string | null>(null);
  const [templateTask, setTemplateTask] = useState<DevloopTaskItem | null>(null);
  const [templateAgentOptions, setTemplateAgentOptions] = useState<Array<{ label: string; value: string | number }>>(
    []
  );
  const [onlyMine, setOnlyMine] = useState(project.projectType === 'develop');
  const [detailTask, setDetailTask] = useState<DevloopTaskItem | null>(null);

  useEffect(() => {
    if (!templateTask || project.projectType !== 'operation') return;
    void listProjectMembers(Number(project.projectId)).then((response) => {
      const assigneeId = (templateTask as any).assigneeId ?? (templateTask as any).assignee;
      const options = getArrayData(response)
        .filter((member: any) => member.agentId && `${member.userId}` === `${assigneeId}`)
        .map((member: any) => ({
          label: member.agentName || member.agentName || member.userName,
          value: member.agentId,
        }));
      setTemplateAgentOptions(options);
    });
  }, [project.projectId, project.projectType, templateTask]);

  const loadTasks = useCallback(
    async (nextPage = 1) => {
      if (!project.projectId || (nextPage > 1 && requestingRef.current)) return;
      if (nextPage > 1) requestingRef.current = true;
      if (nextPage === 1) setLoading(true);
      else setLoadingMore(true);
      try {
        const response =
          project.projectType === 'operation'
            ? await listOperationTasks({
              projectId: Number(project.projectId),
              keyword: keyword.trim() || undefined,
              pageNum: nextPage,
              pageSize: PAGE_SIZE,
            })
            : await listTasks({
              projectId: Number(project.projectId),
              pageNum: nextPage,
              pageSize: PAGE_SIZE,
              onlyMine: project.projectType === 'develop' ? onlyMine : false,
              taskName: keyword.trim() || undefined,
            });
        const rows = getArrayData(response) as DevloopTaskItem[];
        setTasks((current) => (nextPage === 1 ? rows : [...current, ...rows]));
        setPage(nextPage);
        const loadedCount = (nextPage - 1) * PAGE_SIZE + rows.length;
        // 部分环境不返回 total，满页时保留一个未知余量，确保底部哨兵仍会请求下一页。
        setTotal(getPageTotal(response, loadedCount + (rows.length === PAGE_SIZE ? 1 : 0)));
        if (nextPage === 1) onInitialLoad?.(rows.length > 0);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.tasks.loadFailed' }));
        if (nextPage === 1) setTasks([]);
      } finally {
        if (nextPage > 1) requestingRef.current = false;
        if (nextPage === 1) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [intl, keyword, onlyMine, onInitialLoad, project.projectId, project.projectType]
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
        {project.projectType === 'develop' && (
          <Checkbox checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)}>
            只看我的任务
          </Checkbox>
        )}
        <Button size="small" icon={<AppstoreOutlined />} onClick={() => setTaskBoardOpen(true)}>
          任务视图
        </Button>
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
  }, [intl, loadTasks, loading, onRefreshToolbarChange, onToolbarChange, onlyMine, project.projectType]);

  const hasMore = total > tasks.length || (total === 0 && tasks.length === PAGE_SIZE);
  const sentinelRef = useInfiniteScroll(() => {
    if (hasMore) void loadTasks(page + 1);
  }, hasMore && !loading && !loadingMore);

  const isOperationPendingTask = (task: DevloopTaskItem) => {
    const status = normalizeTaskStatus(task);
    return (
      project.projectType === 'operation' &&
      !task.sessionId &&
      ['pending', 'todo', 'not_started', 'waiting', '待开始', '待启动'].includes(status)
    );
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
    });
  };

  const openTaskDetail = (task: DevloopTaskItem) => {
    setDetailTask(task);
  };

  return (
    <div className={styles.dataPanel}>
      <Spin spinning={loading}>
        {tasks.length ? (
          <div className={styles.dataCardGrid}>
            {tasks.map((task) => (
              <article
                key={`${task.taskId || task.sessionId}`}
                className={styles.dataCard}
                role="button"
                tabIndex={0}
                onClick={() => openTaskDetail(task)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') openTaskDetail(task);
                }}
              >
                <div className={styles.dataCardHeader}>
                  <Typography.Text strong ellipsis={{ tooltip: task.title }}>
                    {task.title || intl.formatMessage({ id: 'projectSpace.tasks.unnamed' })}
                  </Typography.Text>
                  <div className={styles.taskCardHeaderActions}>
                    {getTaskStatusLabel(task, intl) && (
                      <Tag
                        color={getTaskStatusColor(task)}
                        className={isOperationPendingTask(task) ? styles.taskPendingStatusTag : undefined}
                      >
                        {getTaskStatusLabel(task, intl)}
                      </Tag>
                    )}
                    {isOperationPendingTask(task) && (
                      <Button
                        type="text"
                        size="small"
                        className={styles.taskExecuteButton}
                        aria-label="执行任务"
                        onClick={(event) => {
                          event.stopPropagation();
                          setTemplateTask(task);
                        }}
                      >
                        {intl.formatMessage({ id: 'projectSpace.operation.execute.action' })}
                      </Button>
                    )}
                  </div>
                </div>
                <Typography.Paragraph className={styles.dataCardDescription} ellipsis={{ rows: 2 }}>
                  {task.description ||
                    task.taskDescription ||
                    task.requirementTitle ||
                    task.agentName ||
                    task.statusLabel ||
                    '-'}
                </Typography.Paragraph>
                {task.sessionId && !isOperationPendingTask(task) && (
                  <Button
                    type="link"
                    size="small"
                    icon={<MessageOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      openTaskSession(task);
                    }}
                  >
                    {intl.formatMessage({ id: 'projectSpace.tasks.openSession' })}
                  </Button>
                )}
              </article>
            ))}
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
        agentOptions={templateAgentOptions}
        initialTitle={templateTask?.title}
        initialDescription={(templateTask as any)?.description || templateTask?.requirementTitle}
        applyText="确定"
        onCancel={() => setTemplateTask(null)}
        onApply={async (result: TaskTemplateApplyResult) => {
          const taskId = Number(templateTask?.taskId || templateTask?.sessionId);
          if (!Number.isFinite(taskId) || taskId <= 0) {
            message.error('任务缺少有效编号，无法执行');
            return;
          }
          const assigneeId = (templateTask as any)?.assigneeId ?? (templateTask as any)?.assignee;
          const selectedAgentId = templateAgentOptions[0]?.value;
          if (assigneeId === undefined && selectedAgentId === undefined) {
            message.error('当前任务没有绑定可执行的数字员工');
            return;
          }
          // 先把模板提示词和结构化字段交给后端，后端提交事务后发送首条消息，避免跳转到空会话。
          const executeResult = await executeOperationTask({
            taskId,
            assigneeIds: assigneeId === undefined ? undefined : [assigneeId],
            agentIds: assigneeId === undefined ? [selectedAgentId!] : undefined,
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
            message.error('任务执行后未返回会话，无法打开聊天');
            return;
          }
          onOpenSession?.({
            sessionId: `${sessionId}`,
            sessionName: templateTask.title || intl.formatMessage({ id: 'projectSpace.tasks.unnamed' }),
            sessionContent: templateTask.statusLabel || '',
            projectId: `${project.projectId}`,
            taskId: `${templateTask.taskId || sessionId}`,
            updateTime: templateTask.updateTime,
            createTime: templateTask.createTime,
          });
          setTemplateTask(null);
          void loadTasks(1);
        }}
      />
      <SessionOverviewDrawer
        open={taskBoardOpen}
        onClose={() => setTaskBoardOpen(false)}
        projectId={project.projectId}
        operationProject={project.projectType === 'operation'}
        canEnterSession={(task) => Boolean(task.sessionId)}
        onEnterSession={(task) => {
          if (task.sessionId) openTaskSession(task);
          setTaskBoardOpen(false);
        }}
      />
      <TaskDetailDrawer
        task={detailTask}
        onClose={() => setDetailTask(null)}
        canEnterSession={detailTask ? isCurrentUserTaskAssignee(detailTask, userInfo) : false}
        onEnterSession={(task) => {
          openTaskSession(task as DevloopTaskItem);
          setDetailTask(null);
        }}
        onViewSession={(task) => {
          openTaskSession(task as DevloopTaskItem);
          setDetailTask(null);
        }}
      />
    </div>
  );
};

export default ProjectTasks;
