import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Segmented, Spin, Table } from 'antd';
import { useIntl } from '@umijs/max';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import type { EmlContent, EmlAttachment } from './emlTypes';
import { prepareEmlHtml } from './emlHtml';
import styles from './Eml.module.less';

const Rtf = lazy(() => import('./Rtf'));

export default function Eml({ data, type = 'eml' }: { data?: string | Blob; type?: 'eml' | 'msg' }) {
  const intl = useIntl();
  const [email, setEmail] = useState<EmlContent>();
  const [mode, setMode] = useState('html');
  const [errorId, setErrorId] = useState<string>();
  const downloadUrls = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setEmail(undefined);
    setMode('html');
    setErrorId(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const result = await client.request(type === 'msg' ? 'readMsg' : 'readEml', { buffer }, [buffer]);
      if (active) {
        setEmail(result);
        setMode(result.html ? 'html' : 'text');
      }
    })()
      .catch((error) => {
        if (!active) return;
        if (error instanceof BinaryPreviewError && error.code === 'limit') setErrorId('fileRender.emlLimit');
        else if (error instanceof BinaryPreviewError && error.code === 'timeout')
          setErrorId('fileRender.binaryTimeout');
        else setErrorId(type === 'msg' ? 'fileRender.msgFailed' : 'fileRender.emlFailed');
      })
      .finally(() => client?.dispose());
    return () => {
      active = false;
      client?.dispose();
      downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
      downloadUrls.current.clear();
    };
  }, [data, type]);
  const html = useMemo(() => (email?.html ? prepareEmlHtml(email.html, email.attachments) : ''), [email]);
  const rtf = useMemo(() => (email?.rtf ? new Blob([email.rtf], { type: 'application/rtf' }) : undefined), [email]);
  const label = (key: string) => intl.formatMessage({ id: `fileRender.${key}` });
  const name = (attachment: EmlAttachment) =>
    attachment.name || intl.formatMessage({ id: 'fileRender.emlUnnamedAttachment' }, { number: attachment.id + 1 });
  const download = (attachment: EmlAttachment) => {
    if (attachment.unavailable) return;
    const url = URL.createObjectURL(
      new Blob([attachment.buffer], { type: attachment.mime || 'application/octet-stream' })
    );
    downloadUrls.current.add(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = name(attachment);
    link.click();
    // 给浏览器启动下载的时间；切换文件时也会主动回收未到期的 URL。
    setTimeout(() => {
      if (downloadUrls.current.delete(url)) URL.revokeObjectURL(url);
    }, 1000);
  };
  return (
    <div className={styles.preview}>
      <Alert showIcon type="info" message={label('emlNotice')} />
      {errorId && <Alert showIcon type="warning" message={intl.formatMessage({ id: errorId })} />}
      {!email && !errorId && <Spin />}
      {email && (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={label('emlSubject')}>{email.subject || label('emlNoSubject')}</Descriptions.Item>
            <Descriptions.Item label={label('emlFrom')}>{email.from || '—'}</Descriptions.Item>
            <Descriptions.Item label={label('emlTo')}>{email.to || '—'}</Descriptions.Item>
            {!!email.cc && <Descriptions.Item label={label('emlCc')}>{email.cc}</Descriptions.Item>}
            <Descriptions.Item label={label('emlDate')}>{email.date || '—'}</Descriptions.Item>
          </Descriptions>
          {!!email.html && !!email.text && (
            <Segmented
              value={mode}
              onChange={(value) => setMode(String(value))}
              options={[
                { value: 'html', label: label('emlHtml') },
                { value: 'text', label: label('emlText') },
              ]}
            />
          )}
          {email.bodyUnavailable && <Alert showIcon type="warning" message={label('msgRtfBody')} />}
          {mode === 'html' && html ? (
            <iframe
              className={styles.body}
              title={label('emlBody')}
              srcDoc={html}
              sandbox=""
              referrerPolicy="no-referrer"
            />
          ) : email.text ? (
            <pre className={styles.text}>{email.text}</pre>
          ) : rtf ? (
            <div className={styles.rtfBody}>
              <Suspense fallback={<Spin />}>
                <Rtf data={rtf} title={label('emlBody')} />
              </Suspense>
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={label('emlEmptyBody')} />
          )}
          {!!email.attachments.length && (
            <Table<EmlAttachment>
              rowKey="id"
              size="small"
              dataSource={email.attachments}
              pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
              columns={[
                { title: label('emlAttachments'), render: (_, attachment) => name(attachment) },
                {
                  title: label('emlSize'),
                  width: 100,
                  render: (_, attachment) =>
                    attachment.unavailable ? '—' : `${(attachment.buffer.byteLength / 1024).toFixed(1)} KiB`,
                },
                {
                  title: label('archiveAction'),
                  width: 90,
                  render: (_, attachment) =>
                    attachment.unavailable ? (
                      label('msgLinkedAttachment')
                    ) : (
                      <Button size="small" onClick={() => download(attachment)}>
                        {intl.formatMessage({ id: 'common.download' })}
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
