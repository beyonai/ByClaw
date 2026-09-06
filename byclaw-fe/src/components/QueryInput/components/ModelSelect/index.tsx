import React, { useEffect, useMemo, useState } from 'react';
import { AppstoreOutlined, CloudOutlined, LaptopOutlined, UserOutlined } from '@ant-design/icons';
import { Select, Spin, Tabs, Tag, Empty } from 'antd';
import { getMyModels, getPublicModels } from '@/pages/models/service';
import styles from './index.less';

type Props = {
  value?: string | number;
  onChange: (value?: string) => void;
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

/** Desktop-only session model picker. Web chat never mounts this component. */
type Model = { id: string; label: string; provider?: string; source: 'local' | 'mine' | 'public' };
const DesktopModelSelect: React.FC<Props> = ({ value, onChange }) => {
  const [activeTab, setActiveTab] = useState<'local' | 'mine' | 'public'>('local');
  const [groups, setGroups] = useState<Record<'local' | 'mine' | 'public', Model[]>>({
    local: [],
    mine: [],
    public: [],
  });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const desktop = typeof window !== 'undefined' && Boolean(window.byclawDesktop);
  const storageKey = 'byclaw.desktop.selected-model';

  useEffect(() => {
    if (!desktop) return undefined;
    let cancelled = false;
    setLoading(true);
    const localPromise = window.byclawDesktop?.getLocalModels
      ? window.byclawDesktop.getLocalModels().catch(() => [])
      : window.byclawDesktop?.models?.local
        ? window.byclawDesktop.models.local().catch(() => [])
        : Promise.resolve([]);
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
  }, [desktop]);

  // Preserve the original picker behavior: a new desktop session always gets
  // a usable default model, while an explicitly selected model is untouched.
  useEffect(() => {
    if (value !== undefined && value !== null && `${value}` !== '') return;
    const saved = window.localStorage.getItem(storageKey);
    const all = [...groups.local, ...groups.mine, ...groups.public];
    const first = all.find((item) => item.id === saved) || groups.local[0] || groups.mine[0] || groups.public[0];
    if (first) onChange(first.id);
  }, [groups, value, onChange]);

  const selectModel = (next?: string) => {
    if (next) window.localStorage.setItem(storageKey, next);
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

  if (!desktop) return null;
  const current = value === undefined || value === null || `${value}` === '' ? undefined : `${value}`;
  const selectedModel = allModels.find((item) => item.id === current);
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
          current
        )
      }
      placeholder="选择模型"
      loading={loading}
      suffixIcon={loading ? <Spin size="small" /> : <AppstoreOutlined />}
      options={options}
      onChange={(next) => selectModel(next ? `${next}` : undefined)}
      popupMatchSelectWidth={360}
      dropdownRender={() => (
        <div className={styles.panel}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as typeof activeTab)}
            items={[
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
            ]}
          />
          <div className={styles.list}>
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

export default DesktopModelSelect;
