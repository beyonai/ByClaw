import { useIntl, useSelector } from '@umijs/max';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppstoreOutlined, CloudOutlined, LaptopOutlined, UserOutlined } from '@ant-design/icons';
import { Select, Slider, Spin, Tabs, Tag, Empty, Tooltip } from 'antd';
import { getMyModels, getPublicModels } from '@/pages/models/service';
import {
  THINKING_LEVEL_DEFAULT_SIGNAL,
  resolveThinkingPanelLevel,
  thinkingCapabilityTag,
  thinkingLevelsFor,
  type ModelReasoningConfig,
} from '@/utils/thinkingLevel';
import styles from './index.less';

type Props = {
  value?: string | number;
  onChange: (value?: string) => void;

  /**
   * 网页端是否渲染选择器：桌面端始终渲染（本地/我的/公共三 tab）；
   * 网页端仅在个人数字员工会话传入 true，渲染我的/公共两 tab 并额外提供「默认模型」。
   */
  allowWeb?: boolean;

  /** 本会话已显式选择的思考强度：undefined=未选择，'-1'=跟随默认，其余为档位。 */
  level?: string;

  /** 思考强度选择结果；'-1' 表示「跟随默认/恢复默认」（清除服务端覆盖）。 */
  onLevelChange?: (level?: string) => void;
};

const rowsOf = (response: any) => {
  const data = response?.data ?? response ?? {};
  const rows = Array.isArray(data)
    ? data
    : data.rows ||
      data.list ||
      data.records ||
      (Array.isArray(data.data) ? data.data : data.data?.rows || data.data?.list) ||
      [];
  return (Array.isArray(rows) ? rows : []).filter((item: any) => {
    const type = `${item?.modelType || 'LLM'}`.trim().toUpperCase();
    const status = item?.status === undefined || item?.status === null ? 'ENABLED' : `${item.status}`;
    return type === 'LLM' && (status.toUpperCase() === 'ENABLED' || status === '1');
  });
};

const reasoningOf = (item: any): ModelReasoningConfig | undefined => {
  const config = item?.reasoningConfig;
  return config && typeof config === 'object' ? (config as ModelReasoningConfig) : undefined;
};

const REASONING_LABEL_GAP = 12;

/** Pick the smallest regular sampling stride whose visible labels no longer overlap. */
export const reasoningLabelStrideFor = (trackWidth: number, labelWidths: number[], gap = REASONING_LABEL_GAP) => {
  if (labelWidths.length < 2 || trackWidth <= 0) return 1;
  const pointGap = trackWidth / (labelWidths.length - 1);
  for (let stride = 1; stride < labelWidths.length; stride += 1) {
    let previousRight = Number.NEGATIVE_INFINITY;
    let overlaps = false;
    for (let index = 0; index < labelWidths.length; index += stride) {
      const center = pointGap * index;
      const left = center - labelWidths[index] / 2;
      if (left < previousRight + gap) {
        overlaps = true;
        break;
      }
      previousRight = center + labelWidths[index] / 2;
    }
    if (!overlaps) return stride;
  }
  return labelWidths.length;
};

/** Session model picker: desktop (local/mine/public) and web (mine/public) modes. */
type Model = {
  id: string;
  label: string;
  provider?: string;
  source: 'local' | 'mine' | 'public';
  reasoning?: ModelReasoningConfig;
};
const ModelSelect: React.FC<Props> = ({ value, onChange, allowWeb = false, level, onLevelChange }) => {
  const intl = useIntl();
  const authIdentity = useSelector(({ user }: any) => {
    const userInfo = user?.userInfo;
    return userInfo ? `${userInfo.sessionId || userInfo.userId || userInfo.id || 'authenticated'}` : '';
  });
  const desktop = typeof window !== 'undefined' && Boolean(window.byclawDesktop);
  const enabled = desktop || allowWeb;
  // 网页端没有「本地」tab，默认停在「我的」，避免首次展开显示空列表。
  const [activeTab, setActiveTab] = useState<'local' | 'mine' | 'public'>(desktop ? 'local' : 'mine');
  const [groups, setGroups] = useState<Record<'local' | 'mine' | 'public', Model[]>>({
    local: [],
    mine: [],
    public: [],
  });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [previewModelId, setPreviewModelId] = useState<string | undefined>(undefined);
  const [reasoningLabelStride, setReasoningLabelStride] = useState(1);
  const reasoningSliderFrameRef = useRef<HTMLDivElement>(null);
  const reasoningLabelMeasureRef = useRef<HTMLDivElement>(null);
  // 悬停面板中的调整先按模型暂存；点击对应模型行后，模型与档位才一起生效。
  const [draftLevels, setDraftLevels] = useState<Record<string, string>>({});
  const storageKey = 'byclaw.desktop.selected-model';
  const current = value === undefined || value === null || `${value}` === '' ? undefined : `${value}`;
  // '-1' 是父组件显式选择「默认模型」的信号，区别于「本会话尚未选择」。
  const explicitDefault = current === '-1';

  useEffect(() => {
    if (!enabled) return undefined;
    // `/chat` is rendered before login so the login modal can be displayed. Do not consume the
    // one-shot web model load while requests still have no credentials; login updates Redux and
    // changes authIdentity, which causes this effect to fetch the lists without a page refresh.
    if (!desktop && !authIdentity) {
      setGroups({ local: [], mine: [], public: [] });
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const localModels = desktop ? window.byclawDesktop?.models?.local : undefined;
    const localPromise = localModels ? localModels().catch(() => []) : Promise.resolve([]);
    const myModelsPromise = authIdentity
      ? getMyModels({ pageNum: 1, pageSize: 100, modelType: 'LLM', status: 'ENABLED' })
      : Promise.resolve([]);
    const publicModelsPromise = authIdentity
      ? getPublicModels({ pageNum: 1, pageSize: 100, modelType: 'LLM' })
      : Promise.resolve([]);
    Promise.all([localPromise, myModelsPromise, publicModelsPromise])
      .then(([local, mine, shared]) => {
        if (cancelled) return;
        const normalize = (item: any, source: Model['source']): Model | null => {
          const id = item?.id ?? item?.modelId ?? item?.modelCode ?? item?.code;
          if (!id) return null;
          const reasoning = reasoningOf(item);
          return {
            id: `${id}`,
            label: item.displayName || item.modelName || item.modelCode || `${id}`,
            provider: item.providerName || item.provider,
            source,
            ...(reasoning ? { reasoning } : {}),
          };
        };
        const dedupe = (items: Model[]) =>
          items.filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
        const localModels = (Array.isArray(local) ? local : []).map((item: any) => ({
          id: item.id,
          label: item.name || item.id,
          provider: item.provider,
          source: 'local' as const,
        }));
        setGroups({
          local: dedupe(localModels),
          mine: dedupe(
            rowsOf(mine)
              .map((item: any) => normalize(item, 'mine'))
              .filter(Boolean) as Model[]
          ),
          public: dedupe(
            rowsOf(shared)
              .map((item: any) => normalize(item, 'public'))
              .filter(Boolean) as Model[]
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setGroups({ local: [], mine: [], public: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authIdentity, desktop, enabled]);

  // Preserve the original picker behavior: a new desktop session always gets
  // a usable default model, while an explicitly selected model is untouched.
  // 网页端不自动选中，空值即「默认模型」；显式选择「默认模型」时也不自动改回。
  useEffect(() => {
    if (!desktop || explicitDefault) return;
    if (value !== undefined && value !== null && `${value}` !== '') return;
    const saved = window.localStorage.getItem(storageKey);
    const all = [...groups.local, ...groups.mine, ...groups.public];
    const first = all.find((item) => item.id === saved) || groups.local[0] || groups.mine[0] || groups.public[0];
    if (first) onChange(first.id);
  }, [desktop, explicitDefault, groups, value, onChange]);

  const selectModel = (next?: string) => {
    if (desktop && next) window.localStorage.setItem(storageKey, next);
    onChange(next);
    setOpen(false);
  };

  const updateDraftLevel = (model: Model, nextLevel: string) => {
    setDraftLevels((previous) => ({ ...previous, [model.id]: nextLevel }));
  };

  const confirmModel = (modelId: string) => {
    if (desktop) window.localStorage.setItem(storageKey, modelId);
    onChange(modelId);
    const draftLevel = draftLevels[modelId];
    if (draftLevel) onLevelChange?.(draftLevel);
    setOpen(false);
  };

  const allModels = useMemo(() => [...groups.local, ...groups.mine, ...groups.public], [groups]);
  const options = useMemo(
    () =>
      groups[activeTab].map((item) => ({
        value: item.id,
        label: (
          <span className={styles.option}>
            <span>{item.label}</span>
            {item.provider && <Tag bordered={false}>{item.provider}</Tag>}
          </span>
        ),
      })),
    [activeTab, groups]
  );

  const isDefaultChoice = current === undefined || explicitDefault;
  const selectedModel = allModels.find((item) => item.id === current);
  // 右栏展示悬停中的模型，否则展示当前会话模型；两种状态都可直接调整。
  const previewModel = previewModelId ? allModels.find((item) => item.id === previewModelId) : undefined;
  const reasoningPanelModel = previewModel && previewModel.id !== current ? previewModel : selectedModel;
  const reasoningPanelIsCurrent = Boolean(reasoningPanelModel && reasoningPanelModel.id === current);
  const explicitLevel =
    level === undefined || level === null || `${level}` === '' || `${level}` === THINKING_LEVEL_DEFAULT_SIGNAL
      ? undefined
      : `${level}`;
  const draftLevel = reasoningPanelModel ? draftLevels[reasoningPanelModel.id] : undefined;
  const reasoningLevels = thinkingLevelsFor(reasoningPanelModel?.reasoning);
  const reasoningTag = thinkingCapabilityTag(reasoningPanelModel?.reasoning)
    ? intl.formatMessage({ id: 'ui.model.reasoning.supported' })
    : undefined;
  const reasoningLevel = resolveThinkingPanelLevel({
    reasoning: reasoningPanelModel?.reasoning,
    explicitLevel: draftLevel || (reasoningPanelIsCurrent ? explicitLevel : undefined),
  });
  const reasoningLevelIndex = Math.max(0, reasoningLevels.indexOf(reasoningLevel as never));
  const reasoningMarks = reasoningLevels.reduce<Record<number, React.ReactNode>>((marks, item, index) => {
    const hitArea = (
      <span
        className={styles.reasoningMarkHitArea}
        role="button"
        aria-label={item}
        tabIndex={-1}
        // Keep the Select option from treating a reasoning-node click as a model selection.
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (reasoningPanelModel) updateDraftLevel(reasoningPanelModel, item);
        }}
      />
    );
    marks[index] = (
      <span className={styles.reasoningMark}>
        <Tooltip title={item}>{hitArea}</Tooltip>
        {index % reasoningLabelStride === 0 && <span className={styles.reasoningMarkLabel}>{item}</span>}
      </span>
    );
    return marks;
  }, {});
  const reasoningLevelsKey = reasoningLevels.join('|');

  useLayoutEffect(() => {
    if (!open || reasoningLevels.length < 2) {
      setReasoningLabelStride(1);
      return undefined;
    }
    const frame = reasoningSliderFrameRef.current;
    const measure = reasoningLabelMeasureRef.current;
    // The application customizes Ant Design's prefixCls (for example `beyond-slider`),
    // so locate the root through the accessible slider handle instead of a hard-coded class.
    const slider = frame?.querySelector<HTMLElement>('[role="slider"]')?.parentElement;
    if (!slider || !measure) return undefined;

    const updateStride = () => {
      const widths = Array.from(measure.children).map((node) => node.getBoundingClientRect().width);
      const nextStride = reasoningLabelStrideFor(slider.getBoundingClientRect().width, widths);
      setReasoningLabelStride((currentStride) => (currentStride === nextStride ? currentStride : nextStride));
    };
    updateStride();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateStride);
    observer.observe(slider);
    return () => observer.disconnect();
  }, [open, reasoningLevelsKey, reasoningLevels.length]);

  const reasoningHint = draftLevel
    ? intl.formatMessage({ id: 'ui.model.reasoning.pending' })
    : reasoningPanelIsCurrent && explicitLevel
      ? intl.formatMessage({ id: 'ui.model.reasoning.applied' })
      : intl.formatMessage({ id: 'ui.model.reasoning.followingDefault' });
  if (!enabled) return null;
  const tabs = [
    {
      key: 'mine',
      label: (
        <>
          <UserOutlined /> {intl.formatMessage({ id: 'ui.model.mine' })}
        </>
      ),
    },
    {
      key: 'public',
      label: (
        <>
          <CloudOutlined /> {intl.formatMessage({ id: 'ui.model.public' })}
        </>
      ),
    },
  ];
  if (desktop) {
    tabs.unshift({
      key: 'local',
      label: (
        <>
          <LaptopOutlined /> {intl.formatMessage({ id: 'ui.model.local' })}
        </>
      ),
    });
  }
  return (
    <Select
      className={styles.select}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // F10: 关闭下拉时复位悬停预览，避免重开显示上次悬停模型的只读卡片。
        if (!next) setPreviewModelId(undefined);
      }}
      size="middle"
      value={current}
      labelRender={() =>
        selectedModel ? (
          <span className={styles.option}>
            <span>{selectedModel.label}</span>
            {selectedModel.provider && <Tag bordered={false}>{selectedModel.provider}</Tag>}
          </span>
        ) : (
          intl.formatMessage({ id: 'ui.model.default' })
        )
      }
      placeholder={intl.formatMessage({ id: 'ui.model.default' })}
      loading={loading}
      suffixIcon={loading ? <Spin size="small" /> : <AppstoreOutlined />}
      options={options}
      onChange={(next) => selectModel(next ? `${next}` : undefined)}
      popupMatchSelectWidth={360}
      popupClassName={styles.popup}
      dropdownRender={() => (
        <div className={styles.panel}>
          <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} items={tabs} />
          <div className={styles.body}>
            <div className={styles.list}>
              <div
                key="__default__"
                className={`${styles.item} ${isDefaultChoice ? styles.selected : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectModel(undefined)}
                onMouseEnter={() => setPreviewModelId(undefined)}
              >
                <span className={styles.option}>
                  <span>{intl.formatMessage({ id: 'ui.model.default' })}</span>
                </span>
              </div>
              {options.length ? (
                options.map((option) => (
                  <div
                    key={option.value}
                    data-testid={`model-row-${option.value}`}
                    className={`${styles.item} ${option.value === current ? styles.selected : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => confirmModel(option.value)}
                    onMouseEnter={() => setPreviewModelId(option.value)}
                  >
                    {option.label}
                  </div>
                ))
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    loading
                      ? intl.formatMessage({ id: 'ui.model.loading' })
                      : intl.formatMessage({ id: 'ui.model.empty' })
                  }
                />
              )}
            </div>
            {reasoningPanelModel && (
              <div
                className={styles.reasoning}
                data-testid="model-reasoning-panel"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className={styles.reasoningHeader}>
                  <span className={styles.reasoningTitle}>{reasoningPanelModel.label}</span>
                  <span className={styles.reasoningTags}>
                    {reasoningPanelModel.provider && <Tag bordered={false}>{reasoningPanelModel.provider}</Tag>}
                    {reasoningTag && <Tag bordered={false}>{reasoningTag}</Tag>}
                  </span>
                </div>
                <div className={styles.reasoningDivider} />
                {reasoningLevels.length > 0 ? (
                  <>
                    <div className={styles.reasoningRow}>
                      <span>{intl.formatMessage({ id: 'ui.model.reasoning.title' })}</span>
                      {draftLevel || (reasoningPanelIsCurrent && explicitLevel) ? (
                        <a
                          className={styles.reasoningReset}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => updateDraftLevel(reasoningPanelModel, THINKING_LEVEL_DEFAULT_SIGNAL)}
                        >
                          {intl.formatMessage({ id: 'ui.model.reasoning.reset' })}
                        </a>
                      ) : (
                        <a
                          className={styles.reasoningReset}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => updateDraftLevel(reasoningPanelModel, THINKING_LEVEL_DEFAULT_SIGNAL)}
                        >
                          {intl.formatMessage({ id: 'ui.model.reasoning.followDefault' })}
                        </a>
                      )}
                    </div>
                    <div className={styles.reasoningSliderFrame} ref={reasoningSliderFrameRef}>
                      <Slider
                        className={styles.reasoningSlider}
                        min={0}
                        max={reasoningLevels.length - 1}
                        step={1}
                        value={reasoningLevelIndex}
                        tooltip={{ formatter: (index) => reasoningLevels[index ?? 0] }}
                        marks={reasoningMarks}
                        onChange={(index) => {
                          const next = reasoningLevels[index as number];
                          if (next) updateDraftLevel(reasoningPanelModel, next);
                        }}
                        aria-label={intl.formatMessage({ id: 'ui.model.reasoning.title' })}
                      />
                      <div className={styles.reasoningLabelMeasure} ref={reasoningLabelMeasureRef} aria-hidden="true">
                        {reasoningLevels.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </div>
                    <div className={styles.reasoningHint} data-testid="model-reasoning-hint">
                      {reasoningHint}
                    </div>
                  </>
                ) : (
                  <div className={styles.reasoningUnavailable} data-testid="model-reasoning-unavailable">
                    {intl.formatMessage({ id: 'ui.model.reasoning.unavailable' })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      aria-label={intl.formatMessage({ id: 'ui.model.current' })}
    />
  );
};

export default ModelSelect;
