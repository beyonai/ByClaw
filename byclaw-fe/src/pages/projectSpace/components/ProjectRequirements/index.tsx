import { Button, Drawer, Dropdown, Empty, Input, Modal, Select, Spin, Tag, Typography, message } from 'antd';
import { DeleteOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import {
  listOperationRequirements,
  listProjectRepos,
  listProjectMembers,
  listRequirementsByProject,
  deleteOperationRequirement,
  splitTask,
  startOperationRequirement,
  updateOperationRequirement,
} from '@/service/devloop';
import {
  OperationTaskFormModal,
  type OperationTaskFormValues,
} from '@/layout/sider/components/ProjectSpaceList/operation';
import RequirementSplitModal from '@/layout/sider/components/ProjectSpaceList/RequirementSplitModal';
import type { SplitTaskDraft } from '@/layout/sider/components/ProjectSpaceList/RequirementSplitModal/types';
import detailStyles from '@/layout/sider/components/ProjectSpaceList/index.module.less';
import type { ProjectRequirement, ProjectSpace } from '../../types';
import { getArrayData, getPageTotal } from '../../utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  keyword?: string;
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;

  /** 需求拆分成功后通知详情页切回任务 tab。 */
  onStarted?: () => void;
}

const PAGE_SIZE = 20;

const normalizeRequirementType = (item: Record<string, any>) => {
  const value = `${item.operationType || item.taskType || item.type || 'collect'}`.toLowerCase();
  if (['publish', 'content', 'content_creation'].includes(value)) return 'content';
  if (['knowledge', 'knowledge_organization', 'knowledge_organize'].includes(value)) return 'knowledge';
  if (['analyze', 'analysis', 'analytics'].includes(value)) return 'analyze';
  return 'collect';
};

// 单字类型标签也使用语言键，避免英文环境混入中文缩写。
const REQUIREMENT_TYPE_BADGES: Record<string, { labelId: string; className: string }> = {
  collect: { labelId: 'projectSpace.requirements.badge.collect', className: 'requirementTypeBadgeCollect' },
  knowledge: { labelId: 'projectSpace.requirements.badge.knowledge', className: 'requirementTypeBadgeKnowledge' },
  content: { labelId: 'projectSpace.requirements.badge.content', className: 'requirementTypeBadgeContent' },
  analyze: { labelId: 'projectSpace.requirements.badge.analyze', className: 'requirementTypeBadgeAnalyze' },
};

const DEVELOP_REQUIREMENT_TYPE_BADGES: Record<string, { labelId: string; className: string }> = {
  dingtalk: { labelId: 'projectSpace.requirements.badge.dingtalk', className: 'requirementTypeBadgeDingtalk' },
  dingtalk_group: { labelId: 'projectSpace.requirements.badge.dingtalk', className: 'requirementTypeBadgeDingtalk' },
  dingtalk_group_message: {
    labelId: 'projectSpace.requirements.badge.dingtalk',
    className: 'requirementTypeBadgeDingtalk',
  },
  dingtalk_todo: { labelId: 'projectSpace.requirements.badge.dingtalk', className: 'requirementTypeBadgeDingtalk' },
  github_issue: { labelId: 'projectSpace.requirements.badge.github', className: 'requirementTypeBadgeGithub' },
  github_issues: { labelId: 'projectSpace.requirements.badge.github', className: 'requirementTypeBadgeGithub' },
  manual: { labelId: 'projectSpace.requirements.badge.manual', className: 'requirementTypeBadgeManual' },
};

const getDevelopRequirementTypeLabel = (item: Record<string, any>, intl: ReturnType<typeof useIntl>) => {
  const sourceType = `${item.sourceType || item.operationType || ''}`.trim().toLowerCase();
  const messageIdMap: Record<string, string> = {
    dingtalk: 'projectSpace.detail.source.type.dingtalk',
    dingtalk_group: 'projectSpace.detail.source.type.dingtalkGroup',
    dingtalk_group_message: 'projectSpace.detail.source.type.dingtalkGroup',
    dingtalk_todo: 'projectSpace.detail.source.type.dingtalkTodo',
    github_issue: 'projectSpace.detail.source.type.githubIssue',
    github_issues: 'projectSpace.detail.source.type.githubIssues',
    manual: 'projectSpace.detail.source.type.default',
  };
  return intl.formatMessage({ id: messageIdMap[sourceType] || 'projectSpace.detail.source.type.default' });
};

const getRequirementStatusLabel = (status: unknown, intl: ReturnType<typeof useIntl>) => {
  const value = `${status || ''}`.trim().toLowerCase();
  if (!value || ['todo', 'pending', 'created', 'not_started', 'waiting', '待开始'].includes(value)) {
    return intl.formatMessage({ id: 'projectSpace.requirements.status.pending' });
  }
  if (['launched', 'doing', 'running', 'in_progress', 'processing', '进行中'].includes(value)) {
    return intl.formatMessage({ id: 'projectSpace.requirements.status.running' });
  }
  if (['done', 'completed', 'finished', '已完成'].includes(value)) {
    return intl.formatMessage({ id: 'projectSpace.requirements.status.completed' });
  }
  if (['failed', 'error', '失败'].includes(value)) {
    return intl.formatMessage({ id: 'projectSpace.requirements.status.failed' });
  }
  return `${status}`;
};

const getRequirementStatusColor = (status: unknown) => {
  const value = `${status || ''}`.trim().toLowerCase();
  if (value === 'launched' || value === 'doing' || value === 'running') return 'processing';
  if (value === 'done' || value === 'completed') return 'success';
  if (value === 'failed') return 'error';
  // 待开始状态与任务 tab 使用相同的 warning 标签，保持跨 tab 的状态识别一致。
  return 'warning';
};

/** 兼容运营需求历史状态编码，所有未启动状态统一按“待开始”处理。 */
const isPendingRequirement = (item: Record<string, any>) =>
  ['todo', 'pending', 'created', 'not_started', 'waiting', '待开始', ''].includes(
    `${item.status || item.action || ''}`.trim().toLowerCase()
  );

const getRequirementStatusOrder = (item: Record<string, any>) => {
  const status = `${item.status || item.action || ''}`.trim().toLowerCase();
  if (
    ['done', 'completed', 'finished', 'closed', 'failed', 'error', 'cancelled', '已完成', '完成', '失败'].includes(
      status
    )
  ) {
    return 2;
  }
  if (
    ['launched', 'doing', 'running', 'in_progress', 'processing', 'started', 'paused', '进行中', '暂停'].includes(
      status
    ) ||
    Boolean(item.sessionId)
  ) {
    return 1;
  }
  // todo、pending、created 以及历史空状态都视为待开始，统一排在最前面。
  return 0;
};

const getRequirementCreateTime = (item: Record<string, any>) => {
  const value = item.createTime || item.createdAt || item.createDate || item.sourceCreateTime;
  if (!value) return 0;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.valueOf() : 0;
};

const sortRequirements = (items: any[]) =>
  [...items].sort((left, right) => {
    const statusDifference = getRequirementStatusOrder(left) - getRequirementStatusOrder(right);
    if (statusDifference !== 0) return statusDifference;
    const timeDifference = getRequirementCreateTime(right) - getRequirementCreateTime(left);
    if (timeDifference !== 0) return timeDifference;
    // 创建时间相同时按业务主键倒序，保证排序结果稳定且最新记录优先。
    return (
      Number(right.requirementId || right.itemId || right.sourceId || 0) -
      Number(left.requirementId || left.itemId || left.sourceId || 0)
    );
  });

const ProjectRequirements: React.FC<Props> = ({ project, keyword = '', onRefreshToolbarChange, onStarted }) => {
  const intl = useIntl();
  const [requirements, setRequirements] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestingRef = useRef(false);
  const initialLoadKeyRef = useRef<string | null>(null);
  const [startTarget, setStartTarget] = useState<Record<string, any> | null>(null);
  const [starting, setStarting] = useState(false);
  const [splitTasks, setSplitTasks] = useState<
    Array<{ title: string; description: string; assignee?: string | number }>
  >([]);
  const [splitAssignees, setSplitAssignees] = useState<Array<{ label: string; value: string | number }>>([]);
  const [developSplitTarget, setDevelopSplitTarget] = useState<Record<string, any> | null>(null);
  const [developSplitRepos, setDevelopSplitRepos] = useState<
    Array<{ repoId: number; repoFullName: string; repoUrl?: string; defaultBranch?: string }>
  >([]);
  const [developSplitConfirming, setDevelopSplitConfirming] = useState(false);
  const [requirementDetail, setRequirementDetail] = useState<Record<string, any> | null>(null);
  const [editingRequirement, setEditingRequirement] = useState<Record<string, any> | null>(null);
  const [requirementSaving, setRequirementSaving] = useState(false);

  const loadRequirements = useCallback(
    async (search = keyword, nextPage = 1) => {
      if (!project.projectId || (nextPage > 1 && requestingRef.current)) return;
      if (nextPage > 1) requestingRef.current = true;
      if (nextPage === 1) setLoading(true);
      else setLoadingMore(true);
      try {
        const response =
          project.projectType === 'operation'
            ? await listOperationRequirements({
              projectId: Number(project.projectId),
              keyword: search.trim(),
              pageNum: nextPage,
              pageSize: PAGE_SIZE,
            })
            : await listRequirementsByProject(Number(project.projectId), search.trim());
        const rows = getArrayData(response);
        setRequirements((current) => sortRequirements(nextPage === 1 ? rows : [...current, ...rows]));
        setPage(nextPage);
        const loadedCount = (nextPage - 1) * PAGE_SIZE + rows.length;
        setTotal(
          getPageTotal(
            response,
            project.projectType === 'operation' ? loadedCount + (rows.length === PAGE_SIZE ? 1 : 0) : rows.length
          )
        );
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.requirements.loadFailed' }));
        if (nextPage === 1) setRequirements([]);
      } finally {
        if (nextPage > 1) requestingRef.current = false;
        if (nextPage === 1) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [intl, keyword, project.projectId, project.projectType]
  );
  const loadRequirementsRef = useRef(loadRequirements);

  useEffect(() => {
    if ((!startTarget && !developSplitTarget && !editingRequirement) || !project.projectId) return;
    void listProjectMembers(Number(project.projectId)).then((response) => {
      setSplitAssignees(
        getArrayData(response).map((member: any) => ({
          label: member.userName || member.userCode || `${member.userId}`,
          value: member.userId,
        }))
      );
    });
  }, [developSplitTarget, editingRequirement, project.projectId, startTarget]);

  useEffect(() => {
    if (project.projectType !== 'develop' || !project.projectId) return;
    const projectRepos = (project.repos || [])
      .filter((repo) => repo.repoId !== undefined && repo.repoId !== null)
      .map((repo) => ({
        repoId: Number(repo.repoId),
        repoFullName: repo.repoFullName,
        repoUrl: repo.repoUrl,
        defaultBranch: repo.defaultBranch,
      }));
    if (projectRepos.length) {
      setDevelopSplitRepos(projectRepos);
      return;
    }
    void listProjectRepos(Number(project.projectId))
      .then((response: any) => {
        const rows = getArrayData(response);
        setDevelopSplitRepos(
          rows
            .filter((repo: any) => repo.repoId !== undefined && repo.repoId !== null)
            .map((repo: any) => ({
              repoId: Number(repo.repoId),
              repoFullName: repo.repoFullName || repo.repoUrl || `${repo.repoId}`,
              repoUrl: repo.repoUrl,
              defaultBranch: repo.defaultBranch,
            }))
        );
      })
      .catch(() => setDevelopSplitRepos([]));
  }, [project.projectId, project.projectType, project.repos]);

  const currentUserId = useSelector((state: any) => state.user?.userInfo?.userId ?? state.user?.userInfo?.id);
  const isRequirementCreator = (item: Record<string, any>) =>
    item.canDelete === true ||
    (currentUserId !== undefined && item.createBy !== undefined && `${currentUserId}` === `${item.createBy}`) ||
    // 兼容历史接口未返回需求创建人的数据，后端也会按相同规则回退到项目创建人。
    ((item.createBy === null || item.createBy === undefined) &&
      currentUserId !== undefined &&
      project.createBy !== undefined &&
      `${currentUserId}` === `${project.createBy}`);
  const developInitReady = project.projectType !== 'develop' || !project.initStatus || project.initStatus === 'ready';
  const defaultDevelopAssigneeId = splitAssignees.find(
    (member) => currentUserId !== undefined && `${member.value}` === `${currentUserId}`
  )?.value;

  const handleConfirmDevelopSplit = async (tasks: SplitTaskDraft[]) => {
    if (!developSplitTarget || developSplitConfirming) return;
    const sourceItemId = Number(
      developSplitTarget.itemId ?? developSplitTarget.sourceId ?? developSplitTarget.requirementId
    );
    if (!Number.isFinite(sourceItemId) || !tasks.length) {
      message.error(intl.formatMessage({ id: 'projectSpace.requirements.invalidIdStart' }));
      return;
    }
    setDevelopSplitConfirming(true);
    try {
      await splitTask({
        projectId: Number(project.projectId),
        sourceItemId,
        tasks: tasks.map((task) => ({
          rowId: task.rowId,
          title: task.title.trim(),
          repoId: Number(task.repoId),
          branch: task.branch.trim(),
          assigneeId: task.assigneeId,
          dependsOn: task.dependsOn,
        })),
      });
      message.success(intl.formatMessage({ id: 'projectSpace.requirements.splitSuccess' }));
      setDevelopSplitTarget(null);
      await loadRequirements(keyword, 1);
      onStarted?.();
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.requirements.splitFailed' }));
    } finally {
      setDevelopSplitConfirming(false);
    }
  };

  useEffect(() => {
    loadRequirementsRef.current = loadRequirements;
  }, [loadRequirements]);

  useEffect(() => {
    setPage(0);
    setTotal(0);
    const loadKey = `${project.projectId}:${project.projectType}:${keyword}`;
    // React 严格模式会在开发环境重复执行 effect；同一项目和搜索条件只允许发起一次首屏请求。
    if (initialLoadKeyRef.current === loadKey) return undefined;
    const timer = window.setTimeout(() => {
      initialLoadKeyRef.current = loadKey;
      void loadRequirementsRef.current(keyword, 1);
    }, 250);
    // 项目或顶部搜索条件变化时重新读取第一页。
    return () => window.clearTimeout(timer);
  }, [keyword, project.projectId, project.projectType]);

  useEffect(() => {
    onRefreshToolbarChange?.(
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={loading}
        onClick={() => void loadRequirements(keyword, 1)}
      >
        {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
      </Button>
    );
    return () => onRefreshToolbarChange?.(null);
  }, [intl, keyword, loadRequirements, loading, onRefreshToolbarChange]);

  const hasMore =
    project.projectType === 'operation' &&
    (total > requirements.length || (total === 0 && requirements.length === PAGE_SIZE));
  const sentinelRef = useInfiniteScroll(() => {
    if (hasMore) void loadRequirements(keyword, page + 1);
  }, hasMore && !loading && !loadingMore);

  const handleStartRequirement = async () => {
    if (!startTarget || starting) return;
    const requirementId = Number(startTarget.itemId ?? startTarget.sourceId ?? startTarget.requirementId);
    if (!Number.isFinite(requirementId) || !splitTasks.every((task) => task.title.trim() && task.assignee)) {
      message.error(intl.formatMessage({ id: 'projectSpace.requirements.missingAssignee' }));
      return;
    }
    setStarting(true);
    try {
      await startOperationRequirement({
        requirementId,
        tasks: splitTasks.map((task) => ({
          title: task.title.trim(),
          description: task.description.trim() || startTarget.description || startTarget.sourceDescription,
          assignee: task.assignee,
          dueTime: startTarget.dueTime,
        })),
      });
      message.success(intl.formatMessage({ id: 'projectSpace.requirements.startSuccess' }));
      setStartTarget(null);
      setSplitTasks([]);
      await loadRequirements(keyword, 1);
      // 运营需求拆分成功后，任务列表是下一步操作入口，自动切回任务 tab。
      onStarted?.();
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.requirements.startFailed' }));
    } finally {
      setStarting(false);
    }
  };

  const handleAddSplitTask = () => {
    const requirementTitle =
      startTarget?.title ||
      startTarget?.requirementName ||
      startTarget?.sourceName ||
      intl.formatMessage({ id: 'projectSpace.requirements.operationRequirement' });
    const defaultAssignee = startTarget?.assigneeId ?? startTarget?.assignee;
    setSplitTasks((current) => [
      ...current,
      {
        title: intl.formatMessage(
          { id: 'projectSpace.requirements.generatedTaskName' },
          { requirement: requirementTitle, index: current.length + 1 }
        ),
        description: '',
        assignee: defaultAssignee,
      },
    ]);
  };

  const handleRemoveSplitTask = (index: number) => {
    if (splitTasks.length <= 1) return;
    const taskName =
      splitTasks[index]?.title?.trim() ||
      intl.formatMessage({ id: 'projectSpace.requirements.taskIndex' }, { index: index + 1 });
    // 删除拆分任务会直接移除当前草稿，先二次确认避免误操作。
    Modal.confirm({
      title: intl.formatMessage({ id: 'projectSpace.requirements.deleteTaskTitle' }),
      content: intl.formatMessage({ id: 'projectSpace.requirements.deleteTaskContent' }, { name: taskName }),
      okText: intl.formatMessage({ id: 'common.delete' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      okButtonProps: { danger: true },
      onOk: () => {
        setSplitTasks((current) =>
          current.length <= 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)
        );
      },
    });
  };

  const handleUpdateRequirement = async (values: OperationTaskFormValues) => {
    if (!editingRequirement || requirementSaving) return;
    const itemId = Number(editingRequirement.itemId ?? editingRequirement.sourceId ?? editingRequirement.requirementId);
    if (!Number.isFinite(itemId)) {
      message.error(intl.formatMessage({ id: 'projectSpace.requirements.invalidIdEdit' }));
      return;
    }
    setRequirementSaving(true);
    try {
      await updateOperationRequirement({
        itemId,
        requirementName: values.taskName.trim(),
        sourceDescription: values.description?.trim() || undefined,
        operationType: values.taskType === 'content' ? 'publish' : values.taskType,
        assignee: values.assigneeId,
        dueTime: values.dueTime?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
        // 简化需求表单不修改执行配置，保留原需求已有配置，防止编辑基础信息时清空历史字段。
        config: editingRequirement.config,
      });
      message.success(intl.formatMessage({ id: 'projectSpace.requirements.updateSuccess' }));
      setEditingRequirement(null);
      await loadRequirements(keyword, 1);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.requirements.updateFailed' }));
    } finally {
      setRequirementSaving(false);
    }
  };

  const handleDeleteRequirement = (item: Record<string, any>) => {
    const itemId = Number(item.itemId ?? item.sourceId ?? item.requirementId);
    if (!Number.isFinite(itemId)) {
      message.error(intl.formatMessage({ id: 'projectSpace.requirements.invalidIdDelete' }));
      return;
    }
    const title =
      item.title ||
      item.requirementName ||
      item.sourceName ||
      intl.formatMessage({ id: 'projectSpace.requirements.currentRequirement' });
    const status = `${item.status || item.action || ''}`.trim().toLowerCase();
    const isRunningRequirement = ['launched', 'doing', 'running', 'in_progress', 'processing', '进行中'].includes(
      status
    );
    Modal.confirm({
      title: intl.formatMessage({ id: 'projectSpace.requirements.deleteTitle' }),
      content: intl.formatMessage({ id: 'projectSpace.requirements.deleteContent' }, { name: title }),
      okText: intl.formatMessage({ id: 'common.delete' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (isRunningRequirement) {
          // 进行中的需求可能仍有任务在执行，删除前增加第二次强确认，降低误删风险。
          const confirmed = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: intl.formatMessage({ id: 'projectSpace.requirements.deleteRunningTitle' }),
              content: intl.formatMessage({ id: 'projectSpace.requirements.deleteRunningContent' }, { name: title }),
              okText: intl.formatMessage({ id: 'projectSpace.requirements.confirmDelete' }),
              cancelText: intl.formatMessage({ id: 'common.cancel' }),
              okButtonProps: { danger: true },
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });
          if (!confirmed) return;
        }
        try {
          await deleteOperationRequirement(itemId);
          message.success(intl.formatMessage({ id: 'projectSpace.requirements.deleteSuccess' }));
          setRequirementDetail(null);
          await loadRequirements(keyword, 1);
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'projectSpace.requirements.deleteFailed' }));
        }
      },
    });
  };

  return (
    <div className={styles.dataPanel}>
      <Spin spinning={loading}>
        {requirements.length ? (
          <div className={styles.dataCardGrid}>
            {requirements.map((requirement: any, index) => {
              const item = requirement as Partial<ProjectRequirement> & Record<string, any>;
              const operationType = normalizeRequirementType(item);
              const sourceType = `${item.sourceType || item.operationType || ''}`.trim().toLowerCase();
              const typeBadge =
                project.projectType === 'operation'
                  ? REQUIREMENT_TYPE_BADGES[operationType]
                  : DEVELOP_REQUIREMENT_TYPE_BADGES[sourceType];
              const canStartDevelopRequirement =
                project.projectType === 'develop' &&
                developInitReady &&
                !item.sessionId &&
                !item.taskId &&
                ['todo', 'pending', '待开始', ''].includes(`${item.status || ''}`.toLowerCase());
              const canShowRequirementActions =
                project.projectType === 'operation' && (isPendingRequirement(item) || isRequirementCreator(item));
              const formattedCreateTime =
                item.createTime && dayjs(item.createTime).isValid()
                  ? dayjs(item.createTime).format('YYYY-MM-DD HH:mm')
                  : '-';
              const assignee =
                item.assigneeName ||
                item.assigneeUserName ||
                item.memberName ||
                (typeof item.assignee === 'object' ? item.assignee.name || item.assignee.userName : item.assignee) ||
                '-';
              return (
                <article
                  key={`${item.requirementId || item.itemId || item.sourceId || index}`}
                  className={styles.dataCard}
                  role="button"
                  tabIndex={0}
                  onClick={() => setRequirementDetail(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setRequirementDetail(item);
                  }}
                >
                  <div className={styles.dataCardHeader}>
                    {typeBadge && (
                      <span className={`${styles.requirementTypeBadge} ${styles[typeBadge.className]}`}>
                        {intl.formatMessage({ id: typeBadge.labelId })}
                      </span>
                    )}
                    <Typography.Text
                      strong
                      ellipsis={{ tooltip: item.title || item.requirementName || item.sourceName }}
                    >
                      {item.title || item.requirementName || item.sourceName || '-'}
                    </Typography.Text>
                    <div className={styles.requirementCardStatusActions}>
                      <Tag
                        className={`${styles.requirementStatusTag} ${
                          isPendingRequirement(item) ? styles.requirementStatusTagWithAction : ''
                        }`}
                        color={getRequirementStatusColor(item.status)}
                      >
                        {getRequirementStatusLabel(item.status, intl)}
                      </Tag>
                      {project.projectType === 'operation' && isPendingRequirement(item) && (
                        <Button
                          type="link"
                          size="small"
                          className={styles.requirementExecuteButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            const defaultAssignee = item.assigneeId ?? item.assignee;
                            const requirementTitle =
                              item.title ||
                              item.requirementName ||
                              item.sourceName ||
                              intl.formatMessage({ id: 'projectSpace.requirements.operationRequirement' });
                            setStartTarget(item);
                            setSplitTasks([
                              {
                                title: intl.formatMessage(
                                  { id: 'projectSpace.requirements.defaultTask.collectTitle' },
                                  { requirement: requirementTitle }
                                ),
                                description: intl.formatMessage(
                                  { id: 'projectSpace.requirements.defaultTask.collectDescription' },
                                  { requirement: requirementTitle }
                                ),
                                assignee: defaultAssignee,
                              },
                              {
                                title: intl.formatMessage(
                                  { id: 'projectSpace.requirements.defaultTask.organizeTitle' },
                                  { requirement: requirementTitle }
                                ),
                                description: intl.formatMessage(
                                  { id: 'projectSpace.requirements.defaultTask.organizeDescription' },
                                  { requirement: requirementTitle }
                                ),
                                assignee: defaultAssignee,
                              },
                              {
                                title: intl.formatMessage(
                                  { id: 'projectSpace.requirements.defaultTask.archiveTitle' },
                                  { requirement: requirementTitle }
                                ),
                                description: intl.formatMessage(
                                  { id: 'projectSpace.requirements.defaultTask.archiveDescription' },
                                  { requirement: requirementTitle }
                                ),
                                assignee: defaultAssignee,
                              },
                            ]);
                          }}
                        >
                          {intl.formatMessage({ id: 'projectSpace.requirements.splitTasks' })}
                        </Button>
                      )}
                      {canStartDevelopRequirement && (
                        <Button
                          type="link"
                          size="small"
                          className={styles.requirementExecuteButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDevelopSplitTarget(item);
                          }}
                        >
                          {intl.formatMessage({ id: 'projectSpace.requirements.start' })}
                        </Button>
                      )}
                    </div>
                  </div>
                  <Typography.Paragraph className={styles.dataCardDescription} ellipsis={{ rows: 2 }}>
                    {item.sourceDescription || item.description || item.originalContent || '-'}
                  </Typography.Paragraph>
                  {project.projectType === 'operation' ? (
                    <div className={styles.requirementMeta}>
                      <Typography.Text type="secondary" ellipsis={{ tooltip: `${assignee}` }}>
                        {assignee}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        className={
                          isPendingRequirement(item) || isRequirementCreator(item)
                            ? styles.requirementDueTimeWithAction
                            : undefined
                        }
                      >
                        {formattedCreateTime}
                      </Typography.Text>
                    </div>
                  ) : (
                    <div className={styles.developRequirementMeta}>
                      <Typography.Text type="secondary">{formattedCreateTime}</Typography.Text>
                    </div>
                  )}
                  {canShowRequirementActions && (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          ...(isPendingRequirement(item)
                            ? [{ key: 'edit', label: intl.formatMessage({ id: 'common.edit' }) }]
                            : []),
                          ...(isRequirementCreator(item)
                            ? [{ key: 'delete', label: intl.formatMessage({ id: 'common.delete' }), danger: true }]
                            : []),
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'edit') setEditingRequirement(item);
                          if (key === 'delete') handleDeleteRequirement(item);
                        },
                      }}
                    >
                      {/* 放在状态容器外，绝对定位才能以整张需求卡片为基准落到右下角。 */}
                      <Button
                        type="text"
                        size="small"
                        className={styles.cardMoreAction}
                        icon={<MoreOutlined />}
                        aria-label={intl.formatMessage({ id: 'projectSpace.requirements.actions' })}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          !loading && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'projectSpace.requirements.empty' })}
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
      <Drawer
        open={!!requirementDetail}
        title={intl.formatMessage({ id: 'projectSpace.requirements.detailTitle' })}
        className={detailStyles.requirementDetailDrawer}
        width={640}
        onClose={() => setRequirementDetail(null)}
        destroyOnClose
      >
        {requirementDetail && (
          <div className={detailStyles.requirementDetailDrawerContent}>
            {/* 与任务详情保持一致：抽屉标题只表达页面类型，业务名称和状态放在内容顶部。 */}
            <div className={detailStyles.requirementDetailTitleRow}>
              <div className={detailStyles.requirementDetailTitle}>
                {requirementDetail.title ||
                  requirementDetail.requirementName ||
                  requirementDetail.sourceName ||
                  intl.formatMessage({ id: 'projectSpace.requirements.unnamed' })}
              </div>
              <Tag color={getRequirementStatusColor(requirementDetail.status)}>
                {getRequirementStatusLabel(requirementDetail.status, intl)}
              </Tag>
            </div>

            <section className={detailStyles.requirementDetailSection}>
              <h3>{intl.formatMessage({ id: 'projectSpace.requirements.basicInfo' })}</h3>
              <div className={detailStyles.requirementDetailInfoGrid}>
                <div className={detailStyles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.requirements.id' })}</label>
                  <span>
                    {requirementDetail.itemId || requirementDetail.requirementId || requirementDetail.sourceId || '-'}
                  </span>
                </div>
                <div className={detailStyles.requirementDetailInfoItem}>
                  <label>{intl.formatMessage({ id: 'projectSpace.requirements.type' })}</label>
                  <span>
                    {project.projectType === 'develop'
                      ? getDevelopRequirementTypeLabel(requirementDetail, intl)
                      : intl.formatMessage({
                        id: `projectSpace.operation.task.type.${normalizeRequirementType(requirementDetail)}`,
                      })}
                  </span>
                </div>
                {(requirementDetail.assignee || requirementDetail.assigneeName) && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.assignee' })}</label>
                    <span>{requirementDetail.assigneeName || requirementDetail.assignee}</span>
                  </div>
                )}
                {requirementDetail.dueTime && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.dueTime' })}</label>
                    <span>
                      {dayjs(requirementDetail.dueTime).isValid()
                        ? dayjs(requirementDetail.dueTime).format('YYYY-MM-DD HH:mm')
                        : requirementDetail.dueTime}
                    </span>
                  </div>
                )}
                {requirementDetail.createTime && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.createTime' })}</label>
                    <span>
                      {dayjs(requirementDetail.createTime).isValid()
                        ? dayjs(requirementDetail.createTime).format('YYYY-MM-DD HH:mm')
                        : requirementDetail.createTime}
                    </span>
                  </div>
                )}
                {(requirementDetail.createByName || requirementDetail.createBy) && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.creator' })}</label>
                    <span>{requirementDetail.createByName || requirementDetail.createBy}</span>
                  </div>
                )}
                {requirementDetail.sourceName && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.source' })}</label>
                    <span>{requirementDetail.sourceName}</span>
                  </div>
                )}
                {requirementDetail.branch && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.branch' })}</label>
                    <span>{requirementDetail.branch}</span>
                  </div>
                )}
                {requirementDetail.priority && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.priority' })}</label>
                    <span>{requirementDetail.priority}</span>
                  </div>
                )}
                {requirementDetail.score !== undefined && requirementDetail.score !== null && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>{intl.formatMessage({ id: 'projectSpace.requirements.score' })}</label>
                    <span>{requirementDetail.score}</span>
                  </div>
                )}
              </div>
            </section>

            <section className={detailStyles.requirementDetailSection}>
              <h3>{intl.formatMessage({ id: 'projectSpace.requirements.description' })}</h3>
              <div className={detailStyles.requirementDetailText}>
                {requirementDetail.sourceDescription ||
                  requirementDetail.description ||
                  requirementDetail.originalContent ||
                  requirementDetail.content ||
                  '-'}
              </div>
            </section>
            {requirementDetail.productContent && (
              <section className={detailStyles.requirementDetailSection}>
                <h3>{intl.formatMessage({ id: 'projectSpace.requirements.productContent' })}</h3>
                <div className={detailStyles.requirementDetailText}>{requirementDetail.productContent}</div>
              </section>
            )}
            {requirementDetail.config && Object.keys(requirementDetail.config).length > 0 && (
              <section className={detailStyles.requirementDetailSection}>
                <h3>{intl.formatMessage({ id: 'projectSpace.requirements.executionConfig' })}</h3>
                <div className={detailStyles.requirementDetailText}>
                  {JSON.stringify(requirementDetail.config, null, 2)}
                </div>
              </section>
            )}
          </div>
        )}
      </Drawer>
      <RequirementSplitModal
        open={!!developSplitTarget}
        requirement={
          developSplitTarget
            ? {
              title:
                  developSplitTarget.title ||
                  developSplitTarget.requirementName ||
                  developSplitTarget.sourceName ||
                  intl.formatMessage({ id: 'projectSpace.requirements.developRequirement' }),
              description:
                  developSplitTarget.description ||
                  developSplitTarget.sourceDescription ||
                  developSplitTarget.originalContent,
            }
            : null
        }
        presplitTarget={
          developSplitTarget
            ? {
              projectId: Number(project.projectId),
              sourceItemId: Number(
                developSplitTarget.itemId ?? developSplitTarget.sourceId ?? developSplitTarget.requirementId
              ),
            }
            : null
        }
        repos={developSplitRepos}
        members={splitAssignees}
        defaultAssigneeId={defaultDevelopAssigneeId}
        confirmLoading={developSplitConfirming}
        onCancel={() => setDevelopSplitTarget(null)}
        onConfirm={(tasks) => void handleConfirmDevelopSplit(tasks)}
      />
      <OperationTaskFormModal
        open={!!editingRequirement}
        mode="edit"
        entityLabel="requirement"
        simpleRequirement
        initialValues={
          editingRequirement
            ? {
              taskName:
                  editingRequirement.title || editingRequirement.requirementName || editingRequirement.sourceName || '',
              description: editingRequirement.sourceDescription || editingRequirement.description || '',
              taskType: normalizeRequirementType(editingRequirement),
              assigneeId: editingRequirement.assigneeId,
              dueTime: editingRequirement.dueTime ? dayjs(editingRequirement.dueTime) : undefined,
            }
            : undefined
        }
        options={{ assignees: splitAssignees }}
        loading={requirementSaving}
        onCancel={() => setEditingRequirement(null)}
        onSubmit={handleUpdateRequirement}
      />
      <Modal
        open={!!startTarget}
        title={intl.formatMessage({ id: 'projectSpace.requirements.splitTasks' })}
        width={760}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        confirmLoading={starting}
        onCancel={() => {
          setStartTarget(null);
          setSplitTasks([]);
        }}
        onOk={() => void handleStartRequirement()}
      >
        <Typography.Paragraph type="secondary">
          {intl.formatMessage({ id: 'projectSpace.requirements.splitHint' })}
        </Typography.Paragraph>
        <div className={styles.splitTaskToolbar}>
          <Typography.Text strong>{intl.formatMessage({ id: 'projectSpace.requirements.taskList' })}</Typography.Text>
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={handleAddSplitTask}>
            {intl.formatMessage({ id: 'projectSpace.requirements.addTask' })}
          </Button>
        </div>
        <div className={styles.splitTaskList}>
          {splitTasks.map((task, index) => (
            <div key={index} className={styles.splitTaskCard}>
              <div className={styles.splitTaskHeader}>
                <Typography.Text strong>
                  {intl.formatMessage({ id: 'projectSpace.requirements.taskIndex' }, { index: index + 1 })}
                </Typography.Text>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={splitTasks.length <= 1}
                  aria-label={intl.formatMessage(
                    { id: 'projectSpace.requirements.deleteTaskAria' },
                    { index: index + 1 }
                  )}
                  onClick={() => handleRemoveSplitTask(index)}
                />
              </div>
              <Input
                addonBefore={intl.formatMessage(
                  { id: 'projectSpace.requirements.taskNameIndex' },
                  { index: index + 1 }
                )}
                value={task.title}
                onChange={(event) =>
                  setSplitTasks((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, title: event.target.value } : item
                    )
                  )
                }
              />
              <Input.TextArea
                style={{ marginTop: 10 }}
                rows={2}
                value={task.description}
                placeholder={intl.formatMessage({ id: 'projectSpace.requirements.taskDescription' })}
                onChange={(event) =>
                  setSplitTasks((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, description: event.target.value } : item
                    )
                  )
                }
              />
              <Select
                style={{ width: '100%', marginTop: 10 }}
                placeholder={intl.formatMessage({ id: 'projectSpace.requirements.assigneePlaceholder' })}
                value={task.assignee}
                options={splitAssignees}
                onChange={(value) =>
                  setSplitTasks((current) =>
                    current.map((item, itemIndex) => (itemIndex === index ? { ...item, assignee: value } : item))
                  )
                }
              />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default ProjectRequirements;
