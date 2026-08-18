import { getSourceSystemList } from '@/pages/manager/service/OrgMgr';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import React, { useCallback, useMemo } from 'react';
import { useDispatch, useIntl } from '@umijs/max';
import type { ModalStore } from '@/pages/manager/hooks/useShowModal';
import SharedModelFormModal from './SharedModelFormModal';
import {
  dispatchModelActionWithResult,
  extractModelId,
  getModelDebugDispatchTimeoutMs,
  normalizeModelType,
  SYSTEM_SOURCE_TYPES,
  type ModelTagItem,
} from './modelFormUtils';

type Props = ModalStore<any> & {
  onCancel: () => void;
  reload: () => void;
};

const ModelFormModal: React.FC<Props> = ({ onCancel, reload, ...props }) => {
  const dispatch = useDispatch();
  const intl = useIntl();

  const statusOptions = useMemo(
    () => [
      { label: intl.formatMessage({ id: 'modelMgr.statusEnabled' }), value: 'ENABLED' },
      { label: intl.formatMessage({ id: 'modelMgr.statusDisabled' }), value: 'DISABLED' },
      { label: intl.formatMessage({ id: 'modelMgr.statusTesting' }), value: 'TESTING' },
    ],
    [intl]
  );

  const dispatchWithResult = useCallback(
    (actionType: string, payload: any, timeoutMs = 15000) =>
      dispatchModelActionWithResult(dispatch, actionType, payload, timeoutMs),
    [dispatch]
  );

  const loadDetail = useCallback(
    (id: string | number) => dispatchWithResult('modelMgr/getModelDetail', { id }),
    [dispatchWithResult]
  );

  const saveModelRequest = useCallback(
    (payload: any) => dispatchWithResult('modelMgr/upsertModel', payload),
    [dispatchWithResult]
  );

  const querySavedModelId = useCallback(
    (values: any) =>
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
      }),
    [dispatch]
  );

  const loadAbilityOptions = useCallback(
    () =>
      getDcSystemConfigListByStandType({ standType: 'MODEL_TAGS' }).then((res: any) => {
        const list: ModelTagItem[] = Array.isArray(res?.data) ? res.data : [];
        return list
          .map((item) => {
            const label = `${item?.paramName ?? item?.standDisplayValue ?? ''}`.trim();
            const value = `${item?.paramValue ?? item?.standCode ?? ''}`.trim();
            if (!value) return null;
            return { label: label || value, value };
          })
          .filter(Boolean) as Array<{ label: string; value: string }>;
      }),
    []
  );

  const loadSystemOptions = useCallback(
    () =>
      getSourceSystemList({ types: SYSTEM_SOURCE_TYPES }).then((res: any) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        return list
          .map((item: any) => {
            const value = `${item?.systemCode ?? ''}`.trim();
            const label = `${item?.systemName ?? ''}`.trim();
            if (!value) return null;
            return { label: label || value, value };
          })
          .filter(Boolean) as Array<{ label: string; value: string }>;
      }),
    []
  );

  const runDebugRequest = useCallback(
    ({ modelId, input, modelType, signal, onDelta }: any) => {
      const currentType = normalizeModelType(modelType);
      let effectType = 'modelMgr/debugModel';
      if (currentType === 'RERANK') effectType = 'modelMgr/debugModelRerank';
      if (currentType === 'EMBEDDING') effectType = 'modelMgr/debugModelEmbedding';
      if (currentType === 'IMAGE_GENERATION') effectType = 'modelMgr/debugModelImageGeneration';

      return dispatchWithResult(
        effectType,
        {
          id: `${modelId}`,
          input: `${input}`,
          signal,
          onDelta,
        },
        getModelDebugDispatchTimeoutMs(currentType)
      );
    },
    [dispatchWithResult]
  );

  return (
    <SharedModelFormModal
      {...props}
      onCancel={onCancel}
      onSaved={reload}
      loadDetail={loadDetail}
      saveModelRequest={saveModelRequest}
      runDebugRequest={runDebugRequest}
      statusOptions={statusOptions}
      showTags
      loadAbilityOptions={loadAbilityOptions}
      loadSystemOptions={loadSystemOptions}
      extractModelIdFromSave={extractModelId}
      querySavedModelId={querySavedModelId}
    />
  );
};

export default ModelFormModal;
