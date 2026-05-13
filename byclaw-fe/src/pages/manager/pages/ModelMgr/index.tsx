import { message } from 'antd';
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
import { systemNameMap, type FilterChip, type ModelStatus } from './components/modelMgrViewUtils';
import styles from './index.module.less';

type ModelTagItem = {
  // 兼容后端不同返回口径：camelCase / snake_case
  paramName?: string;
  paramValue?: string;
  param_name?: string;
  param_value?: string;
  // 兼容其它 standType 静态数据口径
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
      loading.effects['modelMgr/deleteModel'] ||
      loading.effects['modelMgr/debugModel'] ||
      loading.effects['modelMgr/debugModelRerank'] ||
      loading.effects['modelMgr/testModel']
  );

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

  // 系统筛选改为接口动态拉取（对齐数字员工“来源”）

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
            nextSystemLabelMap[value] = systemNameMap[value] || value;
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
  }, [dispatch]);

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
    // 初次进入页面加载
    fetchList({ pageNum: 1, pageSize: pagination.pageSize });
    fetchOverviewStats();
  }, []);

  useEffect(() => {
    // 能力筛选项改为后端动态下发：/system/staticdata/getDcSystemConfigListByStandType (standType=MODEL_TAGS)
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

  const filterChips = useMemo(
    () =>
      [
        status
          ? {
            key: 'status',
            label: `${intl.formatMessage({ id: 'modelMgr.filterStatus' })} · ${
              statusTreeData.find((item) => item.key === status)?.label || status
            }`,
            onClose: () => {
              setStatus(undefined);
              setStatusSelectedList([]);
              resetAndFetch({ status: undefined });
            },
          }
          : null,
        ability
          ? {
            key: 'ability',
            label: `${intl.formatMessage({ id: 'modelMgr.filterAbility' })} · ${
              abilityLabelMap?.[ability] || ability
            }`,
            onClose: () => {
              setAbility(undefined);
              setAbilitySelectedList([]);
              resetAndFetch({ ability: undefined });
            },
          }
          : null,
        system
          ? {
            key: 'system',
            label: `${intl.formatMessage({ id: 'modelMgr.filterSystem' })} · ${
              systemLabelMap?.[system] || systemNameMap[system] || system
            }`,
            onClose: () => {
              setSystem(undefined);
              setSystemSelectedList([]);
              resetAndFetch({ system: undefined });
            },
          }
          : null,
        keyword.trim()
          ? {
            key: 'keyword',
            label: `${intl.formatMessage({ id: 'modelMgr.searchLabel' })} · ${keyword.trim()}`,
            onClose: () => {
              setKeyword('');
              resetAndFetch({ keyword: '' });
            },
          }
          : null,
      ].filter(Boolean) as FilterChip[],
    [ability, abilityLabelMap, intl, keyword, resetAndFetch, status, statusTreeData, system, systemLabelMap]
  );

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

  const cardItemFn = useCallback(
    (record: any) => {
      return (
        <ModelCardItem
          intl={intl}
          record={record}
          abilityLabelMap={abilityLabelMap}
          systemLabelMap={systemLabelMap}
          onSetStatus={setStatusAction}
          onEdit={(item) => formAction.handleShow('edit', item)}
          onDebug={(item) => formAction.handleShow('debug', item)}
          onDelete={deleteAction}
        />
      );
    },
    [abilityLabelMap, formAction, intl, systemLabelMap]
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
