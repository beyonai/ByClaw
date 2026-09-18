import React, { useEffect, useMemo, useState } from 'react';
import { AppstoreOutlined, CloudOutlined, LaptopOutlined, UserOutlined } from '@ant-design/icons';
import { Select, Slider, Spin, Tabs, Tag, Empty } from 'antd';
import { getMyModels, getPublicModels } from '@/pages/models/service';
import {
  THINKING_LEVEL_DEFAULT_SIGNAL,
  resolveThinkingPanelLevel,
  thinkingCapabilityTag,
  thinkingLevelsFor,
  thinkingPanelHint,
  thinkingPanelTitle,
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

/** Session model picker: desktop (local/mine/public) and web (mine/public) modes. */
type Model = {
  id: string;
  label: string;
  provider?: string;
  source: 'local' | 'mine' | 'public';
  reasoning?: ModelReasoningConfig;
};
const ModelSelect: React.FC<Props> = ({ value, onChange, allowWeb = false, level, onLevelChange }) => {
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
  // 悬停面板中的调整先按模型暂存；点击对应模型行后，模型与档位才一起生效。
  const [draftLevels, setDraftLevels] = useState<Record<string, string>>({});
  const storageKey = 'byclaw.desktop.selected-model';
  const current = value === undefined || value === null || `${value}` === '' ? undefined : `${value}`;
  // '-1' 是父组件显式选择「默认模型」的信号，区别于「本会话尚未选择」。
  const explicitDefault = current === '-1';

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    const localModels = desktop ? window.byclawDesktop?.models?.local : undefined;
    const localPromise = localModels ? localModels().catch(() => []) : Promise.resolve([]);
    Promise.all([
      localPromise,
      getMyModels({ pageNum: 1, pageSize: 100, modelType: 'LLM', status: 'ENABLED' }),
      getPublicModels({ pageNum: 1, pageSize: 100, modelType: 'LLM' }),
    ])
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
  }, [desktop, enabled]);

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

  if (!enabled) return null;
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
  const reasoningTag = thinkingCapabilityTag(reasoningPanelModel?.reasoning);
  const reasoningLevel = resolveThinkingPanelLevel({
    reasoning: reasoningPanelModel?.reasoning,
    explicitLevel: draftLevel || (reasoningPanelIsCurrent ? explicitLevel : undefined),
  });
  const reasoningMarks = reasoningLevels.reduce<Record<number, string>>((marks, item, index) => {
    // 与后台模型编辑页的 supportedEfforts 回显一致，直接展示 low/high/xhigh 等原始档位名。
    marks[index] = item;
    return marks;
  }, {});
  let reasoningHint = thinkingPanelHint({
    reasoning: reasoningPanelModel?.reasoning,
    preview: false,
    explicitLevel: reasoningPanelIsCurrent ? explicitLevel : undefined,
  });
  if (draftLevel) reasoningHint = '待确认，点击模型后生效';
  const tabs = [
    {
      key: 'mine',
      label: (
        <>
          <UserOutlined /> 我的
        </>
      ),
    },
    {
      key: 'public',
      label: (
        <>
          <CloudOutlined /> 公共
        </>
      ),
    },
  ];
  if (desktop) {
    tabs.unshift({
      key: 'local',
      label: (
        <>
          <LaptopOutlined /> 本地
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
          '默认模型'
        )
      }
      placeholder="默认模型"
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
                  <span>默认模型</span>
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
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中…' : '暂无模型'} />
              )}
            </div>
            {reasoningPanelModel && (
              <div className={styles.reasoning} data-testid="model-reasoning-panel">
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
                      <span>{thinkingPanelTitle()}</span>
                      {draftLevel || (reasoningPanelIsCurrent && explicitLevel) ? (
                        <a
                          className={styles.reasoningReset}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => updateDraftLevel(reasoningPanelModel, THINKING_LEVEL_DEFAULT_SIGNAL)}
                        >
                          恢复默认
                        </a>
                      ) : (
                        <a
                          className={styles.reasoningReset}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => updateDraftLevel(reasoningPanelModel, THINKING_LEVEL_DEFAULT_SIGNAL)}
                        >
                          跟随默认
                        </a>
                      )}
                    </div>
                    <Slider
                      className={styles.reasoningSlider}
                      min={0}
                      max={reasoningLevels.length - 1}
                      step={1}
                      value={Math.max(0, reasoningLevels.indexOf(reasoningLevel as never))}
                      tooltip={{ open: false }}
                      marks={reasoningMarks}
                      onChange={(index) => {
                        const next = reasoningLevels[index as number];
                        if (next) updateDraftLevel(reasoningPanelModel, next);
                      }}
                      aria-label={thinkingPanelTitle()}
                    />
                    <div className={styles.reasoningHint} data-testid="model-reasoning-hint">
                      {reasoningHint}
                    </div>
                  </>
                ) : (
                  <div className={styles.reasoningUnavailable} data-testid="model-reasoning-unavailable">
                    该模型未在后台配置可调思考强度
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      aria-label="当前会话模型"
    />
  );
};

export default ModelSelect;
