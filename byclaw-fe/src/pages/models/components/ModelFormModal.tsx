import { getTitle, type ModalStore } from '@/pages/manager/hooks/useShowModal';
import { getByParamGroupCode } from '@/pages/manager/service/System';
import { Button, Form, message, Modal } from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl, getLocale } from '@umijs/max';
import ModelDebugPanel from '@/pages/manager/pages/ModelMgr/components/ModelDebugPanel';
import ModelFormFields from '@/pages/manager/pages/ModelMgr/components/ModelFormFields';
import {
  buildAutoDebugRequestText,
  buildDebugDefaults,
  buildReasoningConfigPayload,
  formatReasoningEffortMapText,
  getDefaultFormValues,
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MAX_TOKENS,
  normalizeModelType,
} from '@/pages/manager/pages/ModelMgr/components/modelFormUtils';
import { getMyModelDetail, upsertMyModel } from '../service';
import styles from '@/pages/manager/pages/ModelMgr/components/ModelFormModal.module.less';

type Props = ModalStore<any> & {
  onCancel: () => void;
  onSaved: () => void;
};

const ModelFormModal: React.FC<Props> = (props) => {
  const { open, type, data, onCancel, onSaved } = props;
  const intl = useIntl();
  const [form] = Form.useForm();

  const [tokenVisible, setTokenVisible] = useState(type === 'add');
  const [abilityOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [systemOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [modelTypeOptions, setModelTypeOptions] = useState<Array<{ label: string; value: string }>>(() => [
    { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeLLM' }), value: 'LLM' },
    { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeRERANK' }), value: 'RERANK' },
    { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeEMBEDDING' }), value: 'EMBEDDING' },
  ]);
  const [activeSections, setActiveSections] = useState<string[]>(['basic', 'connection', 'params']);
  const [submitAction, setSubmitAction] = useState<'save_continue' | 'save_close' | null>(null);
  const [savedNewId, setSavedNewId] = useState<string | number | undefined>(undefined);

  const [debugInputMode, setDebugInputMode] = useState<'template' | 'auto'>('auto');
  const [debugInput, setDebugInput] = useState('');
  const [debugOutput, setDebugOutput] = useState('');
  const [debugOutputLoading, setDebugOutputLoading] = useState(false);
  const [rerankView, setRerankView] = useState<'table' | 'json'>('table');
  const abortRef = useRef<AbortController | null>(null);

  const lastApiEndpointForSyncRef = useRef<string | undefined>(undefined);

  const currentModelType = Form.useWatch('modelType', form);
  const currentDisplayName = Form.useWatch('displayName', form);
  const currentProviderName = Form.useWatch('providerName', form);
  const currentContextTokens = Form.useWatch('contextTokens', form);
  const currentSystems = Form.useWatch('systems', form);
  const currentAbilities = Form.useWatch('abilities', form);

  const statusOptions = useMemo(
    () => [
      { label: intl.formatMessage({ id: 'modelMgr.statusEnabled' }), value: 'ENABLED' },
      { label: intl.formatMessage({ id: 'modelMgr.statusDisabled' }), value: 'DISABLED' },
    ],
    [intl]
  );

  const debugDefaults = useMemo(() => buildDebugDefaults(intl), [intl]);

  const local = getLocale();
  const isEN = useMemo(() => local.includes('en'), [local]);

  useEffect(() => {
    if (!open) return;
    setActiveSections(type === 'debug' ? ['basic', 'connection', 'params'] : ['basic', 'connection', 'params']);

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
          setModelTypeOptions(opts);
        }
      })
      .catch(() => {});
  }, [open, isEN, type]);

  useEffect(() => {
    if (!open) return;
    setTokenVisible(type === 'add');
    setDebugOutput('');
    setDebugInputMode('auto');
    setDebugInput('');

    if ((type === 'edit' || type === 'debug') && data?.id) {
      getMyModelDetail({ id: data.id }).then((res: any) => {
        const detail = res?.data;
        if (!detail) return;

        const nextFormValues = {
          displayName: detail.displayName,
          providerName: detail.providerName,
          modelProtocol: detail.modelProtocol || 'OpenAI',
          modelCode: detail.modelCode,
          modelType: normalizeModelType(detail.modelType),
          apiEndpoint: detail.apiEndpoint || 'https://api.example.com/v1',
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

        const inparamTemplateStr =
          detail?.inparamTemplate === null || detail?.inparamTemplate === undefined ? '' : `${detail.inparamTemplate}`;
        if (inparamTemplateStr.trim()) {
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
        form.setFieldsValue(nextFormValues);
      });
    } else {
      setDebugInputMode('auto');
      form.resetFields();
      const nextFormValues = getDefaultFormValues();
      form.setFieldsValue(nextFormValues);
      setDebugInput(
        buildAutoDebugRequestText({
          formValues: nextFormValues,
          prevText: '',
          ...debugDefaults,
        })
      );
      lastApiEndpointForSyncRef.current = nextFormValues.apiEndpoint ?? '';
      setSavedNewId(undefined);
    }
  }, [data, debugDefaults, form, open, type]);

  const modalTitle = useMemo(() => {
    if (!type) return '';
    if (type === 'edit') return data?.displayName || intl.formatMessage({ id: 'modelMgr.modal.editTitle' });
    if (type === 'debug') return data?.displayName || intl.formatMessage({ id: 'modelMgr.modal.debugTitle' });
    if (type === 'add') return intl.formatMessage({ id: 'modelMgr.modal.addTitle' });
    return getTitle(type, '模型');
  }, [type, data, intl]);

  const buildUpsertPayload = (values: any) => {
    const restValues = { ...(values || {}) };
    delete restValues.reasoningEffortMapText;
    return {
      ...(type === 'edit' || type === 'debug'
        ? { id: data?.id }
        : type === 'add' && savedNewId !== null && savedNewId !== undefined
          ? { id: savedNewId }
          : {}),
      ...restValues,
      reasoningConfig: buildReasoningConfigPayload(values),
      modelType: normalizeModelType(values?.modelType),
    };
  };

  const saveModel = async (mode: 'save_continue' | 'save_close') => {
    setSubmitAction(mode);
    try {
      const values = await form.validateFields();
      const payload = buildUpsertPayload(values);
      const res = await upsertMyModel(payload);

      if (res?.code === 0 || res?.data) {
        if (mode === 'save_continue') {
          const id = res?.data?.id ?? res?.data;
          if (id) setSavedNewId(id);
          message.success(intl.formatMessage({ id: 'modelMgr.modal.saveSuccess' }));
          onSaved();
          return;
        }
        message.success(
          type === 'edit' || type === 'debug'
            ? intl.formatMessage({ id: 'modelMgr.modal.editSuccess' })
            : intl.formatMessage({ id: 'modelMgr.modal.createSuccess' })
        );
        onCancel();
        onSaved();
      }
    } catch (error: any) {
      if (error?.errorFields) {
        message.error('请完善必填项后再保存');
      } else {
        message.error(error?.msg || error?.message || intl.formatMessage({ id: 'common.saveFail' }));
      }
    } finally {
      setSubmitAction(null);
    }
  };

  const handleOk = async () => {
    await saveModel('save_close');
  };

  const handleSaveOnly = async () => {
    await saveModel('save_continue');
  };

  const isSectionOpen = (key: string) => activeSections.includes(key);
  const toggleSection = (key: string) => {
    setActiveSections((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const handleValuesChange = (changedValues: any, allValues: any) => {
    if (debugInputMode !== 'auto') return;
    const changedKeys = Object.keys(changedValues || {});
    const shouldSync = changedKeys.some((k) => !['systems', 'abilities', 'status'].includes(k));
    if (!shouldSync) return;

    const prevEndpoint = lastApiEndpointForSyncRef.current;
    setDebugInput((prev) =>
      buildAutoDebugRequestText({
        formValues: allValues,
        id: data?.id,
        prevText: prev,
        changedKeys,
        previousApiEndpoint: prevEndpoint,
        ...debugDefaults,
      })
    );
    lastApiEndpointForSyncRef.current = `${allValues?.apiEndpoint ?? ''}`.trim();
  };

  const runDebug = useCallback(() => {
    if (!debugInput?.trim()) {
      message.warning(intl.formatMessage({ id: 'modelMgr.modal.debugInputRequired' }));
      return;
    }
    const modelId = data?.id ?? savedNewId;
    if (!modelId) {
      message.warning(intl.formatMessage({ id: 'modelMgr.modal.debugIdRequired' }));
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setDebugOutput('');
    setDebugOutputLoading(true);

    fetch('/byaiService/personal/model/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: `${modelId}`, input: debugInput }),
      signal: abortRef.current.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');
        const decoder = new TextDecoder();
        let content = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          setDebugOutput(content);
          setDebugOutputLoading(false);
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setDebugOutput(`[Error] ${err.message || 'Request failed'}`);
        }
      })
      .finally(() => {
        setDebugOutputLoading(false);
        abortRef.current = null;
      });
  }, [data?.id, debugInput, intl, savedNewId]);

  const copyText = useCallback(
    async (text: string, successMessageId: string) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        message.success(intl.formatMessage({ id: successMessageId }));
      } catch {
        message.error(intl.formatMessage({ id: 'common.copyFail' }));
      }
    },
    [intl]
  );

  return (
    <Modal
      open={open}
      centered
      title={modalTitle}
      onCancel={onCancel}
      width={1240}
      wrapClassName={styles.modelFormModalWrap}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className={styles.footer}>
          <div className={styles.footerMeta}>{intl.formatMessage({ id: 'modelMgr.modal.footerHint' })}</div>
          <Button onClick={onCancel} disabled={submitAction !== null}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          {type === 'add' && (
            <Button
              loading={submitAction === 'save_continue'}
              disabled={submitAction !== null}
              onClick={handleSaveOnly}
            >
              {intl.formatMessage({ id: 'modelMgr.modal.saveAndContinue' })}
            </Button>
          )}
          <Button
            type="primary"
            loading={submitAction === 'save_close'}
            disabled={submitAction !== null}
            onClick={handleOk}
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
          isDebugOnly={true}
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
            shouldShowRerankTable={false}
            rerankView={rerankView}
            setRerankView={setRerankView}
            rerankTableData={[]}
          />
        </div>
      </div>
    </Modal>
  );
};

export default ModelFormModal;
