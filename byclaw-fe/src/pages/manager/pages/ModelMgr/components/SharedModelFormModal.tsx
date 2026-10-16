import { getTitle, type ModalStore } from '@/pages/manager/hooks/useShowModal';
import { Button, Form, message, Modal } from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';
import { getCatalogProviderValues } from './mediaProviderCatalog';
import ModelDebugPanel from './ModelDebugPanel';
import ModelFormFields from './ModelFormFields';
import {
  buildAutoDebugRequestText,
  buildDebugDefaults,
  buildModelUpsertPayload,
  DEFAULT_CONTEXT_TOKENS,
  formatReasoningEffortMapText,
  getDefaultFormValues,
  getDefaultMaxTokens,
  getImageGenerationDefaultFormValues,
  getImageProviderTransitionFormValues,
  getModelTypeTransitionFormValues,
  isExampleApiEndpointPlaceholder,
  normalizeModelType,
} from './modelFormUtils';
import useModelDebug from './useModelDebug';
import useModelTypeOptions from './useModelTypeOptions';
import { getImageConfigFormValues, isVolcengineImage } from './volcengineImageConfig';
import { getImageGenerationProvider, resolveImageGenerationProviderName } from './imageGenerationProviders';
import {
  applyAutofillFields,
  applyModelAutofill,
  createModelAutofillState,
  getNewModelFormValues,
  MODEL_FORM_PRESETS,
} from './modelFormPresets';
import styles from './ModelFormModal.module.less';

type Option = { label: string; value: string };

type DebugRequestParams = {
  modelId: string | number;
  input: string;
  modelType?: any;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
};

type Props = ModalStore<any> & {
  onCancel: () => void;
  onSaved: () => void;
  loadDetail: (id: string | number) => Promise<any>;
  saveModelRequest: (payload: any) => Promise<any>;
  runDebugRequest: (params: DebugRequestParams) => Promise<any>;
  statusOptions: Option[];
  showTags?: boolean;
  allowRerankTable?: boolean;
  formatDebugError?: (error: any) => string | undefined;
  loadAbilityOptions?: () => Promise<Option[]>;
  loadSystemOptions?: () => Promise<Option[]>;
  extractModelIdFromSave?: (res: any) => string | number | undefined;
  querySavedModelId?: (values: any, res: any) => Promise<string | number | undefined>;
};

const SharedModelFormModal: React.FC<Props> = ({
  open,
  type,
  data,
  onCancel,
  onSaved,
  loadDetail,
  saveModelRequest,
  runDebugRequest,
  statusOptions,
  showTags = true,
  allowRerankTable = true,
  formatDebugError,
  loadAbilityOptions,
  loadSystemOptions,
  extractModelIdFromSave,
  querySavedModelId,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm();

  const [tokenVisible, setTokenVisible] = useState(type === 'add');
  const modelTypeOptions = useModelTypeOptions(open);
  const [abilityOptions, setAbilityOptions] = useState<Option[]>([]);
  const [systemOptions, setSystemOptions] = useState<Option[]>([]);
  const [activeSections, setActiveSections] = useState<string[]>(['basic']);
  const [submitAction, setSubmitAction] = useState<'save_continue' | 'save_close' | null>(null);
  const [savedNewId, setSavedNewId] = useState<string | number | undefined>(undefined);
  const savedNewIdRef = useRef<string | number | undefined>(undefined);
  const lastApiEndpointForSyncRef = useRef<string | undefined>(undefined);
  const lastModelTypeForSyncRef = useRef<string>('LLM');
  const autofillRef = useRef(createModelAutofillState());

  const currentModelType = Form.useWatch('modelType', form);
  const currentDisplayName = Form.useWatch('displayName', form);
  const currentProviderName = Form.useWatch('providerName', form);
  const currentContextTokens = Form.useWatch('contextTokens', form);
  const currentSystems = Form.useWatch('systems', form);
  const currentAbilities = Form.useWatch('abilities', form);
  const currentModelProtocol = Form.useWatch('modelProtocol', form);

  const debugDefaults = useMemo(() => buildDebugDefaults(intl), [intl]);

  const existingModelId =
    data?.id === null || data?.id === undefined || `${data?.id}`.trim() === '' ? undefined : data?.id;
  const getCurrentModelId = useCallback(
    () => existingModelId ?? savedNewIdRef.current ?? savedNewId,
    [existingModelId, savedNewId]
  );
  const canAutofill = type === 'add' && existingModelId === undefined && savedNewId === undefined;

  const {
    copyText,
    debugInput,
    debugInputMode,
    debugOutput,
    debugOutputLoading,
    rerankTableData,
    rerankView,
    resetDebugState,
    runDebug,
    setDebugInput,
    setDebugInputMode,
    setDebugOutput,
    setRerankView,
    shouldShowRerankTable,
  } = useModelDebug({
    intl,
    open,
    currentModelType,
    currentProviderName,
    currentModelProtocol,
    getCurrentModelId,
    allowRerankTable,
    formatDebugError,
    runDebugRequest,
  });

  const applySavedModelId = useCallback((id?: string | number) => {
    savedNewIdRef.current = id;
    setSavedNewId(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    // 新增时优先填写基础配置，编辑和调试时展开更多配置便于核对已有参数。
    setActiveSections(type === 'add' ? ['basic'] : ['basic', 'more']);

    if (showTags && loadAbilityOptions) {
      loadAbilityOptions()
        .then((opts) => setAbilityOptions(Array.isArray(opts) ? opts : []))
        .catch(() => setAbilityOptions([]));
    } else {
      setAbilityOptions([]);
    }

    if (showTags && loadSystemOptions) {
      loadSystemOptions()
        .then((opts) => setSystemOptions(Array.isArray(opts) ? opts : []))
        .catch(() => setSystemOptions([]));
    } else {
      setSystemOptions([]);
    }
  }, [loadAbilityOptions, loadSystemOptions, open, showTags, type]);

  useEffect(() => {
    if (!open) return;
    setTokenVisible(type === 'add');
    resetDebugState();
    setDebugInputMode('auto');
    setDebugInput('');

    if (type !== 'add') {
      applySavedModelId(undefined);
    }

    if ((type === 'edit' || type === 'debug') && data?.id) {
      loadDetail(data.id)
        .then((detail: any) => {
          if (!detail) return;

          const inparamTemplateStr =
            detail?.inparamTemplate === null || detail?.inparamTemplate === undefined
              ? ''
              : `${detail.inparamTemplate}`;
          const hasTemplate = !!inparamTemplateStr.trim();

          const modelType = normalizeModelType(detail.modelType);
          const imageDefaults: Record<string, any> =
            modelType === 'IMAGE_GENERATION' ? getImageGenerationDefaultFormValues() : {};
          let providerName = detail.providerName;
          if (modelType === 'IMAGE_GENERATION') {
            providerName = resolveImageGenerationProviderName(
              detail.providerName,
              detail.modelProtocol || imageDefaults.modelProtocol
            );
          }
          const nextFormValues = {
            ...imageDefaults,
            ...getImageConfigFormValues(detail),
            displayName: detail.displayName,
            providerName,
            modelProtocol: detail.modelProtocol || imageDefaults.modelProtocol || 'OpenAI',
            modelCode: detail.modelCode || imageDefaults.modelCode,
            modelType,
            apiEndpoint: detail.apiEndpoint || imageDefaults.apiEndpoint || '',
            apiToken: detail.apiToken || '',
            extendParam:
              typeof detail.extendParam === 'object' ? JSON.stringify(detail.extendParam, null, 2) : detail.extendParam,
            headers: Array.isArray(detail.headers) && detail.headers.length ? detail.headers : [{ key: '', value: '' }],
            connectTimeoutSec: detail.connectTimeoutSec ?? 32,
            readTimeoutSec: detail.readTimeoutSec ?? 60,
            maxRetries: detail.maxRetries ?? 3,
            retryIntervalSec: detail.retryIntervalSec ?? 1,
            contextTokens: detail.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
            temperature: detail.temperature ?? 0.7,
            topP: detail.topP ?? 0.9,
            maxTokens: detail.maxTokens ?? getDefaultMaxTokens(detail.contextTokens),
            frequencyPenalty: detail.frequencyPenalty ?? 0,
            presencePenalty: detail.presencePenalty ?? 0,
            reasoningConfig: detail.reasoningConfig ?? getDefaultFormValues().reasoningConfig,
            reasoningEffortMapText: formatReasoningEffortMapText(detail.reasoningConfig),
            abilities: detail.abilities || [],
            systems: detail.systems || [],
            applicabilityScope: detail.applicabilityScope ?? '',
            status: detail.status || 'ENABLED',
          };

          if (hasTemplate) {
            setDebugInputMode('template');
            setDebugInput(inparamTemplateStr);
          } else {
            setDebugInputMode('auto');
            setDebugInput(
              buildAutoDebugRequestText({
                formValues: nextFormValues,
                id: data.id,
                prevText: '',
                ...debugDefaults,
              })
            );
          }
          lastApiEndpointForSyncRef.current = nextFormValues.apiEndpoint ?? '';
          lastModelTypeForSyncRef.current = nextFormValues.modelType;
          // setFieldsValue 会深合并对象，先清空新字段，避免另一条模型记录的参数串入。
          form.setFieldValue('imageGenerationConfig', undefined);
          form.setFieldsValue(nextFormValues);
        })
        .catch(() => undefined);
      return;
    }

    form.resetFields();
    const nextFormValues = getNewModelFormValues();
    autofillRef.current = createModelAutofillState();
    form.setFieldsValue(nextFormValues);
    setDebugInputMode('auto');
    setDebugInput(
      buildAutoDebugRequestText({
        formValues: nextFormValues,
        prevText: '',
        syncFormParameters: true,
        ...debugDefaults,
      })
    );
    lastApiEndpointForSyncRef.current = nextFormValues.apiEndpoint ?? '';
    lastModelTypeForSyncRef.current = nextFormValues.modelType;
    applySavedModelId(undefined);
  }, [
    applySavedModelId,
    data,
    debugDefaults,
    form,
    loadDetail,
    open,
    resetDebugState,
    setDebugInput,
    setDebugInputMode,
    type,
  ]);

  const modalTitle = useMemo(() => {
    if (!type) return '';
    if (type === 'edit') return data?.displayName || intl.formatMessage({ id: 'modelMgr.modal.editTitle' });
    if (type === 'debug') return data?.displayName || intl.formatMessage({ id: 'modelMgr.modal.debugTitle' });
    if (type === 'add') return intl.formatMessage({ id: 'modelMgr.modal.addTitle' });
    return getTitle(type, intl.formatMessage({ id: 'modelMgr.modal.modelFallbackTitle' }));
  }, [data, intl, type]);

  const buildUpsertPayload = (values: any) => {
    return buildModelUpsertPayload({
      values,
      type,
      dataId: data?.id,
      savedNewId,
    });
  };

  const scrollToFirstError = (error: any) => {
    const firstNamePath = error?.errorFields?.[0]?.name;
    if (Array.isArray(firstNamePath) && firstNamePath.length) {
      // 折叠区内的必填/格式错误必须先展开，避免用户看不到保存失败的原因。
      setActiveSections(['basic', 'more', 'basicExtra']);
      requestAnimationFrame(() => form.scrollToField?.(firstNamePath, { behavior: 'smooth' }));
    }
  };

  const getErrorMessage = (error: any) => {
    if (!error) return intl.formatMessage({ id: 'common.saveFail' });
    if (typeof error === 'string') return error;
    const detail =
      error?.msg ||
      error?.message ||
      error?.data?.msg ||
      error?.response?.msg ||
      error?.response?.data?.msg ||
      error?.response?.data?.message;
    return detail
      ? `${intl.formatMessage({ id: 'common.saveFail' })}: ${detail}`
      : intl.formatMessage({ id: 'common.saveFail' });
  };

  const saveModel = async (mode: 'save_continue' | 'save_close') => {
    setSubmitAction(mode);
    try {
      const values = await form.validateFields();
      // validateFields 只包含已注册控件；合并整块图片配置以保留未来版本的未知字段。
      const storedImageConfig = form.getFieldValue('imageGenerationConfig');
      if (storedImageConfig) values.imageGenerationConfig = storedImageConfig;
      const payload = buildUpsertPayload(values);
      const res = await saveModelRequest(payload);

      const extractedModelId = extractModelIdFromSave?.(res);
      let resolvedModelId = extractedModelId;
      if ((resolvedModelId === null || resolvedModelId === undefined) && querySavedModelId) {
        resolvedModelId = await querySavedModelId(values, res);
      }

      if (mode === 'save_continue') {
        if (resolvedModelId !== null && resolvedModelId !== undefined) {
          applySavedModelId(resolvedModelId);
        }
        message.success(intl.formatMessage({ id: 'modelMgr.modal.saveSuccess' }));
        if (resolvedModelId === null || resolvedModelId === undefined) {
          message.warning(intl.formatMessage({ id: 'modelMgr.modal.saveWithoutId' }));
        }
        onSaved();
        return;
      }

      if (type === 'add') {
        applySavedModelId(resolvedModelId);
      }
      message.success(
        type === 'edit' || type === 'debug'
          ? intl.formatMessage({ id: 'modelMgr.modal.editSuccess' })
          : intl.formatMessage({ id: 'modelMgr.modal.createSuccess' })
      );
      onCancel();
      onSaved();
    } catch (error: any) {
      if (error?.errorFields) {
        message.error(intl.formatMessage({ id: 'form.required' }));
        scrollToFirstError(error);
      } else {
        message.error(getErrorMessage(error));
      }
    } finally {
      setSubmitAction(null);
    }
  };

  const handleValuesChange = (changedValues: any, allValues: any, fromPreset = false) => {
    const changedKeys = Object.keys(changedValues || {});
    let syncedValues = allValues;
    if (type === 'add' && typeof changedValues?.reasoningConfig?.enabled === 'boolean') {
      const config = allValues.reasoningConfig || {};
      const capability = config.capability === 'unsupported' ? 'effort' : config.capability;
      let defaultLevel = 'off';
      if (config.enabled) {
        if (config.defaultLevel && config.defaultLevel !== 'off') defaultLevel = config.defaultLevel;
        else defaultLevel = capability === 'adaptive' ? 'adaptive' : 'high';
      }
      const reasoningConfig = { ...config, capability, defaultLevel };
      form.setFieldValue('reasoningConfig', reasoningConfig);
      syncedValues = { ...allValues, reasoningConfig };
    }
    if (canAutofill) {
      changedKeys
        .filter((key) => !fromPreset || key !== 'modelCode')
        .forEach((key) => autofillRef.current.edited.add(key));
      if (changedKeys.includes('modelType')) {
        const defaults = getModelTypeTransitionFormValues(lastModelTypeForSyncRef.current, syncedValues.modelType);
        // 保留类型切换的既有默认值，但新增草稿不清除密钥、Header 或手动填写的接入信息。
        const suggestions: Record<string, any> = { ...defaults };
        delete suggestions.apiToken;
        delete suggestions.headers;
        const patch = applyAutofillFields(autofillRef.current, syncedValues, suggestions);
        Object.entries(patch).forEach(([key, value]) => form.setFieldValue(key, value));
        syncedValues = { ...syncedValues, ...patch };
        const capabilities = applyModelAutofill(autofillRef.current, {}, syncedValues);
        Object.entries(capabilities).forEach(([key, value]) => form.setFieldValue(key, value));
        syncedValues = { ...syncedValues, ...capabilities };
      }
      if (
        changedKeys.includes('providerName') &&
        syncedValues.modelType === 'IMAGE_GENERATION' &&
        !getCatalogProviderValues('IMAGE_GENERATION', changedValues.providerName)
      ) {
        const provider = getImageGenerationProvider(changedValues.providerName);
        if (provider) {
          const connection = applyAutofillFields(autofillRef.current, syncedValues, {
            modelProtocol: provider.modelProtocol,
            apiEndpoint: provider.apiEndpoint,
            modelCode: provider.modelCode,
          });
          syncedValues = { ...syncedValues, ...connection };
          const defaults = applyModelAutofill(
            autofillRef.current,
            {},
            syncedValues,
            `${provider.providerName}:${syncedValues.modelCode}`
          );
          syncedValues = { ...syncedValues, ...defaults };
          Object.entries({ ...connection, ...defaults }).forEach(([key, value]) => form.setFieldValue(key, value));
        }
      }
      // 手动确认上下文后同步收窄缺省输出预算；显式填写的 Max Tokens 仍优先。
      if (changedKeys.includes('modelCode') || changedKeys.includes('contextTokens')) {
        const patch = applyModelAutofill(autofillRef.current, fromPreset ? {} : changedValues, syncedValues);
        // 自动切换类型/协议也要重建调试路径，防止同一厂商的 embeddings/responses 路径互相残留。
        ['modelType', 'modelProtocol'].forEach((key) => {
          if (key in patch && patch[key] !== syncedValues[key] && !changedKeys.includes(key)) changedKeys.push(key);
        });
        // 避免 AntD 深合并把上一型号的 reasoning/image 参数留在新模板中。
        Object.entries(patch).forEach(([key, value]) => form.setFieldValue(key, value));
        syncedValues = { ...syncedValues, ...patch };
      }
      lastModelTypeForSyncRef.current = normalizeModelType(syncedValues?.modelType);
    } else if (changedKeys.includes('modelType')) {
      const targetModelType = normalizeModelType(changedValues?.modelType);
      const modelTypeDefaults = getModelTypeTransitionFormValues(lastModelTypeForSyncRef.current, targetModelType);
      form.setFieldsValue(modelTypeDefaults);
      syncedValues = { ...allValues, ...modelTypeDefaults };
      lastModelTypeForSyncRef.current = targetModelType;
    }

    if (changedKeys.includes('providerName')) {
      const providerDefaults =
        getCatalogProviderValues(normalizeModelType(syncedValues?.modelType), changedValues?.providerName) ||
        (!canAutofill && normalizeModelType(syncedValues?.modelType) === 'IMAGE_GENERATION'
          ? getImageProviderTransitionFormValues(changedValues?.providerName, syncedValues)
          : {});
      const providerPatch = canAutofill
        ? applyAutofillFields(autofillRef.current, syncedValues, providerDefaults)
        : providerDefaults;
      Object.entries(providerPatch).forEach(([key, value]) => form.setFieldValue(key, value));
      syncedValues = { ...syncedValues, ...providerPatch };
    }

    if (normalizeModelType(syncedValues?.modelType) === 'IMAGE_GENERATION' && !syncedValues?.providerName?.trim()) {
      // 协议补全只写缺失的提供商，已有配置及自定义接入地址/型号保持原值。
      const providerName = resolveImageGenerationProviderName(undefined, syncedValues?.modelProtocol);
      form.setFieldValue('providerName', providerName);
      syncedValues = { ...syncedValues, providerName };
    }

    // 协议切换只联动 placeholder；若当前仍是示例地址则清空，避免挡住新协议样例。
    if (changedKeys.includes('modelProtocol') && isExampleApiEndpointPlaceholder(syncedValues?.apiEndpoint)) {
      form.setFieldsValue({ apiEndpoint: '' });
      syncedValues = { ...syncedValues, apiEndpoint: '' };
    }

    if (debugInputMode !== 'auto') return;

    const shouldSync = changedKeys.some(
      (key) => !['systems', 'applicabilityScope', 'abilities', 'status'].includes(key)
    );
    if (!shouldSync) return;

    const prevEndpoint = lastApiEndpointForSyncRef.current;
    setDebugInput((prev) =>
      buildAutoDebugRequestText({
        formValues: syncedValues,
        id: data?.id,
        prevText: prev,
        changedKeys,
        previousApiEndpoint: prevEndpoint,
        syncFormParameters: type === 'add',
        ...debugDefaults,
      })
    );
    lastApiEndpointForSyncRef.current = `${syncedValues?.apiEndpoint ?? ''}`.trim();
  };

  const handlePresetSelect = (presetId: string) => {
    if (!canAutofill) return;
    const preset = MODEL_FORM_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    autofillRef.current.presetId = presetId;
    autofillRef.current.edited.delete('modelCode');
    autofillRef.current.automatic.modelCode = preset.values.modelCode;
    form.setFieldValue('modelCode', preset.values.modelCode);
    handleValuesChange({ modelCode: preset.values.modelCode }, form.getFieldsValue(true), true);
  };

  const isSectionOpen = (key: string) => activeSections.includes(key);
  const toggleSection = (key: string) => {
    setActiveSections((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  return (
    <Modal
      open={open}
      centered
      title={modalTitle}
      onCancel={onCancel}
      width={1240}
      wrapClassName={styles.modelFormModalWrap}
      destroyOnHidden
      maskClosable={false}
      footer={
        <div className={styles.footer}>
          <div className={styles.footerMeta}>{intl.formatMessage({ id: 'modelMgr.modal.footerHint' })}</div>
          <Button onClick={onCancel} disabled={submitAction !== null}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          {type === 'add' ? (
            <Button
              loading={submitAction === 'save_continue'}
              disabled={submitAction !== null}
              onClick={() => saveModel('save_continue')}
            >
              {intl.formatMessage({ id: 'modelMgr.modal.saveAndContinue' })}
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={submitAction === 'save_close'}
            disabled={submitAction !== null}
            onClick={() => saveModel('save_close')}
          >
            {type === 'add'
              ? intl.formatMessage({ id: 'modelMgr.modal.saveAndClose' })
              : intl.formatMessage({ id: 'common.confirm' })}
          </Button>
        </div>
      }
    >
      <div className={styles.modalBody}>
        <ModelFormFields
          simplified={type === 'add'}
          canAutofill={canAutofill}
          presetId={autofillRef.current.presetId}
          onPresetSelect={handlePresetSelect}
          form={form}
          modalTitle={modalTitle}
          currentDisplayName={currentDisplayName}
          currentModelType={currentModelType}
          currentProviderName={currentProviderName}
          currentContextTokens={currentContextTokens}
          currentSystems={currentSystems}
          currentAbilities={currentAbilities}
          systemOptions={systemOptions}
          abilityOptions={abilityOptions}
          modelTypeOptions={modelTypeOptions}
          statusOptions={statusOptions}
          tokenVisible={tokenVisible}
          setTokenVisible={setTokenVisible}
          isSectionOpen={isSectionOpen}
          toggleSection={toggleSection}
          onValuesChange={handleValuesChange}
        />

        <div className={styles.right}>
          <ModelDebugPanel
            showImagePreview={isVolcengineImage({ modelType: currentModelType, modelProtocol: currentModelProtocol })}
            currentModelType={normalizeModelType(currentModelType)}
            debugInputMode={debugInputMode}
            debugInput={debugInput}
            setDebugInput={setDebugInput}
            debugOutput={debugOutput}
            setDebugOutput={setDebugOutput}
            debugOutputLoading={debugOutputLoading}
            runDebug={runDebug}
            copyText={copyText}
            shouldShowRerankTable={shouldShowRerankTable}
            rerankView={rerankView}
            setRerankView={setRerankView}
            rerankTableData={rerankTableData}
          />
        </div>
      </div>
    </Modal>
  );
};

export default SharedModelFormModal;
