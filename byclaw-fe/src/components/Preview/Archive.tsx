import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Empty, Table, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import DOMPurify from 'dompurify';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES, type ArchiveEntry } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import { HTML_PREVIEW_TYPES, getPreviewMimeType, resolvePreviewType } from './formats';
import type { PreviewWorkerClient } from './previewWorkerClient';
import styles from './BinaryPreview.module.less';

const errorMessage = (error: unknown) => {
  if (error instanceof BinaryPreviewError && error.code === 'limit') return 'fileRender.archiveLimit';
  if (error instanceof BinaryPreviewError && error.code === 'timeout') return 'fileRender.binaryTimeout';
  return 'fileRender.archiveFailed';
};

function ArchiveHtml({ file, name }: { file: Blob; name: string }) {
  const [content, setContent] = useState('');
  const [failed, setFailed] = useState(false);
  const intl = useIntl();
  useEffect(() => {
    let active = true;
    setContent('');
    setFailed(false);
    void file
      .text()
      .then((source) => {
        // 压缩包 HTML 以静态文档预览，隔离脚本、导航和外部请求，不继承宿主页面的权限。
        const clean = DOMPurify.sanitize(source, {
          FORBID_TAGS: ['meta', 'base', 'iframe', 'object', 'embed'],
          FORBID_ATTR: ['href', 'action'],
        });
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:">`;
        if (active) setContent(csp + clean);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [file]);
  return failed ? (
    <Alert type="warning" message={intl.formatMessage({ id: 'fileRender.archiveFailed' })} />
  ) : (
    <iframe className={styles.html} title={name} sandbox="" referrerPolicy="no-referrer" srcDoc={content} />
  );
}

export default function Archive({
  data,
  renderFile,
}: {
  data?: string | Blob;
  renderFile: (file: Blob, name: string) => ReactNode;
}) {
  const intl = useIntl();
  const client = useRef<PreviewWorkerClient | undefined>(undefined);
  const revision = useRef(0);
  const [entries, setEntries] = useState<ArchiveEntry[]>();
  const [selected, setSelected] = useState<{ file: Blob; name: string }>();
  const [opening, setOpening] = useState(false);
  const [errorId, setErrorId] = useState<string>();
  const [page, setPage] = useState(1);

  useEffect(() => {
    const version = ++revision.current;
    setEntries(undefined);
    setSelected(undefined);
    setErrorId(undefined);
    setOpening(false);
    setPage(1);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (revision.current !== version) return;
      const worker = createPreviewWorker();
      client.current = worker;
      const files = await worker.request('openZip', { buffer }, [buffer]);
      if (revision.current === version) setEntries(files);
    })().catch((error) => {
      if (revision.current === version) {
        setErrorId(errorMessage(error));
        client.current?.dispose();
      }
    });
    return () => {
      revision.current++;
      client.current?.dispose();
      client.current = undefined;
    };
  }, [data]);

  const openFile = async (entry: ArchiveEntry) => {
    if (!client.current || !entry.previewable || opening) return;
    const version = revision.current;
    setOpening(true);
    setErrorId(undefined);
    try {
      const buffer = await client.current.request('zipEntry', { name: entry.name });
      if (revision.current === version) {
        setSelected({ name: entry.name, file: new Blob([buffer], { type: getPreviewMimeType(entry.name) }) });
      }
    } catch (error) {
      if (revision.current === version) setErrorId(errorMessage(error));
    } finally {
      if (revision.current === version) setOpening(false);
    }
  };

  const message = (key: string) => intl.formatMessage({ id: `fileRender.${key}` });
  return (
    <div className={styles.preview}>
      {selected ? (
        <>
          <div className={styles.toolbar}>
            <Button onClick={() => setSelected(undefined)}>{message('archiveBack')}</Button>
            <span className={styles.path}>{selected.name}</span>
          </div>
          <div className={styles.file}>
            {HTML_PREVIEW_TYPES.includes(resolvePreviewType(undefined, selected.name)) ? (
              <ArchiveHtml file={selected.file} name={selected.name} />
            ) : (
              renderFile(selected.file, selected.name)
            )}
          </div>
        </>
      ) : (
        <>
          <Alert type="info" showIcon message={message('archiveNotice')} />
          {errorId && <Alert type="warning" showIcon message={intl.formatMessage({ id: errorId })} />}
          {!entries ? (
            !errorId && <Spin />
          ) : entries.length ? (
            <div className={styles.list}>
              <Table<ArchiveEntry>
                size="small"
                rowKey="name"
                dataSource={entries}
                loading={opening}
                pagination={{ current: page, pageSize: 50, showSizeChanger: false, onChange: setPage }}
                columns={[
                  {
                    title: message('archivePath'),
                    dataIndex: 'name',
                    render: (name: string) => <span className={styles.path}>{name}</span>,
                  },
                  {
                    title: message('archiveAction'),
                    width: 130,
                    render: (_, entry) =>
                      entry.directory ? (
                        message('archiveFolder')
                      ) : entry.previewable ? (
                        <Button size="small" disabled={opening} onClick={() => void openFile(entry)}>
                          {intl.formatMessage({ id: 'common.preview' })}
                        </Button>
                      ) : (
                        message('archiveUnsupported')
                      ),
                  },
                ]}
              />
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </>
      )}
    </div>
  );
}
