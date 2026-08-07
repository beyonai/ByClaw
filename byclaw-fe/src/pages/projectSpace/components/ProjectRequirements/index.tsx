import { Button, Empty, Input, Modal, Select, Spin, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import {
  listOperationRequirements,
  listProjectMembers,
  listRequirementsByProject,
  startOperationRequirement,
} from '@/service/devloop';
import type { ProjectRequirement, ProjectSpace } from '../../types';
import { getArrayData, getPageTotal } from '../../utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  keyword?: string;
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;

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

const getRequirementTypeColor = (item: Record<string, any>, operationType: string) => {
  const sourceType = `${item.sourceType || item.operationType || ''}`.trim().toLowerCase();
  const colorMap: Record<string, string> = {
    collect: 'blue',
    knowledge: 'purple',
    content: 'cyan',
    analyze: 'orange',
    dingtalk: 'blue',
    dingtalk_group: 'geekblue',
    dingtalk_group_message: 'geekblue',
    dingtalk_todo: 'gold',
    github_issue: 'green',
    github_issues: 'green',
    manual: 'default',
  };
  const typeKey = item.operationType || item.taskType ? operationType : sourceType;
  return colorMap[typeKey] || 'default';
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

const ProjectRequirements: React.FC<Props> = ({ project, keyword = '', onToolbarChange, onStarted }) => {
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
        setRequirements((current) => (nextPage === 1 ? rows : [...current, ...rows]));
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
    if (!startTarget || project.projectType !== 'operation') return;
    void listProjectMembers(Number(project.projectId)).then((response) => {
      setSplitAssignees(
        getArrayData(response).map((member: any) => ({
          label: member.userName || member.userCode || `${member.userId}`,
          value: member.userId,
        }))
      );
    });
  }, [project.projectId, project.projectType, startTarget]);

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
    onToolbarChange?.(
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={loading}
        onClick={() => void loadRequirements(keyword, 1)}
      >
        {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
      </Button>
    );
    return () => onToolbarChange?.(null);
  }, [intl, keyword, loadRequirements, loading, onToolbarChange]);

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
    setSplitTasks((current) => (current.length <= 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)));
  };

  return (
    <div className={styles.dataPanel}>
      <Spin spinning={loading}>
        {requirements.length ? (
          <div className={styles.dataCardGrid}>
            {requirements.map((requirement: any, index) => {
              const item = requirement as Partial<ProjectRequirement> & Record<string, any>;
              const operationType = normalizeRequirementType(item);
              const dueTime = item.dueTime || item.expectedTime || item.deadline;
              const formattedDueTime = dueTime && dayjs(dueTime).isValid() ? dayjs(dueTime).format('YYYY-MM-DD') : '-';
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
                >
                  <div className={styles.dataCardHeader}>
                    <Typography.Text
                      strong
                      ellipsis={{ tooltip: item.title || item.requirementName || item.sourceName }}
                    >
                      {item.title || item.requirementName || item.sourceName || '-'}
                    </Typography.Text>
                    <div className={styles.requirementCardStatusActions}>
                      <Tag className={styles.requirementStatusTag} color={getRequirementStatusColor(item.status)}>
                        {getRequirementStatusLabel(item.status)}
                      </Tag>
                      {project.projectType === 'operation' && item.status === 'todo' && (
                        <Button
                          type="link"
                          size="small"
                          className={styles.requirementExecuteButton}
                          onClick={() => {
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
                    </div>
                  </div>
                  <div className={styles.requirementTypeRow}>
                    {project.projectType === 'operation' ? (
                      <Tag color={getRequirementTypeColor(item, operationType)}>
                        {intl.formatMessage({ id: `projectSpace.operation.task.type.${operationType}` })}
                      </Tag>
                    ) : item.sourceType || item.operationType ? (
                      <Tag color={getRequirementTypeColor(item, operationType)}>
                        {getDevelopRequirementTypeLabel(item, intl)}
                      </Tag>
                    ) : null}
                  </div>
                  <Typography.Paragraph className={styles.dataCardDescription} ellipsis={{ rows: 3 }}>
                    {item.sourceDescription || item.description || item.originalContent || '-'}
                  </Typography.Paragraph>
                  {project.projectType === 'operation' ? (
                    <div className={styles.requirementMeta}>
                      <Typography.Text type="secondary" ellipsis={{ tooltip: `${assignee}` }}>
                        {assignee}
                      </Typography.Text>
                      <Typography.Text type="secondary">{formattedDueTime}</Typography.Text>
                    </div>
                  ) : (
                    <Typography.Text type="secondary">{item.status || item.action || '-'}</Typography.Text>
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
      <Modal
        open={!!startTarget}
        title="拆分运营需求"
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
