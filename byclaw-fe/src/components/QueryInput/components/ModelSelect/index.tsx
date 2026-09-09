import React, { useEffect, useMemo, useState } from 'react';
import { AppstoreOutlined, CloudOutlined, LaptopOutlined, UserOutlined } from '@ant-design/icons';
import { Select, Spin, Tabs, Tag, Empty } from 'antd';
import { getMyModels, getPublicModels } from '@/pages/models/service';
import styles from './index.less';

type Props = {
  value?: string | number;
  onChange: (value?: string) => void;

  /**
   * 网页端是否渲染选择器：桌面端始终渲染（本地/我的/公共三 tab）；
   * 网页端仅在个人数字员工会话传入 true，渲染我的/公共两 tab 并额外提供「默认模型」。
   */
  allowWeb?: boolean;
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

/** Session model picker: desktop (local/mine/public) and web (mine/public) modes. */
type Model = { id: string; label: string; provider?: string; source: 'local' | 'mine' | 'public' };
const ModelSelect: React.FC<Props> = ({ value, onChange, allowWeb = false }) => {
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
          return id
            ? {
                id: `${id}`,
                label: item.displayName || item.modelName || item.modelCode || `${id}`,
                provider: item.providerName || item.provider,
                source,
              }
            : null;
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
  const tabs = desktop
    ? [
        {
          key: 'local',
          label: (
            <>
              <LaptopOutlined /> 本地
            </>
          ),
        },
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
      ]
    : [
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
  return (
    <Select
      className={styles.select}
      open={open}
      onOpenChange={setOpen}
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
      dropdownRender={() => (
        <div className={styles.panel}>
          <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} items={tabs} />
          <div className={styles.list}>
            <div
              key="__default__"
              className={`${styles.item} ${isDefaultChoice ? styles.selected : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectModel(undefined)}
            >
              <span className={styles.option}>
                <span>默认模型</span>
              </span>
            </div>
            {options.length ? (
              options.map((option) => (
                <div
                  key={option.value}
                  className={`${styles.item} ${option.value === current ? styles.selected : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectModel(option.value)}
                >
                  {option.label}
                </div>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中…' : '暂无模型'} />
            )}
          </div>
        </div>
      )}
      aria-label="当前会话模型"
    />
  );
};

export default ModelSelect;
