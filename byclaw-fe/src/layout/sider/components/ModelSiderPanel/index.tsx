import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Input, List, Popconfirm, Progress, Spin, Tag, message } from 'antd';
import { CopyOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useIntl, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import useResourceCenterRouter from '@/layout/sider/components/useResourceCenterRouter';
import useGlobal from '@/hooks/useGlobal';
import { getMyModels, getMyQuota } from '@/pages/models/service';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import { updateDigitalEmployee } from '@/pages/manager/service/DigitalEmployeeMgr';
import { POST } from '@/service/common/request';
import { getModelDetail } from '@/pages/manager/service/ModelMgr';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import chromeStyles from '@/layout/sider/components/ResourceSiderPanel/index.module.less';
import styles from './index.module.less';

function unwrapData(res: any) {
  if (!res) return res;
  if (Object.prototype.hasOwnProperty.call(res, 'data')) return res.data;
  return res;
}

function safeJsonParse(value: any) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeModelValue(value: any) {
  return `${value ?? ''}`.trim();
}

function formatModelDateTime(value: any) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : `${value ?? ''}`;
}

// 字段映射保存语言键，详情每次渲染时使用当前语言翻译。
const MODEL_DETAIL_LABELS: Record<string, string> = {
  id: 'personalModel.detail.id',
  modelId: 'personalModel.detail.id',
  displayName: 'personalModel.detail.displayName',
  modelName: 'personalModel.detail.displayName',
  modelType: 'personalModel.detail.modelType',
  providerName: 'personalModel.detail.providerName',
  modelCode: 'personalModel.detail.modelCode',
  modelNo: 'personalModel.detail.modelCode',
  modelProtocol: 'personalModel.detail.modelProtocol',
  status: 'personalModel.detail.status',
  isDefault: 'personalModel.detail.isDefault',
  contextTokens: 'personalModel.detail.contextTokens',
  maxContentToken: 'personalModel.detail.maxContentToken',
  maxTokens: 'personalModel.detail.maxTokens',
  temperature: 'personalModel.detail.temperature',
  topP: 'personalModel.detail.topP',
  frequencyPenalty: 'personalModel.detail.frequencyPenalty',
  presencePenalty: 'personalModel.detail.presencePenalty',
  abilities: 'personalModel.detail.abilities',
  systems: 'personalModel.detail.systems',
  apiEndpoint: 'personalModel.detail.apiEndpoint',
  apiToken: 'personalModel.detail.apiToken',
  apiTokenMasked: 'personalModel.detail.apiToken',
  headers: 'personalModel.detail.headers',
  connectTimeoutSec: 'personalModel.detail.connectTimeoutSec',
  readTimeoutSec: 'personalModel.detail.readTimeoutSec',
  maxRetries: 'personalModel.detail.maxRetries',
  retryIntervalSec: 'personalModel.detail.retryIntervalSec',
  reasoningConfig: 'personalModel.detail.reasoningConfig',
  inparamTemplate: 'personalModel.detail.inparamTemplate',
  inParams: 'personalModel.detail.inParams',
  in_params: 'personalModel.detail.inParams',
  extendParam: 'personalModel.detail.extendParam',
  updatedAt: 'personalModel.detail.updatedAt',
  ownerType: 'personalModel.detail.ownerType',
};

export function formatModelDetailValue(value: any, intl: ReturnType<typeof useIntl>) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean')
    return value
      ? intl.formatMessage({ id: 'personalModel.detail.yes' })
      : intl.formatMessage({ id: 'personalModel.detail.no' });
  if (Array.isArray(value)) {
    return (
      value
        .map((item) => formatModelDetailValue(item, intl))
        .filter((item) => item !== '-')
        .join(intl.formatMessage({ id: 'personalModel.detail.separator' })) || '-'
    );
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return `${value}`;
}

function isCopyableModelDetailKey(key: string) {
  return [
    'apitoken',
    'apitokenmasked',
    'reasoningconfig',
    'inparamtemplate',
    'inparams',
    'in_params',
    'apiendpoint',
    'headers',
  ].includes(key.toLowerCase());
}

async function copyModelDetailValue(value: string, intl: ReturnType<typeof useIntl>) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    message.success(intl.formatMessage({ id: 'personalModel.detail.copySuccess' }));
  } catch {
    message.error(intl.formatMessage({ id: 'personalModel.detail.copyFailed' }));
  }
}

function getModelDetailItems(model: any, intl: ReturnType<typeof useIntl>) {
  if (!model) return [];
  const items: Array<{ key: string; label: string; value: any }> = [
    { key: 'id', label: intl.formatMessage({ id: 'personalModel.detail.id' }), value: model.id || model.modelId },
    {
      key: 'displayName',
      label: intl.formatMessage({ id: 'personalModel.detail.displayName' }),
      value: model.displayName || model.modelName,
    },
    { key: 'modelType', label: intl.formatMessage({ id: 'personalModel.detail.modelType' }), value: model.modelType },
    {
      key: 'providerName',
      label: intl.formatMessage({ id: 'personalModel.detail.providerName' }),
      value: model.providerName,
    },
    {
      key: 'modelCode',
      label: intl.formatMessage({ id: 'personalModel.detail.modelCode' }),
      value: model.modelCode || model.modelNo,
    },
    {
      key: 'modelProtocol',
      label: intl.formatMessage({ id: 'personalModel.detail.modelProtocol' }),
      value: model.modelProtocol,
    },
    {
      key: 'status',
      label: intl.formatMessage({ id: 'personalModel.detail.status' }),
      value:
        model.status === 'ENABLED'
          ? intl.formatMessage({ id: 'personalModel.status.enabled' })
          : model.status === 'DISABLED'
            ? intl.formatMessage({ id: 'personalModel.status.disabled' })
            : model.status,
    },
    {
      key: 'isDefault',
      label: intl.formatMessage({ id: 'personalModel.detail.isDefault' }),
      value: model.isDefault === 1 || model.isDefault === '1',
    },
    {
      key: 'contextTokens',
      label: intl.formatMessage({ id: 'personalModel.detail.contextTokens' }),
      value: model.contextTokens ? `${model.contextTokens} tokens` : undefined,
    },
    {
      key: 'maxContentToken',
      label: intl.formatMessage({ id: 'personalModel.detail.maxContentToken' }),
      value: model.maxContentToken,
    },
    { key: 'maxTokens', label: intl.formatMessage({ id: 'personalModel.detail.maxTokens' }), value: model.maxTokens },
    {
      key: 'temperature',
      label: intl.formatMessage({ id: 'personalModel.detail.temperature' }),
      value: model.temperature,
    },
    { key: 'topP', label: intl.formatMessage({ id: 'personalModel.detail.topP' }), value: model.topP },
    {
      key: 'frequencyPenalty',
      label: intl.formatMessage({ id: 'personalModel.detail.frequencyPenalty' }),
      value: model.frequencyPenalty,
    },
    {
      key: 'presencePenalty',
      label: intl.formatMessage({ id: 'personalModel.detail.presencePenalty' }),
      value: model.presencePenalty,
    },
    { key: 'abilities', label: intl.formatMessage({ id: 'personalModel.detail.abilities' }), value: model.abilities },
    { key: 'systems', label: intl.formatMessage({ id: 'personalModel.detail.systems' }), value: model.systems },
    {
      key: 'apiEndpoint',
      label: intl.formatMessage({ id: 'personalModel.detail.apiEndpoint' }),
      value: model.apiEndpoint,
    },
    {
      key: 'apiToken',
      label: intl.formatMessage({ id: 'personalModel.detail.apiToken' }),
      value: model.apiToken ?? model.apiTokenMasked,
    },
    { key: 'headers', label: intl.formatMessage({ id: 'personalModel.detail.headers' }), value: model.headers },
    {
      key: 'connectTimeoutSec',
      label: intl.formatMessage({ id: 'personalModel.detail.connectTimeoutSec' }),
      value:
        model.connectTimeoutSec === undefined
          ? undefined
          : intl.formatMessage({ id: 'personalModel.detail.seconds' }, { count: model.connectTimeoutSec }),
    },
    {
      key: 'readTimeoutSec',
      label: intl.formatMessage({ id: 'personalModel.detail.readTimeoutSec' }),
      value:
        model.readTimeoutSec === undefined
          ? undefined
          : intl.formatMessage({ id: 'personalModel.detail.seconds' }, { count: model.readTimeoutSec }),
    },
    {
      key: 'maxRetries',
      label: intl.formatMessage({ id: 'personalModel.detail.maxRetries' }),
      value: model.maxRetries,
    },
    {
      key: 'retryIntervalSec',
      label: intl.formatMessage({ id: 'personalModel.detail.retryIntervalSec' }),
      value:
        model.retryIntervalSec === undefined
          ? undefined
          : intl.formatMessage({ id: 'personalModel.detail.seconds' }, { count: model.retryIntervalSec }),
    },
    {
      key: 'reasoningConfig',
      label: intl.formatMessage({ id: 'personalModel.detail.reasoningConfig' }),
      value: model.reasoningConfig,
    },
    {
      key: 'inparamTemplate',
      label: intl.formatMessage({ id: 'personalModel.detail.inparamTemplate' }),
      value: model.inparamTemplate,
    },
    {
      key: 'inParams',
      label: intl.formatMessage({ id: 'personalModel.detail.inParams' }),
      value: model.inParams ?? model.in_params,
    },
    {
      key: 'extendParam',
      label: intl.formatMessage({ id: 'personalModel.detail.extendParam' }),
      value: model.extendParam,
    },
    {
      key: 'updatedAt',
      label: intl.formatMessage({ id: 'personalModel.detail.updatedAt' }),
      value: formatModelDateTime(model.updatedAt),
    },
  ];
  const knownKeys = new Set([
    ...items.map((item) => item.key),
    // 这些别名已合并到同一行，避免接口同时返回时重复展示。
    'modelId',
    'modelName',
    'modelNo',
    'apiTokenMasked',
    'inParams',
    'in_params',
  ]);
  Object.entries(model).forEach(([key, value]) => {
    if (!knownKeys.has(key) && value !== undefined && value !== null && value !== '') {
      items.push({
        key,
        label: MODEL_DETAIL_LABELS[key] ? intl.formatMessage({ id: MODEL_DETAIL_LABELS[key] }) : key,
        value,
      });
    }
  });

  return items.filter(({ value }) => value !== undefined && value !== null && value !== '');
}

export function getModelDetailSections(model: any, intl: ReturnType<typeof useIntl>) {
  const items = getModelDetailItems(model, intl);
  const groups = [
    {
      key: 'basic',
      title: intl.formatMessage({ id: 'personalModel.detail.section.basic' }),
      keys: new Set([
        'id',
        'displayName',
        'modelType',
        'providerName',
        'modelCode',
        'modelProtocol',
        'status',
        'isDefault',
      ]),
    },
    {
      key: 'connection',
      title: intl.formatMessage({ id: 'personalModel.detail.section.connection' }),
      keys: new Set([
        'apiEndpoint',
        'apiToken',
        'headers',
        'connectTimeoutSec',
        'readTimeoutSec',
        'maxRetries',
        'retryIntervalSec',
      ]),
    },
    {
      key: 'parameters',
      title: intl.formatMessage({ id: 'personalModel.detail.section.parameters' }),
      keys: new Set([
        'contextTokens',
        'maxContentToken',
        'maxTokens',
        'temperature',
        'topP',
        'frequencyPenalty',
        'presencePenalty',
        'abilities',
        'systems',
      ]),
    },
    {
      key: 'advanced',
      title: intl.formatMessage({ id: 'personalModel.detail.section.advanced' }),
      keys: new Set([
        'reasoningConfig',
        'inparamTemplate',
        'inParams',
        'in_params',
        'extendParam',
        'updatedAt',
        'ownerType',
      ]),
    },
  ];
  const assignedKeys = new Set(groups.flatMap((group) => [...group.keys]));
  const extraItems = items.filter((item) => !assignedKeys.has(item.key));
  const advanced = groups.find((group) => group.key === 'advanced');
  if (advanced) advanced.keys = new Set([...advanced.keys, ...extraItems.map((item) => item.key)]);

  return groups
    .map((group) => {
      const groupItems = items.filter((item) => group.keys.has(item.key));
      if (group.key === 'advanced') {
        // 更新时间作为详情摘要的收尾信息，始终固定在该卡片最后。
        const updatedAt = groupItems.find((item) => item.key === 'updatedAt');
        return {
          ...group,
          items: [...groupItems.filter((item) => item.key !== 'updatedAt'), ...(updatedAt ? [updatedAt] : [])],
        };
      }
      return { ...group, items: groupItems };
    })
    .filter((group) => group.items.length > 0);
}

function isCurrentModel(record: any, currentModelInfo?: any, allRecords: any[] = []) {
  if (!record || !currentModelInfo) return false;
  const currentModelId = normalizeModelValue(currentModelInfo.modelId);
  // 新配置以唯一模型 ID 为准；存在 ID 时禁止再按名称兜底，避免同名模型被重复标记。
  if (currentModelId) return normalizeModelValue(record.id) === currentModelId;

  // 历史配置优先使用展示名称匹配。模型编码可能被多个提供商复用，不能直接作为唯一标识。
  const displayName = normalizeModelValue(
    currentModelInfo.model || currentModelInfo.modelName || currentModelInfo.displayName
  );
  const recordDisplayName = normalizeModelValue(record.displayName || record.modelName);
  if (displayName) {
    const displayMatches = allRecords.filter(
      (item) => normalizeModelValue(item.displayName || item.modelName) === displayName
    );
    if (displayMatches.length > 0) return displayMatches.length === 1 && recordDisplayName === displayName;
  }

  // 仅当编码在列表中唯一时才使用编码兜底，避免同一编码的多个模型同时显示“当前模型”。
  const currentCodes = [currentModelInfo.modelCode, currentModelInfo.modelNo].map(normalizeModelValue).filter(Boolean);
  if (!currentCodes.length) return false;
  const codeMatches = allRecords.filter((item) =>
    currentCodes.includes(normalizeModelValue(item.modelCode || item.modelNo))
  );
  return codeMatches.length === 1 && codeMatches[0] === record;
}

function sortModelList(list: any[]) {
  // 保留接口返回的默认排序，不再将当前模型强制置顶。
  return [...list];
}

const normalizeModelList = (value: any) => {
  const list = Array.isArray(value) ? value : value?.rows || value?.list || value?.data || [];
  return list.map((item: any) => ({
    ...item,
    id: item.id ?? item.modelId,
    displayName: item.displayName ?? item.modelName,
    modelCode: item.modelCode ?? item.modelNo,
    modelType: item.modelType ?? 'LLM',
  }));
};

interface ModelSiderPanelProps {
  embedded?: boolean;
  // 嵌入右侧资源面板时仅展示模型中心入口，不重复展示当前数字员工栏。
  showRouter?: boolean;
}

const ModelSiderPanel: React.FC<ModelSiderPanelProps> = ({ embedded = false, showRouter = false }) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const activeSiderAgent = useActiveSiderAgent();
  const isEmployeeModelPanel = embedded && showRouter;
  const { isCenterPage: isModelsPage, toggleCenter } = useResourceCenterRouter('/models', 'model', showRouter);
  const { defaultDigEmployeeId, userInfo } = useSelector(({ employees, user }: any) => ({
    defaultDigEmployeeId: employees?.defaultDigEmployeeId,
    userInfo: user?.userInfo,
  }));

  // 模型列表与其它左侧资源面板统一使用当前联动员工。
  const resourceId = useMemo(
    () => `${activeSiderAgent.resourceId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId || ''}`,
    [activeSiderAgent.resourceId, defaultDigEmployeeId, userInfo?.defaultDigEmployeeId]
  );

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  };

  const [quota, setQuota] = useState<{
    used: number;
    modelUsages?: any[];
    quotaLimit?: number;
    quotaUsed?: number;
    exceeded?: boolean;
  } | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [abilityLabelMap, setAbilityLabelMap] = useState<Record<string, string>>({});
  const [modelKeyword, setModelKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentDetail, setAgentDetail] = useState<any>(null);
  const [agentDetailLoading, setAgentDetailLoading] = useState(false);
  const [modelDetail, setModelDetail] = useState<any>(null);
  const [selectedModel, setSelectedModel] = useState<any>(null);
  const [selectedModelLoading, setSelectedModelLoading] = useState(false);
  const [canEditEmployee, setCanEditEmployee] = useState(false);
  const [activatingModelId, setActivatingModelId] = useState<string | number>();

  const modelInfo = useMemo(() => safeJsonParse(agentDetail?.prologue)?.modelInfo || {}, [agentDetail?.prologue]);
  const sortedModels = useMemo(() => sortModelList(models), [models]);
  const filteredModels = useMemo(() => {
    const keyword = modelKeyword.trim().toLowerCase();
    if (!keyword) return sortedModels;
    return sortedModels.filter((item) =>
      [item.displayName, item.modelCode, item.providerName].some((value) =>
        `${value ?? ''}`.toLowerCase().includes(keyword)
      )
    );
  }, [modelKeyword, sortedModels]);

  const openModelDetail = useCallback(async (model: any) => {
    setSelectedModel(model);
    if (!model?.id) return;
    setSelectedModelLoading(true);
    try {
      const response = await getModelDetail({ id: `${model.id}` });
      setSelectedModel((current: any) => ({ ...current, ...unwrapData(response) }));
    } finally {
      setSelectedModelLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [quotaRes, modelsRes, publicModelsRes] = await Promise.allSettled([
        getMyQuota(),
        getMyModels({ pageNum: 1, pageSize: 50, status: 'ENABLED' }),
        POST<any>('/byaiService/new/model/listModel', { tagId: '3', status: 'OOA', ownerType: 'PUBLIC' }),
      ]);
      if (quotaRes.status === 'fulfilled' && quotaRes.value?.data) {
        setQuota(quotaRes.value.data);
      }
      const personalModels =
        modelsRes.status === 'fulfilled'
          ? normalizeModelList((modelsRes.value?.data?.rows || modelsRes.value?.data?.list || []) as any[])
          : [];
      const publicModels =
        publicModelsRes.status === 'fulfilled'
          ? normalizeModelList((publicModelsRes.value?.data || publicModelsRes.value || []) as any[])
          : [];
      setModels(Array.from(new Map([...personalModels, ...publicModels].map((item) => [`${item.id}`, item])).values()));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCanEditEmployee(
      isEmployeeModelPanel &&
        `${agentDetail?.operationPermissions?.resourceId ?? ''}` === `${resourceId ?? ''}` &&
        agentDetail?.operationPermissions?.canEdit === true
    );
  }, [isEmployeeModelPanel, agentDetail, resourceId]);

  const activateModel = useCallback(
    async (model: any) => {
      if (!resourceId || !model?.id || activatingModelId !== undefined) return;
      setActivatingModelId(model.id);
      try {
        const currentPrologue = safeJsonParse(agentDetail?.prologue);
        const nextPrologue = {
          ...currentPrologue,
          modelInfo: {
            ...(currentPrologue.modelInfo || {}),
            model: model.displayName || model.modelName || model.modelCode,
            modelId: model.id,
          },
        };
        // 与编辑页保持一致，使用数字员工新版更新接口保存问答模型配置。
        await updateDigitalEmployee({
          resourceId,
          resourceBizType: 'DIG_EMPLOYEE',
          systemCode: 'BYAI',
          prologue: JSON.stringify(nextPrologue),
        });
        setAgentDetail((current: any) => ({ ...current, prologue: JSON.stringify(nextPrologue) }));
        const modelName = model.displayName || model.modelName || model.modelCode || '';
        // 启用完成后明确提示具体模型，避免用户只看到“成功”而无法确认操作对象。
        message.success(intl.formatMessage({ id: 'personalModel.enableSuccess' }, { name: modelName }));
      } catch (error: any) {
        message.error(
          error?.message || intl.formatMessage({ id: 'common.operationFailed', defaultMessage: '操作失败' })
        );
      } finally {
        setActivatingModelId(undefined);
      }
    },
    [activatingModelId, agentDetail?.prologue, intl, resourceId]
  );

  const fetchAgentDetail = useCallback(async () => {
    if (!resourceId) return;
    setAgentDetailLoading(true);
    try {
      const res = await getCompositeAppInfo({ resourceId });
      const detail = unwrapData(res);
      setAgentDetail(detail);
      const mi = safeJsonParse(detail?.prologue)?.modelInfo || {};
      if (mi.modelId) {
        const modelRes = await getModelDetail({ id: `${mi.modelId}` });
        setModelDetail(unwrapData(modelRes));
      }
    } catch {
      // ignore
    } finally {
      setAgentDetailLoading(false);
    }
  }, [resourceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    // 能力编号来自模型标签配置，复用模型管理页的字典接口转换为可读名称。
    void getDcSystemConfigListByStandType({ standType: 'MODEL_TAGS' })
      .then((response: any) => {
        const list = Array.isArray(response?.data) ? response.data : [];
        const nextMap: Record<string, string> = {};
        list.forEach((item: any) => {
          const value = `${item?.paramValue ?? item?.param_value ?? item?.standCode ?? ''}`.trim();
          const label = `${item?.paramName ?? item?.param_name ?? item?.standDisplayValue ?? value}`.trim();
          if (value) nextMap[value] = label || value;
        });
        setAbilityLabelMap(nextMap);
      })
      .catch(() => {
        // 字典加载失败时保留原始能力编号，确保详情仍可查看。
      });
  }, []);

  useEffect(() => {
    setAgentDetail(null);
    setModelDetail(null);
  }, [resourceId]);

  useEffect(() => {
    fetchAgentDetail();
  }, [fetchAgentDetail]);

  useEffect(() => {
    const handler = (payload?: { key?: string }) => {
      if (payload?.key === 'model') {
        fetchData();
        fetchAgentDetail();
      }
    };

    EventEmitter.on('sider-menu-tab-click-refresh', handler);
    return () => {
      EventEmitter.off('sider-menu-tab-click-refresh', handler);
    };
  }, [EventEmitter, fetchData, fetchAgentDetail]);

  return (
    <div className={styles.container}>
      {(!embedded || showRouter) && (
        <>
          {!embedded && <ActiveSiderAgentBar agent={activeSiderAgent} />}
          <div
            className={[chromeStyles.router, showRouter ? chromeStyles.routerSplit : ''].filter(Boolean).join(' ')}
            onClick={toggleCenter}
          >
            {showRouter && (
              <AntdIcon
                type={isModelsPage ? 'icon-a-Rightyou' : 'icon-a-Leftzuo'}
                className={chromeStyles.routerBackIcon}
              />
            )}
            <div className={chromeStyles.routerMain}>
              <span className={chromeStyles.middle}>{intl.formatMessage({ id: 'personalModel.title' })}</span>
              <AntdIcon type="icon-a-Braindanao" />
            </div>
            {!showRouter && (
              <AntdIcon
                type={isModelsPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
                className={chromeStyles.routerIcon}
              />
            )}
          </div>
        </>
      )}

      <div className={styles.content}>
        <Spin className={styles.modelSpin} spinning={loading || agentDetailLoading}>
          {agentDetail && (
            <Card className={styles.agentModelCard} size="small">
              <div className={styles.agentModelHeader}>
                <div className={styles.agentModelName}>
                  {modelInfo?.model ||
                    modelDetail?.modelName ||
                    intl.formatMessage({ id: 'fileBrowserEntry.model.notConfigured' })}
                </div>
                <Tag className={modelInfo?.modelId ? styles.currentModelTag : undefined} color="default">
                  {modelInfo?.modelId
                    ? intl.formatMessage({ id: 'fileBrowserEntry.debug.currentModel' })
                    : intl.formatMessage({ id: 'fileBrowserEntry.model.notConfiguredShort' })}
                </Tag>
              </div>
              <Descriptions column={2} size="small" className={styles.agentModelDesc}>
                <Descriptions.Item label={intl.formatMessage({ id: 'fileBrowserEntry.model.temperature' })}>
                  {modelInfo?.temperature ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label={intl.formatMessage({ id: 'fileBrowserEntry.model.history' })}>
                  {modelInfo?.history ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label={intl.formatMessage({ id: 'fileBrowserEntry.model.maxToken' })}>
                  {modelInfo?.maxToken ?? modelDetail?.maxContentToken ?? '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {quota && (
            <div className={styles.quotaCard}>
              <div className={styles.quotaTitle}>{intl.formatMessage({ id: 'personalModel.quota.title' })}</div>
              {quota.quotaLimit && quota.quotaLimit > 0 ? (
                <>
                  <div className={styles.quotaDetail}>
                    <span>
                      {intl.formatMessage({ id: 'personalModel.quota.monthlyUsed' })}:{' '}
                      {formatTokens(quota.quotaUsed || 0)} / {formatTokens(quota.quotaLimit)}
                    </span>
                  </div>
                  <Progress
                    percent={Math.min(100, Math.round(((quota.quotaUsed || 0) / quota.quotaLimit) * 100))}
                    size="small"
                    strokeColor={quota.exceeded ? '#ff4d4f' : '#1677ff'}
                    showInfo={false}
                  />
                </>
              ) : (
                <div className={styles.quotaDetail}>
                  <span>
                    {intl.formatMessage({ id: 'personalModel.quota.totalTokens' })}: {formatTokens(quota.used)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className={styles.modelList}>
            <Input
              allowClear
              value={modelKeyword}
              prefix={<SearchOutlined />}
              placeholder={intl.formatMessage({ id: 'personalModel.search' })}
              className={styles.modelSearch}
              onChange={(event) => setModelKeyword(event.target.value)}
            />
            <List
              dataSource={filteredModels}
              locale={{ emptyText: intl.formatMessage({ id: 'personalModel.empty' }) }}
              renderItem={(item: any) => {
                const current = isCurrentModel(item, modelInfo, sortedModels);
                return (
                  <div
                    className={styles.modelItem}
                    onClick={(event) => {
                      // 操作区只处理启用确认，不能继续触发卡片的详情抽屉。
                      if ((event.target as HTMLElement).closest('[data-model-action]')) return;
                      void openModelDetail(item);
                    }}
                  >
                    <div className={styles.modelHeader}>
                      <div className={styles.modelTitleLine}>
                        <div className={styles.modelName}>{item.displayName}</div>
                      </div>
                      <div className={styles.modelActions}>
                        {current ? (
                          <Tag className={styles.currentModelTag}>
                            {intl.formatMessage({ id: 'personalModel.status.enabled', defaultMessage: '已启用' })}
                          </Tag>
                        ) : null}
                        {isEmployeeModelPanel && canEditEmployee && !current ? (
                          <div data-model-action onClick={(event) => event.stopPropagation()}>
                            <Popconfirm
                              title={intl.formatMessage({
                                id: 'personalModel.confirmEnable',
                                defaultMessage: '确认启用该模型吗？',
                              })}
                              onConfirm={(event) => {
                                event?.stopPropagation();
                                void activateModel(item);
                              }}
                              onCancel={(event) => event?.stopPropagation()}
                            >
                              <Button
                                type="link"
                                className={styles.modelEnableButton}
                                size="small"
                                loading={`${activatingModelId ?? ''}` === `${item.id}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {intl.formatMessage({ id: 'personalModel.action.enable' })}
                              </Button>
                            </Popconfirm>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className={styles.modelCodeLine}>
                      <span className={styles.modelTypeTag}>{item.modelType || 'LLM'}</span>
                      <span className={styles.modelCode}>{item.modelCode || '-'}</span>
                    </div>
                  </div>
                );
              }}
            />
          </div>
        </Spin>
      </div>
      <Drawer
        open={Boolean(selectedModel)}
        title={
          selectedModel?.displayName ||
          selectedModel?.modelName ||
          intl.formatMessage({ id: 'personalModel.detail.title' })
        }
        width="min(560px, calc(100vw - 24px))"
        destroyOnClose
        className={styles.modelDetailDrawer}
        onClose={() => setSelectedModel(null)}
      >
        <Spin spinning={selectedModelLoading}>
          {selectedModel &&
            getModelDetailSections(selectedModel, intl).map((section) => (
              <Card key={section.key} className={styles.modelDetailSection} title={section.title} size="small">
                <Descriptions column={1} size="small" bordered>
                  {section.items.map(({ key, label, value }) => (
                    <Descriptions.Item key={key} label={label}>
                      {(() => {
                        const displayValue = formatModelDetailValue(
                          key === 'abilities' && Array.isArray(value)
                            ? value.map((item) => abilityLabelMap[`${item}`] || item)
                            : value,
                          intl
                        );
                        return (
                          <div className={styles.modelDetailValueRow}>
                            <span className={styles.modelDetailValue}>{displayValue}</span>
                            {isCopyableModelDetailKey(key) && displayValue !== '-' ? (
                              <Button
                                type="text"
                                size="small"
                                className={styles.modelDetailCopy}
                                icon={<CopyOutlined />}
                                title={intl.formatMessage({ id: 'common.copy' })}
                                aria-label={intl.formatMessage({ id: 'common.copy' })}
                                onClick={() => void copyModelDetailValue(displayValue, intl)}
                              />
                            ) : null}
                          </div>
                        );
                      })()}
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </Card>
            ))}
        </Spin>
      </Drawer>
    </div>
  );
};

export default ModelSiderPanel;
