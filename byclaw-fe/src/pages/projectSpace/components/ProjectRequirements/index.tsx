import {
  Button,
  Drawer,
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

// 运营需求名称前使用单字标签快速区分类型，完整类型名称仍在下一行保留。
const REQUIREMENT_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  collect: { label: '采', className: 'requirementTypeBadgeCollect' },
  knowledge: { label: '整', className: 'requirementTypeBadgeKnowledge' },
  content: { label: '创', className: 'requirementTypeBadgeContent' },
  analyze: { label: '析', className: 'requirementTypeBadgeAnalyze' },
};

const DEVELOP_REQUIREMENT_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  dingtalk: { label: '钉', className: 'requirementTypeBadgeDingtalk' },
  dingtalk_group: { label: '钉', className: 'requirementTypeBadgeDingtalk' },
  dingtalk_group_message: { label: '钉', className: 'requirementTypeBadgeDingtalk' },
  dingtalk_todo: { label: '钉', className: 'requirementTypeBadgeDingtalk' },
  github_issue: { label: 'Git', className: 'requirementTypeBadgeGithub' },
  github_issues: { label: 'Git', className: 'requirementTypeBadgeGithub' },
  manual: { label: '手', className: 'requirementTypeBadgeManual' },
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

const getRequirementStatusLabel = (status: unknown) => {
  const value = `${status || ''}`.trim().toLowerCase();
  if (value === 'todo' || value === 'pending') return '待开始';
  if (value === 'launched' || value === 'doing' || value === 'running') return '进行中';
  if (value === 'done' || value === 'completed') return '已完成';
  return `${status || '待开始'}`;
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
  if (['done', 'completed', 'finished', 'closed', 'failed', 'error', 'cancelled', '已完成', '完成', '失败'].includes(status)) {
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

const ProjectRequirements: React.FC<Props> = ({
  project,
  keyword = '',
  onRefreshToolbarChange,
  onStarted,
}) => {
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
      message.error('当前需求缺少有效编号，无法启动');
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
      message.success('需求已拆分并启动');
      setDevelopSplitTarget(null);
      await loadRequirements(keyword, 1);
      onStarted?.();
    } catch (error: any) {
      message.error(error?.message || '需求拆分失败');
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
      message.error('当前需求缺少负责人，无法启动');
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
      message.success('需求已启动');
      setStartTarget(null);
      setSplitTasks([]);
      await loadRequirements(keyword, 1);
      // 运营需求拆分成功后，任务列表是下一步操作入口，自动切回任务 tab。
      onStarted?.();
    } catch (error: any) {
      message.error(error?.message || '需求启动失败');
    } finally {
      setStarting(false);
    }
  };

  const handleAddSplitTask = () => {
    const requirementTitle =
      startTarget?.title || startTarget?.requirementName || startTarget?.sourceName || '运营需求';
    const defaultAssignee = startTarget?.assigneeId ?? startTarget?.assignee;
    setSplitTasks((current) => [
      ...current,
      {
        title: `${requirementTitle} - 任务${current.length + 1}`,
        description: '',
        assignee: defaultAssignee,
      },
    ]);
  };

  const handleRemoveSplitTask = (index: number) => {
    if (splitTasks.length <= 1) return;
    const taskName = splitTasks[index]?.title?.trim() || `任务${index + 1}`;
    // 删除拆分任务会直接移除当前草稿，先二次确认避免误操作。
    Modal.confirm({
      title: '确认删除任务？',
      content: `删除“${taskName}”后无法恢复，是否继续？`,
      okText: '删除',
      cancelText: '取消',
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
    const itemId = Number(
      editingRequirement.itemId ?? editingRequirement.sourceId ?? editingRequirement.requirementId
    );
    if (!Number.isFinite(itemId)) {
      message.error('需求缺少有效编号，无法编辑');
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
      message.success('需求已更新');
      setEditingRequirement(null);
      await loadRequirements(keyword, 1);
    } catch (error: any) {
      message.error(error?.message || '需求更新失败');
    } finally {
      setRequirementSaving(false);
    }
  };

  const handleDeleteRequirement = (item: Record<string, any>) => {
    const itemId = Number(item.itemId ?? item.sourceId ?? item.requirementId);
    if (!Number.isFinite(itemId)) {
      message.error('需求缺少有效编号，无法删除');
      return;
    }
    const title = item.title || item.requirementName || item.sourceName || '当前需求';
    const status = `${item.status || item.action || ''}`.trim().toLowerCase();
    const isRunningRequirement = ['launched', 'doing', 'running', 'in_progress', 'processing', '进行中'].includes(
      status
    );
    Modal.confirm({
      title: '确认删除需求？',
      content: `删除“${title}”后将不再展示其关联任务，是否继续？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (isRunningRequirement) {
          // 进行中的需求可能仍有任务在执行，删除前增加第二次强确认，降低误删风险。
          const confirmed = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: '再次确认删除进行中的需求？',
              content: `“${title}”仍在进行中，删除后关联任务也将从项目列表隐藏，请再次确认。`,
              okText: '确认删除',
              cancelText: '取消',
              okButtonProps: { danger: true },
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });
          if (!confirmed) return;
        }
        try {
          await deleteOperationRequirement(itemId);
          message.success('需求已删除');
          setRequirementDetail(null);
          await loadRequirements(keyword, 1);
        } catch (error: any) {
          message.error(error?.message || '需求删除失败');
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
                        {typeBadge.label}
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
                        {getRequirementStatusLabel(item.status)}
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
                              item.title || item.requirementName || item.sourceName || '运营需求';
                            setStartTarget(item);
                            setSplitTasks([
                              {
                                title: `${requirementTitle} - 素材采集`,
                                description: `围绕“${requirementTitle}”采集相关素材并保留来源信息。`,
                                assignee: defaultAssignee,
                              },
                              {
                                title: `${requirementTitle} - 素材整理`,
                                description: `对“${requirementTitle}”采集素材完成去重、摘要和要点提炼。`,
                                assignee: defaultAssignee,
                              },
                              {
                                title: `${requirementTitle} - 知识归档`,
                                description: `将“${requirementTitle}”整理结果归档到指定知识库。`,
                                assignee: defaultAssignee,
                              },
                            ]);
                          }}
                        >
                          拆分任务
                        </Button>
                      )}
                      {project.projectType === 'develop' &&
                        developInitReady &&
                        !item.sessionId &&
                        !item.taskId &&
                        ['todo', 'pending', '待开始', ''].includes(`${item.status || ''}`.toLowerCase()) && (
                        <Button
                          type="link"
                          size="small"
                          className={styles.requirementExecuteButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDevelopSplitTarget(item);
                          }}
                        >
                          启动
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
                  {project.projectType === 'operation' &&
                    (isPendingRequirement(item) || isRequirementCreator(item)) && (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          ...(isPendingRequirement(item) ? [{ key: 'edit', label: '编辑' }] : []),
                          ...(isRequirementCreator(item) ? [{ key: 'delete', label: '删除', danger: true }] : []),
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
                        aria-label="需求操作"
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
        title="需求详情"
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
                  '未命名需求'}
              </div>
              <Tag color={getRequirementStatusColor(requirementDetail.status)}>
                {getRequirementStatusLabel(requirementDetail.status)}
              </Tag>
            </div>

            <section className={detailStyles.requirementDetailSection}>
              <h3>基本信息</h3>
              <div className={detailStyles.requirementDetailInfoGrid}>
                <div className={detailStyles.requirementDetailInfoItem}>
                  <label>需求编号</label>
                  <span>
                    {requirementDetail.itemId || requirementDetail.requirementId || requirementDetail.sourceId || '-'}
                  </span>
                </div>
                <div className={detailStyles.requirementDetailInfoItem}>
                  <label>需求类型</label>
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
                    <label>指定成员</label>
                    <span>{requirementDetail.assigneeName || requirementDetail.assignee}</span>
                  </div>
                )}
                {requirementDetail.dueTime && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>预期时间</label>
                    <span>
                      {dayjs(requirementDetail.dueTime).isValid()
                        ? dayjs(requirementDetail.dueTime).format('YYYY-MM-DD HH:mm')
                        : requirementDetail.dueTime}
                    </span>
                  </div>
                )}
                {requirementDetail.createTime && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>创建时间</label>
                    <span>
                      {dayjs(requirementDetail.createTime).isValid()
                        ? dayjs(requirementDetail.createTime).format('YYYY-MM-DD HH:mm')
                        : requirementDetail.createTime}
                    </span>
                  </div>
                )}
                {(requirementDetail.createByName || requirementDetail.createBy) && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>创建人</label>
                    <span>{requirementDetail.createByName || requirementDetail.createBy}</span>
                  </div>
                )}
                {requirementDetail.sourceName && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>需求来源</label>
                    <span>{requirementDetail.sourceName}</span>
                  </div>
                )}
                {requirementDetail.branch && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>分支</label>
                    <span>{requirementDetail.branch}</span>
                  </div>
                )}
                {requirementDetail.priority && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>优先级</label>
                    <span>{requirementDetail.priority}</span>
                  </div>
                )}
                {requirementDetail.score !== undefined && requirementDetail.score !== null && (
                  <div className={detailStyles.requirementDetailInfoItem}>
                    <label>评分</label>
                    <span>{requirementDetail.score}</span>
                  </div>
                )}
              </div>
            </section>

            <section className={detailStyles.requirementDetailSection}>
              <h3>需求描述</h3>
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
                <h3>产品补充</h3>
                <div className={detailStyles.requirementDetailText}>
                  {requirementDetail.productContent}
                </div>
              </section>
            )}
            {requirementDetail.config && Object.keys(requirementDetail.config).length > 0 && (
              <section className={detailStyles.requirementDetailSection}>
                <h3>执行配置</h3>
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
                  '研发需求',
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
                  editingRequirement.title ||
                  editingRequirement.requirementName ||
                  editingRequirement.sourceName ||
                  '',
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
        title="拆分任务"
        width={760}
        okText="确定"
        confirmLoading={starting}
        onCancel={() => {
          setStartTarget(null);
          setSplitTasks([]);
        }}
        onOk={() => void handleStartRequirement()}
      >
        <Typography.Paragraph type="secondary">
          系统已按需求生成 3 个任务，可修改任务名称和描述，负责人沿用需求负责人。
        </Typography.Paragraph>
        <div className={styles.splitTaskToolbar}>
          <Typography.Text strong>任务列表</Typography.Text>
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={handleAddSplitTask}>
            新增任务
          </Button>
        </div>
        <div className={styles.splitTaskList}>
          {splitTasks.map((task, index) => (
            <div key={index} className={styles.splitTaskCard}>
              <div className={styles.splitTaskHeader}>
                <Typography.Text strong>任务 {index + 1}</Typography.Text>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={splitTasks.length <= 1}
                  aria-label={`删除任务${index + 1}`}
                  onClick={() => handleRemoveSplitTask(index)}
                />
              </div>
              <Input
                addonBefore={`${index + 1}. 任务名称`}
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
                placeholder="任务描述"
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
                placeholder="请选择负责人"
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
