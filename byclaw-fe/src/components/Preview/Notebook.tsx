import { useEffect, useState } from 'react';
import { Alert, Empty, Pagination, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import type { NotebookContent } from './notebookTypes';
import styles from './StructuredPreview.module.less';

const PAGE_SIZE = 10;
export default function Notebook({ data }: { data?: string | Blob }) {
  const intl = useIntl();
  const [notebook, setNotebook] = useState<NotebookContent>();
  const [page, setPage] = useState(1);
  const [errorId, setErrorId] = useState<string>();
  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setNotebook(undefined);
    setPage(1);
    setErrorId(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const result = await client.request('readNotebook', { buffer }, [buffer]);
      if (active) setNotebook(result);
    })()
      .catch((error) => {
        if (!active) return;
        if (error instanceof BinaryPreviewError && error.code === 'timeout') {
          setErrorId('fileRender.binaryTimeout');
        } else if (error instanceof BinaryPreviewError && error.code === 'limit') {
          setErrorId('fileRender.notebookLimit');
        } else {
          setErrorId('fileRender.notebookFailed');
        }
      })
      .finally(() => client?.dispose());
    return () => {
      active = false;
      client?.dispose();
    };
  }, [data]);
  const label = (key: string) => intl.formatMessage({ id: `fileRender.${key}` });
  const start = (page - 1) * PAGE_SIZE;
  return (
    <div className={styles.preview}>
      <Alert showIcon type="info" message={label('notebookNotice')} />
      {notebook?.omitted && <Alert showIcon type="warning" message={label('notebookOmitted')} />}
      {errorId && <Alert showIcon type="warning" message={intl.formatMessage({ id: errorId })} />}
      {!notebook && !errorId && <Spin />}
      {notebook && !notebook.cells.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {notebook?.cells.slice(start, start + PAGE_SIZE).map((cell, index) => (
        <article className={styles.cell} key={start + index}>
          <strong>
            {label(`notebookCell.${cell.type}`)} · {start + index + 1}
            {cell.executionCount !== undefined ? ` [${cell.executionCount}]` : ''}
          </strong>
          {/* Markdown 保留排版但不加载附件/远程图片或 HTML；所有源代码都作为文本显示。 */}
          {cell.type === 'markdown' ? (
            <Markdown
              skipHtml
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children }) => <span>{children}</span>,
                img: ({ alt }) => <span>{alt || label('notebookImageOmitted')}</span>,
              }}
            >
              {cell.source}
            </Markdown>
          ) : (
            <pre>
              <code>{cell.source}</code>
            </pre>
          )}
          {cell.outputs.map((output, outputIndex) => (
            <div key={outputIndex} className={styles.output}>
              {output.image ? (
                <img src={output.image} alt={label('notebookOutput')} loading="lazy" />
              ) : (
                <pre>{output.text}</pre>
              )}
            </div>
          ))}
        </article>
      ))}
      {notebook && (
        <Pagination
          current={page}
          pageSize={PAGE_SIZE}
          total={notebook.cells.length}
          onChange={setPage}
          showSizeChanger={false}
          hideOnSinglePage
          size="small"
        />
      )}
    </div>
  );
}
