import { getTitle, type ModalStore } from '@/pages/manager/hooks/useShowModal';
import { getSourceSystemList } from '@/pages/manager/service/OrgMgr';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import { Button, Form, message, Modal } from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useIntl } from '@umijs/max';
import ModelDebugPanel from './ModelDebugPanel';
import ModelFormFields from './ModelFormFields';
import {
  buildAutoDebugRequestText,
  buildDebugDefaults,
  extractModelId,
  getDefaultFormValues,
  type ModelTagItem,
  normalizeModelType,
  SYSTEM_SOURCE_TYPES,
} from './modelFormUtils';
import useModelDebug from './useModelDebug';
import styles from './ModelFormModal.module.less';

type Props = ModalStore<any> & {
  onCancel: () => void;
  reload: () => void;
};

const ModelFormModal: React.FC<Props> = (props) => {
  const { open, type, data, onCancel, reload } = props;
  const intl = useIntl();
  const dispatch = useDispatch();
  const [form] = Form.useForm();
  const [tokenVisible, setTokenVisible] = useState(false);
  const [abilityOptions, setAbilityOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [systemOptions, setSystemOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [activeSections, setActiveSections] = useState<string[]>(['basic', 'connection']);
  const [submitAction, setSubmitAction] = useState<'save_continue' | 'save_close' | null>(null);

  /** 新增场景下首次「保存」成功后返回的模型 id，用于不关弹窗时右侧「运行」调试 */
  const [savedNewId, setSavedNewId] = useState<string | number | undefined>(undefined);
  const savedNewIdRef = useRef<string | number | undefined>(undefined);

  /** 上一轮同步右侧 url 时使用的 apiEndpoint，用于判断用户是否缩短了 endpoint，避免删除时出现 …/5/6/7 */
  const lastApiEndpointForSyncRef = useRef<string | undefined>(undefined);
  const isDebugOnly = type === 'debug';
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
      { label: intl.formatMessage({ id: 'modelMgr.statusTesting' }), value: 'TESTING' },
    ],
    [intl]
  );

  /** 模型类型：中文展示「大语言模型（LLM）」/「重排模型（RERANK）」/「向量模型（EMBEDDING）」，英文仅展示括号内 LLM/RERANK/EMBEDDING */
  const modelTypeOptions = useMemo(
    () => [
      { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeLLM' }), value: 'LLM' },
      { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeRERANK' }), value: 'RERANK' },
      { label: intl.formatMessage({ id: 'modelMgr.modal.modelTypeEMBEDDING' }), value: 'EMBEDDING' },
    ],
    [intl]
  );

  const debugDefaults = useMemo(() => buildDebugDefaults(intl), [intl]);

  useEffect(() => {
    if (!open) return;
    setActiveSections(type === 'debug' ? ['basic', 'connection', 'params'] : ['basic', 'connection']);

    // 能力（模型标签）动态下发：standType=MODEL_TAGS
    getDcSystemConfigListByStandType({ standType: 'MODEL_TAGS' })
      .then((res: any) => {
        const list: ModelTagItem[] = Array.isArray(res?.data) ? res.data : [];
        const opts = list
          .map((it) => {
            const label = `${it?.paramName ?? it?.standDisplayValue ?? ''}`.trim();
            const value = `${it?.paramValue ?? it?.standCode ?? ''}`.trim();
            if (!value) return null;
            return { label: label || value, value };
          })
          .filter(Boolean) as Array<{ label: string; value: string }>;
        setAbilityOptions(opts);
      })
      .catch(() => {
        // ignore
      });

    // 系统标签与列表页“系统”筛选同接口：getSourceSystemListByType
    getSourceSystemList({ types: SYSTEM_SOURCE_TYPES })
      .then((res: any) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        const opts = list
          .map((it: any) => {
            const value = `${it?.systemCode ?? ''}`.trim();
            const label = `${it?.systemName ?? ''}`.trim();
            if (!value) return null;
            return { label: label || value, value };
          })
          .filter(Boolean) as Array<{ label: string; value: string }>;
        setSystemOptions(opts);
      })
      .catch(() => {
        // ignore
      });
  }, [open]);

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
  } = useModelDebug({ intl, dispatch, open, currentModelType, getCurrentModelId });

  const applySavedModelId = useCallback((id?: string | number) => {
    savedNewIdRef.current = id;
    setSavedNewId(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTokenVisible(false);
    resetDebugState();
    // 每次打开弹窗先清空；会根据详情模板/自动生成策略再写入
    setDebugInputMode('auto');
    setDebugInput('');
    if (type !== 'add') {
      applySavedModelId(undefined);
    }
    if ((type === 'edit' || type === 'debug') && data?.id) {
      // 列表不返回明文 apiToken，编辑时必须先拉详情再回填
      dispatch({
        type: 'modelMgr/getModelDetail',
        payload: { id: data.id },
        success: (detail: any) => {
          const inparamTemplateStr =
            detail?.inparamTemplate === null || detail?.inparamTemplate === undefined
              ? ''
              : `${detail.inparamTemplate}`;
          const hasTemplate = !!inparamTemplateStr.trim();

          const nextFormValues = {
            displayName: detail.displayName,
            providerName: detail.providerName,
            modelCode: detail.modelCode,
            modelType: normalizeModelType(detail.modelType),
            apiEndpoint: detail.apiEndpoint || 'https://api.example.com/v1',
            apiToken: detail.apiToken || '',
            headers: Array.isArray(detail.headers) && detail.headers.length ? detail.headers : [{ key: '', value: '' }],
            connectTimeoutSec: detail.connectTimeoutSec ?? 32,
            readTimeoutSec: detail.readTimeoutSec ?? 60,
            maxRetries: detail.maxRetries ?? 3,
            retryIntervalSec: detail.retryIntervalSec ?? 1,
            contextTokens: detail.contextTokens ?? 128000,
            temperature: detail.temperature ?? 0.7,
            topP: detail.topP ?? 0.9,
            maxTokens: detail.maxTokens ?? 1024,
            frequencyPenalty: detail.frequencyPenalty ?? 0,
            presencePenalty: detail.presencePenalty ?? 0,
            abilities: detail.abilities || [],
            systems: detail.systems || [],
            status: detail.status || 'ENABLED',
          };

          // 右侧“模型调试-输入”规则：优先模板；否则使用左侧（除标签配置）字段自动生成 JSON，并随改动同步
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

          form.setFieldsValue(nextFormValues);
        },
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
      applySavedModelId(undefined);
    }
  }, [applySavedModelId, data, debugDefaults, form, open, resetDebugState, setDebugInput, setDebugInputMode, type]);

  const modalTitle = useMemo(() => {
    if (!type) return '';
    if (type === 'edit') return data?.displayName || intl.formatMessage({ id: 'modelMgr.modal.editTitle' });
    if (type === 'debug') return data?.displayName || intl.formatMessage({ id: 'modelMgr.modal.debugTitle' });
    if (type === 'add') return intl.formatMessage({ id: 'modelMgr.modal.addTitle' });
    return getTitle(type, '模型');
  }, [type, data, intl]);

  /** 构建提交 payload（新增时若有 savedNewId 则带 id 以便后续保存为更新） */
  const buildUpsertPayload = (values: any) => ({
    ...(type === 'edit' || type === 'debug'
      ? { id: data?.id }
      : type === 'add' && savedNewId !== null && savedNewId !== undefined
        ? { id: savedNewId }
        : {}),
    ...values,
    modelType: normalizeModelType(values?.modelType),
  });

  const querySavedModelId = (values: any) =>
    new Promise<string | number | undefined>((resolve) => {
      const keyword = `${values?.modelCode ?? values?.displayName ?? ''}`.trim() || undefined;
      dispatch({
        type: 'modelMgr/getModelListByPage',
        payload: {
          pageNum: 1,
          pageSize: 100,
          keyword,
        },
        success: (res: any) => {
          const rows = Array.isArray(res?.rows) ? res.rows : Array.isArray(res?.list) ? res.list : [];
          const matched = rows.find(
            (item: any) =>
              item?.modelCode === values?.modelCode ||
              (item?.displayName === values?.displayName && item?.providerName === values?.providerName)
          );
          resolve(matched?.id);
        },
        fail: () => resolve(undefined),
      });
    });

  const dispatchWithResult = useCallback(
    (actionType: string, payload: any, timeoutMs = 15000) =>
      new Promise<any>((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('dispatch timeout'));
        }, timeoutMs);

        const resolveOnce = (res: any) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(res);
        };

        const rejectOnce = (err: any) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(err);
        };

        try {
          dispatch({
            type: actionType,
            payload,
            success: resolveOnce,
            fail: rejectOnce,
          });
        } catch (err) {
          rejectOnce(err);
        }
      }),
    [dispatch]
  );

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
      const res = await dispatchWithResult('modelMgr/upsertModel', payload);

      if (mode === 'save_continue') {
        const id = extractModelId(res) ?? (await querySavedModelId(values));
        if (id !== null && id !== undefined) {
          applySavedModelId(id);
        }
        message.success(intl.formatMessage({ id: 'modelMgr.modal.saveSuccess' }));
        if (id === null || id === undefined) {
          message.warning(intl.formatMessage({ id: 'modelMgr.modal.saveWithoutId' }));
        }
        reload();
        return;
      }

      if (type === 'add') {
        applySavedModelId(extractModelId(res));
      }
      message.success(
        type === 'edit' || type === 'debug'
          ? intl.formatMessage({ id: 'modelMgr.modal.editSuccess' })
          : intl.formatMessage({ id: 'modelMgr.modal.createSuccess' })
      );
      onCancel();
      reload();
    } catch (error: any) {
      if (error?.errorFields) {
        message.error('请完善必填项后再保存');
        scrollToFirstError(error);
      } else {
        message.error(getErrorMessage(error));
      }
    } finally {
      setSubmitAction(null);
    }
  };

  const handleOk = async () => {
    await saveModel('save_close');
  };

  /** 仅保存不关弹窗（仅新增时使用），便于保存后继续调试 */
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
          intl={intl}
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
          isDebugOnly={isDebugOnly}
          isSectionOpen={isSectionOpen}
          toggleSection={toggleSection}
          onValuesChange={handleValuesChange}
        />

        <div className={styles.right}>
          <ModelDebugPanel
            intl={intl}
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

export default ModelFormModal;
