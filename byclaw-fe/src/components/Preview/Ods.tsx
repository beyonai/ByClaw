import { useEffect, useState } from 'react';
import { Alert, Empty, Pagination, Select, Space, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import { MAX_ODS_COLUMNS, MAX_ODS_ROWS, type OdsSheet } from './odsTypes';
import styles from './Delimited.module.less';

const PAGE_SIZE = 50;
export function odsColumnName(index: number): string {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

export default function Ods({ data }: { data?: string | Blob }) {
  const intl = useIntl();
  const [sheets, setSheets] = useState<OdsSheet[]>();
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState(1);
  const [errorId, setErrorId] = useState<string>();
  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setSheets(undefined);
    setSelected(0);
    setPage(1);
    setErrorId(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const result = await client.request('readOds', { buffer }, [buffer]);
      if (active) setSheets(result);
    })()
      .catch((error) => {
        if (!active) return;
        if (error instanceof BinaryPreviewError && error.code === 'limit') {
          setErrorId('fileRender.odsLimit');
        } else if (error instanceof BinaryPreviewError && error.code === 'timeout') {
          setErrorId('fileRender.binaryTimeout');
        } else {
          setErrorId('fileRender.odsFailed');
        }
      })
      .finally(() => client?.dispose());
    return () => {
      active = false;
      client?.dispose();
    };
  }, [data]);

  const label = (id: string) => intl.formatMessage({ id: `fileRender.${id}` });
  const sheet = sheets?.[selected];
  const start = (page - 1) * PAGE_SIZE;
  return (
    <div className={styles.preview}>
      <Alert showIcon type="info" message={label('odsNotice')} />
      {errorId ? (
        <Alert showIcon type="warning" message={intl.formatMessage({ id: errorId })} />
      ) : !sheets ? (
        <Spin />
      ) : null}
      {!!sheets?.length && (
        <Space wrap>
          <span>{label('odsWorksheet')}</span>
          <Select<number>
            aria-label={label('odsWorksheet')}
            style={{ minWidth: 180, maxWidth: '100%' }}
            value={selected}
            options={sheets.map((item, index) => ({
              value: index,
              label: item.name || intl.formatMessage({ id: 'fileRender.odsUnnamedSheet' }, { number: index + 1 }),
            }))}
            onChange={(index) => {
              setSelected(index);
              setPage(1);
            }}
          />
        </Space>
      )}
      {sheet?.truncated && (
        <Alert
          showIcon
          type="info"
          message={intl.formatMessage(
            { id: 'fileRender.odsTruncated' },
            { rows: MAX_ODS_ROWS, columns: MAX_ODS_COLUMNS }
          )}
        />
      )}
      {sheets && !sheet?.rows.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : sheet ? (
        <>
          <div className={styles.scroll}>
            <table className={styles.table} aria-label={label('odsTable')}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {Array.from({ length: sheet.columnCount }, (_, column) => (
                    <th scope="col" key={column}>
                      {odsColumnName(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(start, start + PAGE_SIZE).map((row, index) => (
                  <tr key={start + index}>
                    <th scope="row">{start + index + 1}</th>
                    {Array.from({ length: sheet.columnCount }, (_, column) => (
                      <td key={column}>{row[column] || ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={sheet.rows.length}
            onChange={setPage}
            showSizeChanger={false}
            hideOnSinglePage
            size="small"
          />
        </>
      ) : null}
    </div>
  );
}
