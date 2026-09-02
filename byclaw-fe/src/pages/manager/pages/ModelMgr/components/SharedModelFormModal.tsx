import { getTitle, type ModalStore } from '@/pages/manager/hooks/useShowModal';
import { getByParamGroupCode } from '@/pages/manager/service/System';
import { Button, Form, message, Modal } from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl, getLocale } from '@umijs/max';
import ModelDebugPanel from './ModelDebugPanel';
import ModelFormFields from './ModelFormFields';
import {
  buildAutoDebugRequestText,
  buildDebugDefaults,
  buildModelUpsertPayload,
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MAX_TOKENS,
  formatReasoningEffortMapText,
  getDefaultFormValues,
  getImageGenerationDefaultFormValues,
  getImageProviderTransitionFormValues,
  getModelTypeTransitionFormValues,
  isExampleApiEndpointPlaceholder,
  normalizeModelType,
} from './modelFormUtils';
import useModelDebug from './useModelDebug';
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
  const fallbackModelTypeOptions = useMemo(
    () => [
      { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeLLM' }), value: 'LLM' },
      { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeRERANK' }), value: 'RERANK' },
      { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeEMBEDDING' }), value: 'EMBEDDING' },
      { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeTTS' }), value: 'TTS' },
      {
        label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeIMAGE_GENERATION' }),
        value: 'IMAGE_GENERATION',
      },
    ],
    [intl]
  );
  const [abilityOptions, setAbilityOptions] = useState<Option[]>([]);
  const [systemOptions, setSystemOptions] = useState<Option[]>([]);
  const [modelTypeOptions, setModelTypeOptions] = useState<Option[]>(() => fallbackModelTypeOptions);
  const [activeSections, setActiveSections] = useState<string[]>(['basic', 'connection', 'params']);
  const [submitAction, setSubmitAction] = useState<'save_continue' | 'save_close' | null>(null);
  const [savedNewId, setSavedNewId] = useState<string | number | undefined>(undefined);
  const savedNewIdRef = useRef<string | number | undefined>(undefined);
  const lastApiEndpointForSyncRef = useRef<string | undefined>(undefined);
  const lastModelTypeForSyncRef = useRef<string>('LLM');

  const currentModelType = Form.useWatch('modelType', form);
  const currentDisplayName = Form.useWatch('displayName', form);
  const currentProviderName = Form.useWatch('providerName', form);
  const currentContextTokens = Form.useWatch('contextTokens', form);
  const currentSystems = Form.useWatch('systems', form);
  const currentAbilities = Form.useWatch('abilities', form);

  const debugDefaults = useMemo(() => buildDebugDefaults(intl), [intl]);
  const local = getLocale();
  const isEN = useMemo(() => local.includes('en'), [local]);

  const existingModelId =
    data?.id === null || data?.id === undefined || `${data?.id}`.trim() === '' ? undefined : data?.id;
  const getCurrentModelId = useCallback(
    () => existingModelId ?? savedNewIdRef.current ?? savedNewId,
    [existingModelId, savedNewId]
  );

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
    setActiveSections(showTags ? ['basic', 'connection', 'params', 'tags'] : ['basic', 'connection', 'params']);

    getByParamGroupCode({ paramGroupCode: 'SYSTEM_MODEL_TYPE' })
      .then((res: any) => {
        const list = res?.data?.byaiSystemConfigLists;
        if (Array.isArray(list) && list.length > 0) {
          const opts = list
            .map((item: any) => ({
              label: isEN ? item.paramEnName : item.paramName,
              value: item?.paramValue,
            }))
            .filter((item: any) => item.value);
          const imageOption = fallbackModelTypeOptions.find((item) => item.value === 'IMAGE_GENERATION');
          setModelTypeOptions(
            imageOption && !opts.some((item: Option) => item.value === 'IMAGE_GENERATION')
              ? [...opts, imageOption]
              : opts
          );
          return;
        }
        setModelTypeOptions(fallbackModelTypeOptions);
      })
      .catch(() => {
        setModelTypeOptions(fallbackModelTypeOptions);
      });

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
  }, [fallbackModelTypeOptions, isEN, loadAbilityOptions, loadSystemOptions, open, showTags, type]);

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
          const nextFormValues = {
            ...imageDefaults,
            displayName: detail.displayName,
            providerName: detail.providerName || imageDefaults.providerName,
            modelProtocol: detail.modelProtocol || imageDefaults.modelProtocol || 'OpenAI',
            modelCode: detail.modelCode || imageDefaults.modelCode,
            modelType,
            apiEndpoint: detail.apiEndpoint || imageDefaults.apiEndpoint || '',
            apiToken: detail.apiToken || '',
            headers: Array.isArray(detail.headers) && detail.headers.length ? detail.headers : [{ key: '', value: '' }],
            connectTimeoutSec: detail.connectTimeoutSec ?? 32,
            readTimeoutSec: detail.readTimeoutSec ?? 60,
            maxRetries: detail.maxRetries ?? 3,
            retryIntervalSec: detail.retryIntervalSec ?? 1,
            contextTokens: detail.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
            temperature: detail.temperature ?? 0.7,
            topP: detail.topP ?? 0.9,
            maxTokens: detail.maxTokens ?? DEFAULT_MAX_TOKENS,
            frequencyPenalty: detail.frequencyPenalty ?? 0,
            presencePenalty: detail.presencePenalty ?? 0,
            reasoningConfig: detail.reasoningConfig ?? getDefaultFormValues().reasoningConfig,
            reasoningEffortMapText: formatReasoningEffortMapText(detail.reasoningConfig),
            abilities: detail.abilities || [],
            systems: detail.systems || [],
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
          form.setFieldsValue(nextFormValues);
        })
        .catch(() => undefined);
      return;
    }

    form.resetFields();
    const nextFormValues = getDefaultFormValues();
    form.setFieldsValue(nextFormValues);
    setDebugInputMode('auto');
    setDebugInput(
      buildAutoDebugRequestText({
        formValues: nextFormValues,
        prevText: '',
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
      form.scrollToField?.(firstNamePath, { behavior: 'smooth' });
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
      const payload = buildUpsertPayload(values);
      const res = await saveModelRequest(payload);

      const extractedModelId = extractModelIdFromSave?.(res);
      const resolvedModelId =
        extractedModelId !== null && extractedModelId !== undefined
          ? extractedModelId
          : querySavedModelId
            ? await querySavedModelId(values, res)
            : undefined;

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

  const handleValuesChange = (changedValues: any, allValues: any) => {
    const changedKeys = Object.keys(changedValues || {});
    let syncedValues = allValues;
    if (changedKeys.includes('modelType')) {
      const targetModelType = normalizeModelType(changedValues?.modelType);
      const modelTypeDefaults = getModelTypeTransitionFormValues(lastModelTypeForSyncRef.current, targetModelType);
      form.setFieldsValue(modelTypeDefaults);
      syncedValues = { ...allValues, ...modelTypeDefaults };
      lastModelTypeForSyncRef.current = targetModelType;
    }

    if (changedKeys.includes('providerName') && normalizeModelType(syncedValues?.modelType) === 'IMAGE_GENERATION') {
      const providerDefaults = getImageProviderTransitionFormValues(changedValues?.providerName);
      form.setFieldsValue(providerDefaults);
      syncedValues = { ...syncedValues, ...providerDefaults };
    }

    // 协议切换只联动 placeholder；若当前仍是示例地址则清空，避免挡住新协议样例。
    if (changedKeys.includes('modelProtocol') && isExampleApiEndpointPlaceholder(syncedValues?.apiEndpoint)) {
      form.setFieldsValue({ apiEndpoint: '' });
      syncedValues = { ...syncedValues, apiEndpoint: '' };
    }

    if (debugInputMode !== 'auto') return;

    const shouldSync = changedKeys.some((key) => !['systems', 'abilities', 'status'].includes(key));
    if (!shouldSync) return;

    const prevEndpoint = lastApiEndpointForSyncRef.current;
    setDebugInput((prev) =>
      buildAutoDebugRequestText({
        formValues: syncedValues,
        id: data?.id,
        prevText: prev,
        changedKeys,
        previousApiEndpoint: prevEndpoint,
        ...debugDefaults,
      })
    );
    lastApiEndpointForSyncRef.current = `${syncedValues?.apiEndpoint ?? ''}`.trim();
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
