import React, { useCallback, useMemo } from 'react';
import { useIntl } from '@umijs/max';
import type { ModalStore } from '@/pages/manager/hooks/useShowModal';
import SharedModelFormModal from '@/pages/manager/pages/ModelMgr/components/SharedModelFormModal';
import { getMyModelDetail, upsertMyModel } from '../service';

type Props = ModalStore<any> & {
  onCancel: () => void;
  onSaved: () => void;
};

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
      showTags={false}
      allowRerankTable={false}
      formatDebugError={formatDebugError}
      extractModelIdFromSave={extractModelIdFromSave}
    />
  );
};

export default ModelFormModal;
