import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Segmented, Select, Skeleton, Tag, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';
import { buildFallbackSplit, buildLayers } from './heuristics';
import { presplitRequirement } from '@/service/devloop';
import type { MemberOption, RepoOption, SplitTaskDraft } from './types';

type SplitView = 'list' | 'graph';

// DAG 画布几何常量:列=拓扑深度,行=同层次序。边的锚点按这套尺寸算,改卡片尺寸需同步。
const NODE_W = 220;
const NODE_H = 168;
const COL_GAP = 72;
const ROW_GAP = 28;
const PAD = 24;

type RequirementSplitModalProps = {
  open: boolean;
  // 待拆分的需求(标题/描述用于展示;AI 预拆的输入由后端按 presplitTarget 自己查)。
  requirement: { title: string; description?: string } | null;
  // 有值才走后端 AI 预拆;为空(如运营任务拆分,没有需求ID)时退化为每仓库一行。
  presplitTarget?: { projectId: number; sourceItemId: number } | null;
  repos: RepoOption[];
  // 父组件复用已有仓库新增弹窗，拆分弹窗只负责触发入口并在新增后接收刷新后的仓库列表。
  onAddRepository?: () => void;
  // 承接人候选:项目成员,与原有任务负责人同源。
  members: MemberOption[];
  // 当前登录用户在项目成员中的标识，作为 AI 拆分任务的默认承接人。
  defaultAssigneeId?: string | number;
  confirmLoading?: boolean;
  onCancel: () => void;
  // 确认后把拆分草稿交回父级,由父级调 splitTask 批量建会话并落库依赖。
  onConfirm: (tasks: SplitTaskDraft[]) => void;
};

const RequirementSplitModal: React.FC<RequirementSplitModalProps> = ({
  open,
  requirement,
  presplitTarget,
  repos,
  onAddRepository,
  members,
  defaultAssigneeId,
  confirmLoading,
  onCancel,
  onConfirm,
}) => {
  const intl = useIntl();
  const t = React.useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.detail.${id}` }, values),
    [intl]
  );

  const [tasks, setTasks] = useState<SplitTaskDraft[]>([]);
  // 视图切换:默认列表,用户可切到依赖图。
  const [view, setView] = useState<SplitView>('list');
  // AI 预拆在弹窗打开后异步进行,期间列表位置显示骨架。
  const [presplitting, setPresplitting] = useState(false);
  // 模型不可用/输出不可解析时后端降级为每仓库一行,这里记原因用于提示"未使用 AI"。
  const [degradeReason, setDegradeReason] = useState<string | undefined>(undefined);
  // 竞态与脏数据保护:只有最后一次请求的结果可以覆盖草稿,且用户已编辑过就不再覆盖。
  const presplitSeq = useRef(0);
  const userEdited = useRef(false);

  // 用户改过任何一行后就不能再被模型结果冲掉,否则异步返回会吃掉用户输入。
  const markEdited = useCallback(() => {
    userEdited.current = true;
  }, []);

  // 父级把 requirement/presplitTarget/repos 作为内联字面量传入,每次渲染都是新身份。
  // 依赖必须收敛到原始值,否则 effect 每渲染都跑一次,预拆请求会无限重发。
  const requirementTitle = requirement?.title;
  const presplitProjectId = presplitTarget?.projectId;
  const presplitSourceItemId = presplitTarget?.sourceItemId;
  const repoKey = repos.map((repo) => repo.repoId).join(',');

  useEffect(() => {
    if (!open || !requirementTitle) {
      // 关闭即清空:否则下次打开会先闪一帧上一条需求的草稿,且那一帧 canConfirm 可能为真。
      // seq 自增让仍在飞的上一轮请求结果作废。
      presplitSeq.current += 1;
      setTasks([]);
      setPresplitting(false);
      setDegradeReason(undefined);
      return;
    }
    const seq = ++presplitSeq.current;
    userEdited.current = false;
    setView('list');
    setDegradeReason(undefined);
    // 当前用户是项目成员时，预拆与后续新增任务均默认由当前用户承接，仍可手动调整。
    const withAssignee = (draft: SplitTaskDraft[]) =>
      draft.map((task) => ({ ...task, assigneeId: task.assigneeId ?? defaultAssigneeId }));
    if (presplitProjectId === undefined || presplitSourceItemId === undefined) {
      // 没有需求ID(运营任务拆分入口)无法调后端预拆,直接给每仓库一行且不标 AI。
      setTasks(withAssignee(buildFallbackSplit(requirementTitle, repos)));
      setPresplitting(false);
      return;
    }
    setTasks([]);
    setPresplitting(true);
    presplitRequirement({ projectId: presplitProjectId, sourceItemId: presplitSourceItemId })
      .then((result) => {
        if (seq !== presplitSeq.current || userEdited.current) {
          return;
        }
        if (!result?.tasks?.length) {
          setTasks(withAssignee(buildFallbackSplit(requirementTitle, repos)));
          setDegradeReason('empty_result');
          return;
        }
        setDegradeReason(result.aiSuggested ? undefined : result.degradeReason || 'degraded');
        setTasks(
          withAssignee(
            result.tasks.map((task) => ({
              rowId: task.rowId,
              title: task.title || requirementTitle,
              repoId: task.repoId,
              branch: task.branch || '',
              dependsOn: task.dependsOn || [],
              // 只有后端确认出自模型才标 AI,降级结果不冒充模型产出。
              aiSuggested: result.aiSuggested,
              reason: task.reason,
            }))
          )
        );
      })
      .catch(() => {
        if (seq !== presplitSeq.current || userEdited.current) {
          return;
        }
        setTasks(withAssignee(buildFallbackSplit(requirementTitle, repos)));
        setDegradeReason('request_failed');
      })
      .finally(() => {
        if (seq === presplitSeq.current) {
          setPresplitting(false);
        }
      });
    // repos 只用于降级兜底,以 repoKey 收敛身份;requirement/presplitTarget 同理只取原始值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAssigneeId, open, presplitProjectId, presplitSourceItemId, repoKey, requirementTitle]);

  const repoOptions = useMemo(
    () =>
      repos.map((repo) => ({
        value: repo.repoId,
        label: repo.repoFullName || repo.repoUrl || String(repo.repoId),
      })),
    [repos]
  );

  const repoLabelOf = (repoId?: number) =>
    repoOptions.find((option) => option.value === repoId)?.label ?? t('reqSplit.placeholder.repo');

  // 布局:分层 + 画布尺寸。节点绝对定位,边画在底层 SVG。
  const layers = useMemo(() => buildLayers(tasks), [tasks]);
  const posOf = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    layers.forEach((node) => {
      map.set(node.task.rowId, {
        x: PAD + node.depth * (NODE_W + COL_GAP),
        y: PAD + node.order * (NODE_H + ROW_GAP),
      });
    });
    return map;
  }, [layers]);

  const canvasSize = useMemo(() => {
    const maxDepth = layers.reduce((max, node) => Math.max(max, node.depth), 0);
    const maxOrder = layers.reduce((max, node) => Math.max(max, node.order), 0);
    return {
      width: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP,
      height: PAD * 2 + (maxOrder + 1) * NODE_H + maxOrder * ROW_GAP,
    };
  }, [layers]);

  const patchTask = (rowId: string, patch: Partial<SplitTaskDraft>) => {
    markEdited();
    setTasks((prev) => prev.map((task) => (task.rowId === rowId ? { ...task, ...patch } : task)));
  };

  // 仓库为空时可直接进入项目仓库新增流程，避免用户关闭拆分弹窗后再返回项目配置补数据。
  const renderRepositorySelect = (task: SplitTaskDraft, className?: string) => (
    <div className={styles.splitRepositoryControl}>
      <Select
        size="small"
        className={className || styles.splitCellSelect}
        placeholder={t('reqSplit.placeholder.repo')}
        value={task.repoId}
        options={repoOptions}
        onChange={(repoId) => patchTask(task.rowId, { repoId })}
      />
      {onAddRepository && (
        <Tooltip title={t('reqSplit.addRepository')}>
          <Button
            type="text"
            size="small"
            className={styles.splitRepositoryAddButton}
            icon={<PlusOutlined />}
            aria-label={t('reqSplit.addRepository')}
            onClick={onAddRepository}
          />
        </Tooltip>
      )}
    </div>
  );

  const removeTask = (rowId: string) => {
    markEdited();
    // 删节点同时断开所有指向它的依赖边,避免悬空引用。
    setTasks((prev) =>
      prev
        .filter((task) => task.rowId !== rowId)
        .map((task) => ({ ...task, dependsOn: task.dependsOn.filter((dep) => dep !== rowId) }))
    );
  };

  const addTask = () => {
    markEdited();
    setTasks((prev) => [
      ...prev,
      {
        rowId: `row-${Date.now()}`,
        title: '',
        repoId: repos[0]?.repoId,
        branch: '',
        assigneeId: defaultAssigneeId,
        dependsOn: [],
        aiSuggested: false,
      },
    ]);
  };

  // 至少一行、且每行都填了标题/选了仓库/分支/承接成员才允许确认;预拆未回来时不能确认(草稿还是空的)。
  const canConfirm =
    !presplitting &&
    tasks.length > 0 &&
    tasks.every(
      (task) =>
        task.title.trim() !== '' &&
        task.repoId !== undefined &&
        task.branch.trim() !== '' &&
        task.assigneeId !== undefined &&
        `${task.assigneeId}` !== ''
    );

  // 依赖候选:除自己外的所有任务,label 用任务标题(标题空时退化到仓库名)。
  const depOptionsFor = (rowId: string) =>
    tasks
      .filter((other) => other.rowId !== rowId)
      .map((other) => ({
        value: other.rowId,
        label: other.title.trim() || repoLabelOf(other.repoId),
      }));

  // 列表视图:一行一个任务(标题 + 仓库 + 分支 + 承接成员 + 依赖),窄栏友好、默认视图。
  const renderList = () => (
    <div className={styles.splitTable}>
      <div className={styles.splitRowHead}>
        <span className={styles.colTitle}>{t('reqSplit.col.title')}</span>
        <span className={styles.colRepo}>{t('reqSplit.col.repo')}</span>
        <span className={styles.colBranch}>{t('reqSplit.col.branch')}</span>
        <span className={styles.colMember}>{t('reqSplit.col.member')}</span>
        <span className={styles.colDep}>{t('reqSplit.col.dependsOn')}</span>
        <span className={styles.colOps} />
      </div>
      {tasks.map((task) => (
        <div className={styles.splitRow} key={task.rowId}>
          <div className={styles.colTitle}>
            <Input
              size="small"
              placeholder={t('reqSplit.placeholder.title')}
              value={task.title}
              onChange={(event) => patchTask(task.rowId, { title: event.target.value })}
            />
          </div>
          <div className={styles.colRepo}>{renderRepositorySelect(task)}</div>
          <div className={styles.colBranch}>
            <Input
              size="small"
              placeholder={t('reqSplit.placeholder.branch')}
              value={task.branch}
              onChange={(event) => patchTask(task.rowId, { branch: event.target.value })}
            />
          </div>
          <div className={styles.colMember}>
            <Select
              size="small"
              showSearch
              optionFilterProp="label"
              className={styles.splitCellSelect}
              suffixIcon={<UserOutlined />}
              value={task.assigneeId}
              placeholder={t('reqSplit.placeholder.member')}
              options={members}
              notFoundContent={members.length ? undefined : t('reqSplit.noMembers')}
              onChange={(assigneeId) => patchTask(task.rowId, { assigneeId })}
            />
          </div>
          <div className={styles.colDep}>
            <Tooltip title={t('reqSplit.dependsOnHint')}>
              <Select
                size="small"
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                className={styles.splitCellSelect}
                placeholder={t('reqSplit.placeholder.dependsOn')}
                value={task.dependsOn}
                options={depOptionsFor(task.rowId)}
                onChange={(dependsOn) => patchTask(task.rowId, { dependsOn })}
              />
            </Tooltip>
          </div>
          <div className={styles.colOps}>
            {task.aiSuggested ? <Tag className={styles.splitAiTag}>{t('reqSplit.aiTag')}</Tag> : null}
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={t('common.delete')}
              onClick={() => removeTask(task.rowId)}
            />
          </div>
        </div>
      ))}
    </div>
  );

  // 依赖图视图:节点绝对定位,边画在底层 SVG。箭头方向 = 上游 → 下游(先做 → 后做)。
  const renderGraph = () => (
    <div className={styles.splitCanvasWrap}>
      <div className={styles.splitCanvas} style={{ width: canvasSize.width, height: canvasSize.height }}>
        <svg className={styles.splitEdges} width={canvasSize.width} height={canvasSize.height}>
          <defs>
            <marker id="splitArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#1677ff" />
            </marker>
          </defs>
          {tasks.flatMap((task) =>
            task.dependsOn.map((depId) => {
              const from = posOf.get(depId);
              const to = posOf.get(task.rowId);
              if (!from || !to) return null;
              // 从上游卡右侧中点连到下游卡左侧中点,中段贝塞尔避免直线穿卡。
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={`${depId}-${task.rowId}`}
                  className={styles.splitEdgePath}
                  d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                  markerEnd="url(#splitArrow)"
                />
              );
            })
          )}
        </svg>
        {layers.map((node) => {
          const { task } = node;
          const pos = posOf.get(task.rowId)!;
          return (
            <div
              className={styles.splitNode}
              key={task.rowId}
              style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
            >
              <div className={styles.splitNodeHead}>
                <Input
                  size="small"
                  variant="borderless"
                  className={styles.splitNodeTitle}
                  placeholder={t('reqSplit.placeholder.title')}
                  value={task.title}
                  onChange={(event) => patchTask(task.rowId, { title: event.target.value })}
                />
                <div className={styles.splitNodeHeadOps}>
                  {task.aiSuggested ? <Tag className={styles.splitAiTag}>{t('reqSplit.aiTag')}</Tag> : null}
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t('common.delete')}
                    onClick={() => removeTask(task.rowId)}
                  />
                </div>
              </div>

              <div className={styles.splitNodeField}>{renderRepositorySelect(task, styles.splitNodeRepo)}</div>

              <div className={styles.splitNodeField}>
                <Input
                  size="small"
                  placeholder={t('reqSplit.placeholder.branch')}
                  value={task.branch}
                  onChange={(event) => patchTask(task.rowId, { branch: event.target.value })}
                />
              </div>

              <div className={styles.splitNodeField}>
                <Select
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  className={styles.splitCellSelect}
                  suffixIcon={<UserOutlined />}
                  value={task.assigneeId}
                  placeholder={t('reqSplit.placeholder.member')}
                  options={members}
                  notFoundContent={members.length ? undefined : t('reqSplit.noMembers')}
                  onChange={(assigneeId) => patchTask(task.rowId, { assigneeId })}
                />
              </div>

              <div className={styles.splitNodeField}>
                <Tooltip title={t('reqSplit.dependsOnHint')}>
                  <Select
                    size="small"
                    mode="multiple"
                    allowClear
                    maxTagCount="responsive"
                    className={styles.splitCellSelect}
                    placeholder={t('reqSplit.placeholder.dependsOn')}
                    value={task.dependsOn}
                    options={depOptionsFor(task.rowId)}
                    onChange={(dependsOn) => patchTask(task.rowId, { dependsOn })}
                  />
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Modal
      title={
        <div className={styles.splitTitle}>
          <h3>{t('reqSplit.title')}</h3>
          <p>{t('reqSplit.subtitle')}</p>
        </div>
      }
      open={open}
      onCancel={onCancel}
      onOk={() => onConfirm(tasks)}
      okButtonProps={{ disabled: !canConfirm }}
      confirmLoading={confirmLoading}
      okText={t('reqSplit.confirm')}
      cancelText={t('common.cancel')}
      width={960}
      centered
      // 运营任务详情由 Drawer 展示，拆分弹窗需覆盖抽屉；仓库新增弹窗继续使用 1200 层级。
      zIndex={1100}
      className={styles.splitModal}
    >
      <div className={styles.splitBody}>
        {/* 需求头:这张需求将落成下面多个仓库任务(列表或依赖图两种视图)。 */}
        <div className={styles.splitReqHead}>
          <span className={styles.splitReqLabel}>{t('reqSplit.reqLabel')}</span>
          <strong className={styles.splitReqName}>{requirement?.title ?? '-'}</strong>
        </div>
        {requirement?.description ? <p className={styles.splitReqDesc}>{requirement.description}</p> : null}

        <div className={styles.splitToolbar}>
          <div className={styles.splitAiHint}>
            <ThunderboltOutlined className={styles.splitAiIcon} />
            <span>
              {presplitting
                ? t('reqSplit.presplitting')
                : view === 'graph'
                  ? t('reqSplit.graphHint')
                  : t('reqSplit.listHint')}
            </span>
          </div>
          {/* 列表/图切换,默认列表。 */}
          <Segmented
            size="small"
            value={view}
            onChange={(value) => setView(value as SplitView)}
            options={[
              { value: 'list', label: t('reqSplit.view.list'), icon: <UnorderedListOutlined /> },
              { value: 'graph', label: t('reqSplit.view.graph'), icon: <ApartmentOutlined /> },
            ]}
          />
        </div>

        {/* 模型不可用/输出不可解析时后端已降级为每仓库一行,必须让用户知道这不是 AI 拆的。 */}
        {degradeReason ? (
          <Alert type="warning" showIcon className={styles.splitDegradeAlert} message={t('reqSplit.degradeHint')} />
        ) : null}

        {/* 预拆异步进行中先占位,骨架行数按仓库数,视觉上和最终列表对齐。 */}
        {presplitting ? (
          <div className={styles.splitSkeleton}>
            <Skeleton active title={false} paragraph={{ rows: Math.max(repos.length, 2) }} />
          </div>
        ) : view === 'list' ? (
          renderList()
        ) : (
          renderGraph()
        )}

        <div className={styles.splitCanvasFooter}>
          {/* 预拆返回前新增的行会被结果覆盖(userEdited 只保护已有行的编辑),所以加载中先禁用。 */}
          <Button size="small" type="dashed" icon={<PlusOutlined />} disabled={presplitting} onClick={addTask}>
            {t('reqSplit.addTask')}
          </Button>
          <p className={styles.splitFootNote}>{t('reqSplit.footNote', { count: tasks.length })}</p>
        </div>
      </div>
    </Modal>
  );
};

export default RequirementSplitModal;
