import { useEffect, useState } from 'react';
import { Alert, Button, Select, Space, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import type { EpubInfo } from './epubTypes';
import { prepareEpubChapter } from './epubHtml';
import styles from './BinaryPreview.module.less';

const errorId = (error: unknown) => {
  if (error instanceof BinaryPreviewError && error.code === 'timeout') return 'fileRender.binaryTimeout';
  if (error instanceof BinaryPreviewError && error.code === 'limit') return 'fileRender.epubLimit';
  return 'fileRender.epubFailed';
};

export default function Epub({ data, title }: { data?: string | Blob; title?: string }) {
  const intl = useIntl();
  const [session, setSession] = useState<{ client: PreviewWorkerClient; info: EpubInfo }>();
  const [chapter, setChapter] = useState(0);
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setSession(undefined);
    setChapter(0);
    setHtml(undefined);
    setError(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const info = await client.request('openEpub', { buffer }, [buffer]);
      if (active) setSession({ client, info });
    })().catch((reason) => {
      if (active) setError(errorId(reason));
      client?.dispose();
    });
    return () => {
      active = false;
      client?.dispose();
    };
  }, [data]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setHtml(undefined);
    setError(undefined);
    void (async () => {
      const source = await session.client.request('epubChapter', { chapter });
      if (!active) return;
      const prepared = prepareEpubChapter(source);
      const images = prepared.sources.length
        ? await session.client.request('epubImages', { chapter, sources: prepared.sources })
        : [];
      if (active) setHtml(prepared.render(images));
    })().catch((reason) => {
      if (active) setError(errorId(reason));
    });
    return () => {
      active = false;
    };
  }, [session, chapter]);
  const label = (id: string) => intl.formatMessage({ id: `fileRender.${id}` });
  return (
    <div className={styles.preview}>
      <Alert showIcon type="info" message={label('epubNotice')} />
      {session && (
        <Space wrap className={styles.toolbar}>
          <Select<number>
            aria-label={label('epubChapter')}
            value={chapter}
            style={{ minWidth: 180, maxWidth: '100%' }}
            options={session.info.chapters.map((item, index) => ({
              value: index,
              label: item.name || intl.formatMessage({ id: 'fileRender.epubChapterNumber' }, { number: index + 1 }),
            }))}
            onChange={setChapter}
          />
          <Button disabled={chapter === 0 || (!html && !error)} onClick={() => setChapter((value) => value - 1)}>
            {label('previous')}
          </Button>
          <Button
            disabled={chapter + 1 >= session.info.chapters.length || (!html && !error)}
            onClick={() => setChapter((value) => value + 1)}
          >
            {label('next')}
          </Button>
        </Space>
      )}
      {error ? <Alert showIcon type="warning" message={intl.formatMessage({ id: error })} /> : !html ? <Spin /> : null}
      {html && !error && (
        <div className={styles.file}>
          <iframe
            key={chapter}
            className={styles.html}
            title={session?.info.title || title || label('epubReader')}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={html}
          />
        </div>
      )}
    </div>
  );
}
