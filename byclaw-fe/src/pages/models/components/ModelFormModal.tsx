import React, { useCallback, useMemo } from 'react';
import { useIntl } from '@umijs/max';
import type { ModalStore } from '@/pages/manager/hooks/useShowModal';
import { getSourceSystemList } from '@/pages/manager/service/OrgMgr';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import SharedModelFormModal from '@/pages/manager/pages/ModelMgr/components/SharedModelFormModal';
import { SYSTEM_SOURCE_TYPES } from '@/pages/manager/pages/ModelMgr/components/modelFormUtils';
import { getMyModelDetail, upsertMyModel } from '../service';

type Props = ModalStore<any> & {
  onCancel: () => void;
  onSaved: () => void;
};

type Option = { label: string; value: string };

const mapAbilityOptions = (items: any[] = []): Option[] =>
  items
    .map((item) => {
      const label = `${item?.paramName ?? item?.param_name ?? item?.standDisplayValue ?? ''}`.trim();
      const value = `${item?.paramValue ?? item?.param_value ?? item?.standCode ?? ''}`.trim();
      if (!value) return null;
      return { label: label || value, value };
    })
    .filter(Boolean) as Option[];

const mapSystemOptions = (items: any[] = []): Option[] =>
  items
    .map((item) => {
      const value = `${item?.systemCode ?? ''}`.trim();
      const label = `${item?.systemName ?? ''}`.trim();
      if (!value) return null;
      return { label: label || value, value };
    })
    .filter(Boolean) as Option[];

const ModelFormModal: React.FC<Props> = ({ onCancel, onSaved, ...props }) => {
  const intl = useIntl();

  const statusOptions = useMemo(
    () => [
      { label: intl.formatMessage({ id: 'modelMgr.statusEnabled' }), value: 'ENABLED' },
      { label: intl.formatMessage({ id: 'modelMgr.statusDisabled' }), value: 'DISABLED' },
    ],
    [intl]
  );

  const loadDetail = useCallback((id: string | number) => getMyModelDetail({ id }).then((res: any) => res?.data), []);

  const saveModelRequest = useCallback(
    async (payload: any) => {
      const res = await upsertMyModel(payload);
      if (res?.code !== 0 && !res?.data) {
        throw new Error(res?.msg || intl.formatMessage({ id: 'common.saveFail' }));
      }
      return res;
    },
    [intl]
  );

  const runDebugRequest = useCallback(async ({ modelId, input, signal, onDelta }: any) => {
    const response = await fetch('/byaiService/personal/model/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: `${modelId}`, input }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No reader');
    }

    const decoder = new TextDecoder();
    let content = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      content += chunk;
      onDelta?.(chunk);
    }

    return { output: content };
  }, []);

  const extractModelIdFromSave = useCallback((res: any) => res?.data?.id ?? res?.data, []);
  // 资源中心与模型管理共用能力字典，并兼容不同版本的字典字段。
  const loadAbilityOptions = useCallback(
    () =>
      getDcSystemConfigListByStandType({ standType: 'MODEL_TAGS' }).then((res: any) =>
        mapAbilityOptions(Array.isArray(res?.data) ? res.data : [])
      ),
    []
  );
  const loadSystemOptions = useCallback(
    () =>
      getSourceSystemList({ types: SYSTEM_SOURCE_TYPES }).then((res: any) =>
        mapSystemOptions(Array.isArray(res?.data) ? res.data : [])
      ),
    []
  );
  const formatDebugError = useCallback((error: any) => {
    if (error?.name === 'AbortError') {
      return undefined;
    }
    return `[Error] ${error?.message || 'Request failed'}`;
  }, []);

  return (
    <SharedModelFormModal
      {...props}
      onCancel={onCancel}
      onSaved={onSaved}
      loadDetail={loadDetail}
      saveModelRequest={saveModelRequest}
      runDebugRequest={runDebugRequest}
      statusOptions={statusOptions}
      showTags
      loadAbilityOptions={loadAbilityOptions}
      loadSystemOptions={loadSystemOptions}
      allowRerankTable={false}
      formatDebugError={formatDebugError}
      extractModelIdFromSave={extractModelIdFromSave}
    />
  );
};

export default ModelFormModal;
