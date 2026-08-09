import {
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { AppstoreOutlined, MessageOutlined, MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import {
  deleteOperationTask,
  executeOperationTask,
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

const getTaskStatusOrder = (task: DevloopTaskItem) => {
  const status = normalizeTaskStatus(task);
  if (
    [
      'done',
      'completed',
      'finished',
      'success',
      'failed',
      'error',
      'cancelled',
      '完成',
      '已完成',
      '失败',
    ].includes(status)
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
  const [onlyMine, setOnlyMine] = useState(project.projectType === 'develop');
  const [detailTask, setDetailTask] = useState<DevloopTaskItem | null>(null);
  const [editingTask, setEditingTask] = useState<DevloopTaskItem | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [editingAssignee, setEditingAssignee] = useState<string | number>();
  const [editingDueTime, setEditingDueTime] = useState<dayjs.Dayjs | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [memberOptions, setMemberOptions] = useState<Array<{ label: string; value: string | number }>>([]);
  const currentUserId = userInfo.userId ?? userInfo.id;
  const isTaskCreator = (task: DevloopTaskItem) =>
    task.canDelete === true ||
    (currentUserId !== undefined && task.createBy !== undefined && `${currentUserId}` === `${task.createBy}`) ||
    // 兼容历史任务未记录创建人的情况，和后端的项目创建人回退规则保持一致。
    (task.createBy == null &&
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
      const code =
        resourceDetail.objectCode ||
        resourceDetail.resourceCode ||
        resourceDetail.code ||
        `${resource.resourceId}`;
      const name = resource.resourceName || resourceDetail.objectName || resourceDetail.name || code;
      const description =
        resourceDetail.objectDesc || resourceDetail.resourceDesc || resourceDetail.description || '';
      return {
        value: resource.resourceId,
        label: name,
        // 项目绑定记录可能只保留 ID、名称；先补齐标准字段，模板提交时还会统一归一化别名。
        raw: {
          ...resourceDetail,
          id: resourceDetail.id || resource.resourceId,
          objectId: resourceDetail.objectId || resource.resourceId,
          resourceId: resource.resourceId,
          baseId: resourceDetail.baseId || `${resource.resourceId}`,
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
        setTasks((current) => sortTasks(nextPage === 1 ? rows : [...current, ...rows]));
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

  const openTaskEdit = (task: DevloopTaskItem) => {
    setEditingTask(task);
    setEditingTitle(task.title || '');
    setEditingDescription(task.description || task.taskDescription || '');
    setEditingAssignee(task.assigneeId);
    setEditingDueTime(
      task.dueTime && dayjs(task.dueTime).isValid() ? dayjs(task.dueTime) : null
    );
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
      message.warning('请填写任务名称并选择负责人');
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
      message.success('任务已更新');
      setEditingTask(null);
      setDetailTask(null);
      await loadTasks(1);
    } catch (error: any) {
      message.error(error?.message || '任务更新失败');
    } finally {
      setTaskSaving(false);
    }
  };

  const handleDeleteTask = (task: DevloopTaskItem) => {
    const taskId = Number(task.taskId || task.sessionId);
    if (!Number.isFinite(taskId)) {
      message.error('任务缺少有效编号，无法删除');
      return;
    }
    Modal.confirm({
      title: '确认删除任务？',
      content: `删除“${task.title || '当前任务'}”后将不再在项目任务中展示，是否继续？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteOperationTask(taskId);
          message.success('任务已删除');
          setDetailTask(null);
          await loadTasks(1);
        } catch (error: any) {
          message.error(error?.message || '任务删除失败');
        }
      },
    });
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
                    {project.projectType === 'operation' && (isOperationPendingTask(task) || isTaskCreator(task)) && (
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: [
                            ...(isOperationPendingTask(task) ? [{ key: 'edit', label: '编辑' }] : []),
                            ...(isTaskCreator(task) ? [{ key: 'delete', label: '删除', danger: true }] : []),
                          ],
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
                          aria-label="任务操作"
                          onClick={(event) => event.stopPropagation()}
                        />
                      </Dropdown>
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
        agentOptions={projectAgentOptions}
        agentOptionsOnly
        initialTitle={templateTask?.title}
        initialDescription={(templateTask as any)?.description || templateTask?.requirementTitle}
        knowledgeOptions={projectKnowledgeOptions}
        knowledgeOptionsOnly
        ontologyOptions={projectOntologyOptions}
        ontologyOptionsOnly
        applyText="确定"
        onCancel={() => setTemplateTask(null)}
        onApply={async (result: TaskTemplateApplyResult) => {
          const taskId = Number(templateTask?.taskId || templateTask?.sessionId);
          if (!Number.isFinite(taskId) || taskId <= 0) {
            message.error('任务缺少有效编号，无法执行');
            return;
          }
          const selectedAgentId = Number(result.values.agentId);
          if (!Number.isFinite(selectedAgentId) || selectedAgentId <= 0) {
            message.error('请选择当前项目绑定的数字员工');
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
            message.error('任务执行后未返回会话，无法打开聊天');
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
            updateTime: templateTask.updateTime,
            createTime: templateTask.createTime,
          });
          setTemplateTask(null);
          void loadTasks(1);
        }}
      />
      <Modal
        open={!!editingTask}
        title="编辑任务"
        okText="确定"
        confirmLoading={taskSaving}
        onCancel={() => setEditingTask(null)}
        onOk={() => void handleUpdateTask()}
        destroyOnClose
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <Typography.Text>任务名称</Typography.Text>
            <Input
              style={{ marginTop: 8 }}
              maxLength={255}
              value={editingTitle}
              onChange={(event) => setEditingTitle(event.target.value)}
            />
          </div>
          <div>
            <Typography.Text>任务描述</Typography.Text>
            <Input.TextArea
              style={{ marginTop: 8 }}
              rows={3}
              maxLength={1000}
              showCount
              value={editingDescription}
              onChange={(event) => setEditingDescription(event.target.value)}
            />
          </div>
          <div>
            <Typography.Text>负责人</Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 8 }}
              value={editingAssignee}
              options={memberOptions}
              placeholder="请选择负责人"
              onChange={setEditingAssignee}
            />
          </div>
          <div>
            <Typography.Text>预期时间</Typography.Text>
            <DatePicker
              style={{ width: '100%', marginTop: 8 }}
              value={editingDueTime}
              onChange={setEditingDueTime}
            />
          </div>
        </div>
      </Modal>
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
