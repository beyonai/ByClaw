import { message, Modal } from 'antd';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useIntl, useSelector } from '@umijs/max';

import useShowModal from '@/pages/manager/hooks/useShowModal';
import commonStyles from '@/pages/manager/less/commonTabList.less';
import type { ITreeData } from '@/pages/manager/pages/OrgMgr/components/TreeFilter';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import ModelCardItem from './components/ModelCardItem';
import ModelCardSection from './components/ModelCardSection';
import ModelFormModal from './components/ModelFormModal';
import ModelFilterPanel from './components/ModelFilterPanel';
import ModelHeroPanel from './components/ModelHeroPanel';
import { getSystemName, type FilterChip, type ModelStatus } from './components/modelMgrViewUtils';
import styles from './index.module.less';

type ModelTagItem = {
  // Support both camelCase and snake_case response fields.
  paramName?: string;
  paramValue?: string;
  param_name?: string;
  param_value?: string;
  // Support static-data fields from other standType APIs.
  standDisplayValue?: string;
  standCode?: string;
  [key: string]: any;
};

const initPagination = {
  pageIndex: 1,
  pageSize: 10,
  total: 0,
};

const ModelMgr: React.FC = () => {
  const intl = useIntl();
  const dispatch = useDispatch();
  const isLoading = useSelector(({ loading }: any) => loading.effects['modelMgr/getModelListByPage']);
  const actionLoading = useSelector(
    ({ loading }: any) =>
      loading.effects['modelMgr/upsertModel'] ||
      loading.effects['modelMgr/getModelDetail'] ||
      loading.effects['modelMgr/setModelStatus'] ||
      loading.effects['modelMgr/setDefaultModel'] ||
      loading.effects['modelMgr/deleteModel'] ||
      loading.effects['modelMgr/debugModel'] ||
      loading.effects['modelMgr/debugModelRerank'] ||
      loading.effects['modelMgr/completeAllModelConfig'] ||
      loading.effects['modelMgr/testModel']
  );
  const completeLoading = useSelector(({ loading }: any) => loading.effects['modelMgr/completeAllModelConfig']);

  const [list, setList] = useState<any[]>([]);
  const [pagination, setPagination] = useState(initPagination);
  const [overviewStats, setOverviewStats] = useState({
    total: 0,
    enabledCount: 0,
    testingCount: 0,
    disabledCount: 0,
  });

  const [status, setStatus] = useState<ModelStatus | undefined>(undefined);
  const [ability, setAbility] = useState<string | undefined>(undefined);
  const [system, setSystem] = useState<string | undefined>(undefined);
  const [keyword, setKeyword] = useState('');

  const [statusSelectedList, setStatusSelectedList] = useState<ITreeData[]>([]);
  const [abilitySelectedList, setAbilitySelectedList] = useState<ITreeData[]>([]);
  const [systemSelectedList, setSystemSelectedList] = useState<ITreeData[]>([]);
  const [systemTreeData, setSystemTreeData] = useState<ITreeData[]>([]);
  const [systemLabelMap, setSystemLabelMap] = useState<Record<string, string>>({});

  const [formState, formAction] = useShowModal();

  const statusTreeData = useMemo<ITreeData[]>(
    () => [
      { label: intl.formatMessage({ id: 'modelMgr.statusEnabled' }), key: 'ENABLED', keypath: 'ENABLED' },
      { label: intl.formatMessage({ id: 'modelMgr.statusDisabled' }), key: 'DISABLED', keypath: 'DISABLED' },
      { label: intl.formatMessage({ id: 'modelMgr.statusTesting' }), key: 'TESTING', keypath: 'TESTING' },
    ],
    [intl]
  );

  const [abilityTreeData, setAbilityTreeData] = useState<ITreeData[]>([]);
  const abilityLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    (abilityTreeData || []).forEach((it) => {
      if (!it?.key) return;
      map[`${it.key}`] = `${it.label ?? it.key}`;
    });
    return map;
  }, [abilityTreeData]);

  // System filters are loaded from the API, aligned with digital employee sources.

  const activeFilterCount = [status, ability, system, keyword.trim()].filter(Boolean).length;
  const resultSummary = useMemo(() => {
    if (!pagination.total) return intl.formatMessage({ id: 'modelMgr.resultEmpty' });
    return intl.formatMessage(
      { id: 'modelMgr.resultSummary' },
      {
        total: pagination.total,
        current: list.length,
      }
    );
  }, [intl, list.length, pagination.total]);

  const fetchList = useCallback(
    (
      params?: Partial<{
        pageNum: number;
        pageSize: number;
        keyword: string;
        status?: ModelStatus;
        ability?: string;
        system?: string;
      }>
    ) => {
      const hasKeyword = !!params && Object.prototype.hasOwnProperty.call(params, 'keyword');
      const hasStatus = !!params && Object.prototype.hasOwnProperty.call(params, 'status');
      const hasAbility = !!params && Object.prototype.hasOwnProperty.call(params, 'ability');
      const hasSystem = !!params && Object.prototype.hasOwnProperty.call(params, 'system');
      const pageNum = params?.pageNum ?? pagination.pageIndex;
      const pageSize = params?.pageSize ?? pagination.pageSize;
      const nextKeyword = hasKeyword ? params?.keyword : keyword;
      const nextStatus = hasStatus ? params?.status : status;
      const nextAbility = hasAbility ? params?.ability : ability;
      const nextSystem = hasSystem ? params?.system : system;

      dispatch({
        type: 'modelMgr/getModelListByPage',
        payload: {
          pageNum,
          pageSize,
          keyword: nextKeyword?.trim() || undefined,
          status: nextStatus,
          ability: nextAbility,
          system: nextSystem,
        },
        success: (res: any) => {
          const rows = res?.rows || res?.list || [];
          const pageIndex = res?.pageIndex ?? pageNum;
          const newPageSize = res?.pageSize ?? pageSize;
          const total = res?.total ?? 0;
          setList(rows);
          setPagination({ pageIndex, pageSize: newPageSize, total });
        },
      });
    },
    [dispatch, pagination, keyword, status, ability, system]
  );

  const fetchOverviewStats = useCallback(() => {
    dispatch({
      type: 'modelMgr/getModelListByPage',
      payload: {
        pageNum: 1,
        pageSize: 2000,
      },
      success: (res: any) => {
        const rows = Array.isArray(res?.rows) ? res.rows : Array.isArray(res?.list) ? res.list : [];
        const nextSystemLabelMap: Record<string, string> = {};
        rows.forEach((item: any) => {
          const systems = Array.isArray(item?.systems) ? item.systems : [];
          systems.forEach((systemItem: any) => {
            const value = `${systemItem ?? ''}`.trim();
            if (!value || nextSystemLabelMap[value]) return;
            nextSystemLabelMap[value] = getSystemName(intl, value);
          });
        });
        setSystemLabelMap(nextSystemLabelMap);
        setSystemTreeData(
          Object.keys(nextSystemLabelMap).map((key) => ({
            label: nextSystemLabelMap[key],
            key,
            keypath: key,
          }))
        );
        setOverviewStats({
          total: res?.total ?? rows.length,
          enabledCount: rows.filter((item: any) => item?.status === 'ENABLED').length,
          testingCount: rows.filter((item: any) => item?.status === 'TESTING').length,
          disabledCount: rows.filter((item: any) => item?.status === 'DISABLED').length,
        });
      },
    });
  }, [dispatch, intl]);

  const resetAndFetch = useCallback(
    (override?: Partial<{ keyword: string; status?: ModelStatus; ability?: string; system?: string }>) => {
      fetchList({
        pageNum: 1,
        pageSize: pagination.pageSize,
        keyword: override && Object.prototype.hasOwnProperty.call(override, 'keyword') ? override.keyword : keyword,
        status: override && Object.prototype.hasOwnProperty.call(override, 'status') ? override.status : status,
        ability: override && Object.prototype.hasOwnProperty.call(override, 'ability') ? override.ability : ability,
        system: override && Object.prototype.hasOwnProperty.call(override, 'system') ? override.system : system,
      });
    },
    [fetchList, pagination.pageSize, keyword, status, ability, system]
  );

  useEffect(() => {
    // Initial page load.
    fetchList({ pageNum: 1, pageSize: pagination.pageSize });
    fetchOverviewStats();
  }, []);

  useEffect(() => {
    // Ability filters are served by /system/staticdata/getDcSystemConfigListByStandType (standType=MODEL_TAGS).
    getDcSystemConfigListByStandType({ standType: 'MODEL_TAGS' })
      .then((res: any) => {
        const list: ModelTagItem[] = Array.isArray(res?.data) ? res.data : [];
        const tree: ITreeData[] = list
          .map((it) => {
            const label = `${it?.paramName ?? it?.param_name ?? it?.standDisplayValue ?? ''}`.trim();
            const value = `${it?.paramValue ?? it?.param_value ?? it?.standCode ?? ''}`.trim();
            if (!value) return null;
            return {
              label: label || value,
              key: value,
              keypath: value,
            } as ITreeData;
          })
          .filter(Boolean) as ITreeData[];
        setAbilityTreeData(tree);
      })
      .catch(() => {
        // ignore
      });
  }, []);

  const clearFilters = useCallback(() => {
    setKeyword('');
    setStatus(undefined);
    setAbility(undefined);
    setSystem(undefined);
    setStatusSelectedList([]);
    setAbilitySelectedList([]);
    setSystemSelectedList([]);
    setPagination((p) => ({ ...p, pageIndex: 1 }));
    fetchList({
      pageNum: 1,
      pageSize: pagination.pageSize,
      keyword: '',
      status: undefined,
      ability: undefined,
      system: undefined,
    });
  }, [fetchList, pagination.pageSize]);

  const filterChips = useMemo(() => {
    const chips: FilterChip[] = [];

    if (status) {
      chips.push({
        key: 'status',
        label: `${intl.formatMessage({ id: 'modelMgr.filterStatus' })} · ${
          statusTreeData.find((item) => item.key === status)?.label || status
        }`,
        onClose: () => {
          setStatus(undefined);
          setStatusSelectedList([]);
          resetAndFetch({ status: undefined });
        },
      });
    }

    if (ability) {
      chips.push({
        key: 'ability',
        label: `${intl.formatMessage({ id: 'modelMgr.filterAbility' })} · ${abilityLabelMap?.[ability] || ability}`,
        onClose: () => {
          setAbility(undefined);
          setAbilitySelectedList([]);
          resetAndFetch({ ability: undefined });
        },
      });
    }

    if (system) {
      chips.push({
        key: 'system',
        label: `${intl.formatMessage({ id: 'modelMgr.filterSystem' })} · ${
          systemLabelMap?.[system] || getSystemName(intl, system)
        }`,
        onClose: () => {
          setSystem(undefined);
          setSystemSelectedList([]);
          resetAndFetch({ system: undefined });
        },
      });
    }

    if (keyword.trim()) {
      chips.push({
        key: 'keyword',
        label: `${intl.formatMessage({ id: 'modelMgr.searchLabel' })} · ${keyword.trim()}`,
        onClose: () => {
          setKeyword('');
          resetAndFetch({ keyword: '' });
        },
      });
    }

    return chips;
  }, [ability, abilityLabelMap, intl, keyword, resetAndFetch, status, statusTreeData, system, systemLabelMap]);

  const setStatusAction = (record: any, nextStatus: ModelStatus) => {
    dispatch({
      type: 'modelMgr/setModelStatus',
      payload: {
        id: record.id,
        status: nextStatus,
      },
      success: () => {
        message.success(intl.formatMessage({ id: 'modelMgr.operationSuccess' }));
        fetchList();
        fetchOverviewStats();
      },
    });
  };

  const setDefaultAction = useCallback(
    (record: any) => {
      dispatch({
        type: 'modelMgr/setDefaultModel',
        payload: {
          modelId: record.id,
          modelType: record.modelType || 'LLM',
          tagId: '1',
        },
        success: () => {
          message.success(intl.formatMessage({ id: 'modelMgr.operationSuccess' }));
          fetchList();
        },
      });
    },
    [dispatch, fetchList, intl]
  );

  const deleteAction = (record: any) => {
    dispatch({
      type: 'modelMgr/deleteModel',
      payload: { id: record.id },
      success: () => {
        message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
        fetchList({ pageNum: 1, pageSize: pagination.pageSize });
        fetchOverviewStats();
      },
    });
  };

  const reloadAll = useCallback(() => {
    resetAndFetch();
    fetchOverviewStats();
  }, [fetchOverviewStats, resetAndFetch]);

  const formatCompleteValue = useCallback((value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return `${value}`;
  }, []);

  const renderCompleteStatus = useCallback(
    (statusValue: string) => {
      const normalized = `${statusValue || 'SKIPPED'}`.toUpperCase();
      let statusClass = styles.completeStatusSkipped;
      let text = intl.formatMessage({ id: 'modelMgr.completeSkipped' });
      if (normalized === 'UPDATED') {
        statusClass = styles.completeStatusUpdated;
        text = intl.formatMessage({ id: 'modelMgr.completeUpdated' });
      } else if (normalized === 'FAILED') {
        statusClass = styles.completeStatusFailed;
        text = intl.formatMessage({ id: 'modelMgr.completeFailed' });
      }
      return <span className={classNames(styles.completeStatus, statusClass)}>{text}</span>;
    },
    [intl]
  );

  const showCompleteResult = useCallback(
    (res: any) => {
      const items = Array.isArray(res?.items) ? res.items : [];
      Modal.info({
        title: intl.formatMessage({ id: 'modelMgr.completeResultTitle' }),
        width: 760,
        content: (
          <div className={styles.completeResult}>
            <div className={styles.completeStats}>
              {intl.formatMessage(
                { id: 'modelMgr.completeStats' },
                {
                  total: res?.total ?? items.length,
                  updated: res?.updated ?? 0,
                  skipped: res?.skipped ?? 0,
                  failed: res?.failed ?? 0,
                }
              )}
            </div>
            <div className={styles.completeResultList}>
              {items.map((item: any, itemIndex: number) => {
                const changes = Array.isArray(item?.changes) ? item.changes : [];
                const warnings = Array.isArray(item?.warnings) ? item.warnings : [];
                return (
                  <div className={styles.completeResultItem} key={item?.id || item?.modelCode || itemIndex}>
                    <div className={styles.completeResultHead}>
                      <div>
                        <div>{item?.displayName || item?.modelCode || item?.id || '-'}</div>
                        <div className={styles.completeResultSub}>
                          {item?.modelCode || '-'} · {item?.source || '-'} · {item?.confidence || '-'}
                        </div>
                      </div>
                      {renderCompleteStatus(item?.status)}
                    </div>
                    {changes.length ? (
                      <div className={styles.completeChangeList}>
                        {changes.map((change: any, index: number) => (
                          <div className={styles.completeChangeItem} key={`${change?.field || 'field'}-${index}`}>
                            <span className={styles.completeChangeField}>{change?.field || '-'}</span>
                            <span>
                              {formatCompleteValue(change?.before)} → {formatCompleteValue(change?.after)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.completeMuted}>
                        {item?.errorMessage || intl.formatMessage({ id: 'modelMgr.completeNoChanges' })}
                      </div>
                    )}
                    {warnings.length ? <div className={styles.completeMuted}>{warnings.join('；')}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ),
      });
    },
    [formatCompleteValue, intl, renderCompleteStatus]
  );

  const completeAllModelConfigAction = useCallback(() => {
    Modal.confirm({
      title: intl.formatMessage({ id: 'modelMgr.completeConfirmTitle' }),
      content: intl.formatMessage({ id: 'modelMgr.completeConfirmContent' }),
      okText: intl.formatMessage({ id: 'modelMgr.completeConfirmOk' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      onOk: () =>
        new Promise<void>((resolve) => {
          dispatch({
            type: 'modelMgr/completeAllModelConfig',
            success: (res: any) => {
              message.success(intl.formatMessage({ id: 'modelMgr.completeSuccess' }));
              reloadAll();
              showCompleteResult(res);
              resolve();
            },
            fail: () => resolve(),
          });
        }),
    });
  }, [dispatch, intl, reloadAll, showCompleteResult]);

  const cardItemFn = useCallback(
    (record: any) => {
      return (
        <ModelCardItem
          intl={intl}
          record={record}
          abilityLabelMap={abilityLabelMap}
          systemLabelMap={systemLabelMap}
          onSetStatus={setStatusAction}
          onSetDefault={setDefaultAction}
          onEdit={(item) => formAction.handleShow('edit', item)}
          onDebug={(item) => formAction.handleShow('debug', item)}
          onDelete={deleteAction}
        />
      );
    },
    [abilityLabelMap, formAction, intl, setDefaultAction, systemLabelMap]
  );

  return (
    <div className={`${styles.modelMgr} ${commonStyles.commonTabList}`}>
      <div className={classNames(commonStyles.tabContent, 'minH0')}>
        <ModelHeroPanel
          intl={intl}
          keyword={keyword}
          setKeyword={setKeyword}
          onSearch={resetAndFetch}
          onReset={clearFilters}
          onAdd={() => formAction.handleShow('add')}
          onCompleteConfig={completeAllModelConfigAction}
          completeLoading={!!completeLoading}
          activeFilterCount={activeFilterCount}
          total={overviewStats.total}
          enabledCount={overviewStats.enabledCount}
          testingCount={overviewStats.testingCount}
          disabledCount={overviewStats.disabledCount}
        />

        <ModelFilterPanel
          intl={intl}
          resultSummary={resultSummary}
          statusTreeData={statusTreeData}
          abilityTreeData={abilityTreeData}
          systemTreeData={systemTreeData}
          statusSelectedList={statusSelectedList}
          abilitySelectedList={abilitySelectedList}
          systemSelectedList={systemSelectedList}
          filterChips={filterChips}
          onStatusOk={(v) => {
            const next = v?.[0]?.key ? (v[0].key as ModelStatus) : undefined;
            setStatusSelectedList(v || []);
            setStatus(next);
            setPagination((p) => ({ ...p, pageIndex: 1 }));
            resetAndFetch({ status: next });
          }}
          onAbilityOk={(v) => {
            const next = v?.[0]?.key || undefined;
            setAbilitySelectedList(v || []);
            setAbility(next);
            setPagination((p) => ({ ...p, pageIndex: 1 }));
            resetAndFetch({ ability: next });
          }}
          onSystemOk={(v) => {
            const next = v?.[0]?.key || undefined;
            setSystemSelectedList(v || []);
            setSystem(next);
            setPagination((p) => ({ ...p, pageIndex: 1 }));
            resetAndFetch({ system: next });
          }}
        />

        <ModelCardSection
          intl={intl}
          list={list}
          isLoading={!!isLoading}
          actionLoading={!!actionLoading}
          activeFilterCount={activeFilterCount}
          pagination={pagination as any}
          onAdd={() => formAction.handleShow('add')}
          onReset={clearFilters}
          onPageChange={({ pageIndex, pageSize }) => {
            fetchList({ pageNum: pageIndex, pageSize });
          }}
          cardItemFn={cardItemFn}
        />
      </div>

      <ModelFormModal {...formState} onCancel={formAction.onCancel} reload={reloadAll} />
    </div>
  );
};

export default ModelMgr;
