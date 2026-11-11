import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import { abortStoredUpload, listStoredUploads, type StoredUpload } from '@/service/resumableFileUpload';

/** Recovery exposes browser identities and the authenticated owner's private-workspace inventory. */
export default function UnfinishedUploads({
  ownerKey,
  resourceId,
  disabled = false,
  onCancelQueued,
}: {
  ownerKey: string;
  resourceId?: string;
  disabled?: boolean;
  onCancelQueued?: (message: string) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id: `fileBrowser.upload.${id}` });
  const [open, setOpen] = useState(false);
  const [openedOwner, setOpenedOwner] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StoredUpload[]>([]);
  const [error, setError] = useState('');
  const [availableContext, setAvailableContext] = useState('');
  const contextKey = `${ownerKey}:${resourceId || ''}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scope = useRef(contextKey);
  const revision = useRef(0);
  if (scope.current !== contextKey) {
    scope.current = contextKey;
    revision.current += 1;
  }
  const guard = (context: string) => {
    const epoch = revision.current;
    return () => {
      if (!mounted.current || scope.current !== context || revision.current !== epoch)
        throw new Error('Upload context changed');
    };
  };
  useEffect(() => {
    let active = true;
    setAvailableContext('');
    if (ownerKey && !disabled) {
      const check = guard(contextKey);
      void listStoredUploads(ownerKey, resourceId, check)
        .then((next) => {
          if (
            active &&
            scope.current === contextKey &&
            next.some((row) => ['UPLOADING', 'COMMITTING'].includes(row.state))
          ) {
            setAvailableContext(contextKey);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [ownerKey, resourceId, contextKey, disabled]);

  const load = async () => {
    const owner = ownerKey;
    const context = contextKey;
    setLoading(true);
    setError('');
    try {
      const next = await listStoredUploads(owner, resourceId, guard(context));
      if (mounted.current && scope.current === context) {
        const unfinished = next.filter((row) => ['UPLOADING', 'COMMITTING'].includes(row.state));
        setRows(unfinished);
        setAvailableContext(unfinished.length ? context : '');
      }
    } catch (failure: any) {
      if (mounted.current && scope.current === context) setError(failure?.message || String(failure));
    } finally {
      if (mounted.current && scope.current === context) setLoading(false);
    }
  };
  const cancel = async (row: StoredUpload) => {
    if (disabled || loading || row.ownerKey !== ownerKey) return;
    setLoading(true);
    setError('');
    try {
      await abortStoredUpload(ownerKey, row, guard(contextKey));
      if (mounted.current && scope.current === contextKey) {
        const remaining = rows.filter((item) => item.storageKey !== row.storageKey);
        setRows(remaining);
        setAvailableContext(remaining.length ? contextKey : '');
      }
    } catch (failure: any) {
      if (mounted.current && scope.current === contextKey) setError(failure?.message || String(failure));
    } finally {
      if (mounted.current && scope.current === contextKey) setLoading(false);
    }
  };
  return (
    <>
      {disabled && onCancelQueued && (
        <Button size="small" onClick={() => onCancelQueued(t('queuedCancelled'))}>
          {t('cancelQueued')}
        </Button>
      )}
      {availableContext === contextKey && (
        <Button
          size="small"
          disabled={disabled || !ownerKey}
          onClick={() => {
            setRows([]);
            setOpenedOwner(contextKey);
            setOpen(true);
            void load();
          }}
        >
          {t('manageUnfinished')}
        </Button>
      )}
      <Modal
        title={t('manageUnfinished')}
        open={open && openedOwner === contextKey}
        footer={null}
        onCancel={() => setOpen(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t('storedSessionHint')} />
          {error && <Alert type="error" message={error} />}
          <Button loading={loading} disabled={disabled} onClick={() => void load()}>
            {t('refreshSessions')}
          </Button>
          {!loading && !rows.length && <Typography.Text>{t('noStoredSessions')}</Typography.Text>}
          {rows.map((row) => (
            <div key={row.storageKey} role="group" aria-label={row.fileName}>
              <Typography.Text strong>{row.fileName}</Typography.Text>
              <div>
                <Typography.Text type="secondary">
                  {row.path} · {(row.totalSize / 1048576).toFixed(1)} MiB · {t(`session.${row.state}`)}
                </Typography.Text>
              </div>
              <Button danger size="small" loading={loading} disabled={disabled} onClick={() => void cancel(row)}>
                {t('abortSession')}
              </Button>
            </div>
          ))}
        </Space>
      </Modal>
    </>
  );
}
