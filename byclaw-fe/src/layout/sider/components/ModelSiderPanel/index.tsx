import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Input, List, Popconfirm, Progress, Spin, Tag, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import useResourceCenterRouter from '@/layout/sider/components/useResourceCenterRouter';
import useGlobal from '@/hooks/useGlobal';
import { getMyModels, getMyQuota } from '@/pages/models/service';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import { updateDigitalEmployee } from '@/pages/manager/service/DigitalEmployeeMgr';
import { queryResourceOperationPermissions } from '@/pages/manager/service/resources';
import { POST } from '@/service/common/request';
import { getModelDetail } from '@/pages/manager/service/ModelMgr';
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

const MODEL_DETAIL_LABELS: Record<string, string> = {
  id: '模型 ID',
  modelId: '模型 ID',
  displayName: '模型名称',
  modelName: '模型名称',
  modelType: '模型类型',
  providerName: '提供商',
  modelCode: '模型编码',
  modelNo: '模型编码',
  modelProtocol: '模型协议',
  status: '状态',
  isDefault: '默认对话模型',
  contextTokens: '上下文长度',
  maxContentToken: '最大内容 Token',
  maxTokens: '最大输出 Token',
  temperature: '温度',
  topP: 'Top P',
  frequencyPenalty: '频率惩罚',
  presencePenalty: '存在惩罚',
  abilities: '能力',
  systems: '系统标签',
  apiEndpoint: '接口地址',
  apiToken: 'API Token',
  apiTokenMasked: 'API Token',
  headers: '自定义请求头',
  connectTimeoutSec: '连接超时',
  readTimeoutSec: '读取超时',
  maxRetries: '最大重试次数',
  retryIntervalSec: '重试间隔',
  reasoningConfig: '思考配置',
  inparamTemplate: '入参模板',
  extendParam: '扩展参数',
  updatedAt: '最近更新时间',
  ownerType: '归属类型',
};

function formatModelDetailValue(value: any) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return (
      value
        .map((item) => formatModelDetailValue(item))
        .filter((item) => item !== '-')
        .join('、') || '-'
    );
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return `${value}`;
}

function getModelDetailItems(model: any) {
  if (!model) return [];
  const items: Array<{ key: string; label: string; value: any }> = [
    { key: 'id', label: '模型 ID', value: model.id || model.modelId },
    { key: 'displayName', label: '模型名称', value: model.displayName || model.modelName },
    { key: 'modelType', label: '模型类型', value: model.modelType },
    { key: 'providerName', label: '提供商', value: model.providerName },
    { key: 'modelCode', label: '模型编码', value: model.modelCode || model.modelNo },
    { key: 'modelProtocol', label: '模型协议', value: model.modelProtocol },
    {
      key: 'status',
      label: '状态',
      value: model.status === 'ENABLED' ? '已启用' : model.status === 'DISABLED' ? '未启用' : model.status,
    },
    { key: 'isDefault', label: '默认对话模型', value: model.isDefault === 1 || model.isDefault === '1' },
    {
      key: 'contextTokens',
      label: '上下文长度',
      value: model.contextTokens ? `${model.contextTokens} tokens` : undefined,
    },
    {
      key: 'maxContentToken',
      label: '最大内容 Token',
      value: model.maxContentToken,
    },
    { key: 'maxTokens', label: '最大输出 Token', value: model.maxTokens },
    { key: 'temperature', label: '温度', value: model.temperature },
    { key: 'topP', label: 'Top P', value: model.topP },
    { key: 'frequencyPenalty', label: '频率惩罚', value: model.frequencyPenalty },
    { key: 'presencePenalty', label: '存在惩罚', value: model.presencePenalty },
    { key: 'abilities', label: '能力', value: model.abilities },
    { key: 'systems', label: '系统标签', value: model.systems },
    { key: 'apiEndpoint', label: '接口地址', value: model.apiEndpoint },
    { key: 'apiToken', label: 'API Token', value: model.apiToken ?? model.apiTokenMasked },
    { key: 'headers', label: '自定义请求头', value: model.headers },
    {
      key: 'connectTimeoutSec',
      label: '连接超时',
      value: model.connectTimeoutSec === undefined ? undefined : `${model.connectTimeoutSec} 秒`,
    },
    {
      key: 'readTimeoutSec',
      label: '读取超时',
      value: model.readTimeoutSec === undefined ? undefined : `${model.readTimeoutSec} 秒`,
    },
    { key: 'maxRetries', label: '最大重试次数', value: model.maxRetries },
    {
      key: 'retryIntervalSec',
      label: '重试间隔',
      value: model.retryIntervalSec === undefined ? undefined : `${model.retryIntervalSec} 秒`,
    },
    { key: 'reasoningConfig', label: '思考配置', value: model.reasoningConfig },
    { key: 'inparamTemplate', label: '入参模板', value: model.inparamTemplate },
    { key: 'extendParam', label: '扩展参数', value: model.extendParam },
    { key: 'updatedAt', label: '最近更新时间', value: model.updatedAt },
  ];
  const knownKeys = new Set([
    ...items.map((item) => item.key),
    // 这些别名已合并到同一行，避免接口同时返回时重复展示。
    'modelId',
    'modelName',
    'modelNo',
    'apiTokenMasked',
  ]);
  Object.entries(model).forEach(([key, value]) => {
    if (!knownKeys.has(key) && value !== undefined && value !== null && value !== '') {
      items.push({ key, label: MODEL_DETAIL_LABELS[key] || key, value });
    }
  });

  return items.filter(({ value }) => value !== undefined && value !== null && value !== '');
}

function getModelDetailSections(model: any) {
  const items = getModelDetailItems(model);
  const groups = [
    {
      key: 'basic',
      title: '基础信息',
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
      title: '连接配置',
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
      title: '模型参数',
      keys: new Set([
        'contextTokens',
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
      title: '其他配置',
      keys: new Set(['reasoningConfig', 'inparamTemplate', 'extendParam', 'updatedAt', 'ownerType']),
    },
  ];
  const assignedKeys = new Set(groups.flatMap((group) => [...group.keys]));
  const extraItems = items.filter((item) => !assignedKeys.has(item.key));
  const advanced = groups.find((group) => group.key === 'advanced');
  if (advanced) advanced.keys = new Set([...advanced.keys, ...extraItems.map((item) => item.key)]);

  return groups
    .map((group) => ({ ...group, items: items.filter((item) => group.keys.has(item.key)) }))
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
    if (!isEmployeeModelPanel || !resourceId) {
      setCanEditEmployee(false);
      return undefined;
    }
    let cancelled = false;
    void queryResourceOperationPermissions({ resourceId }).then((response: any) => {
      if (!cancelled) setCanEditEmployee((response?.data || response || {}).canEdit === true);
    });
    return () => {
      cancelled = true;
    };
  }, [isEmployeeModelPanel, resourceId]);

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
        message.success(`启用${modelName}模型成功`);
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
              placeholder="搜索模型"
              className={styles.modelSearch}
              onChange={(event) => setModelKeyword(event.target.value)}
            />
            <List
              dataSource={filteredModels}
              locale={{ emptyText: intl.formatMessage({ id: 'personalModel.empty' }) }}
              renderItem={(item: any) => {
                const current = isCurrentModel(item, modelInfo, sortedModels);
                return (
                  <div className={styles.modelItem} onClick={() => void openModelDetail(item)}>
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
                          <Popconfirm
                            title={intl.formatMessage({
                              id: 'personalModel.confirmEnable',
                              defaultMessage: '确认启用该模型吗？',
                            })}
                            onConfirm={() => void activateModel(item)}
                          >
                            <Button
                              type="link"
                              className={styles.modelEnableButton}
                              size="small"
                              loading={`${activatingModelId ?? ''}` === `${item.id}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              启用
                            </Button>
                          </Popconfirm>
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
        title={selectedModel?.displayName || selectedModel?.modelName || '模型详情'}
        width="min(560px, calc(100vw - 24px))"
        destroyOnClose
        className={styles.modelDetailDrawer}
        onClose={() => setSelectedModel(null)}
      >
        <Spin spinning={selectedModelLoading}>
          {selectedModel &&
            getModelDetailSections(selectedModel).map((section) => (
              <Card key={section.key} className={styles.modelDetailSection} title={section.title} size="small">
                <Descriptions column={1} size="small" bordered>
                  {section.items.map(({ key, label, value }) => (
                    <Descriptions.Item key={key} label={label}>
                      <span className={styles.modelDetailValue}>{formatModelDetailValue(value)}</span>
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
