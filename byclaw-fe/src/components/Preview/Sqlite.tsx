import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Segmented, Select, Space, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { BinaryPreviewError } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import {
  DATABASE_PAGE_SIZE,
  MAX_DATABASE_BYTES,
  MAX_DATABASE_ROWS,
  type DatabaseInfo,
  type DatabasePage,
} from './sqliteTypes';
import styles from './Delimited.module.less';

const errorId = (error: unknown) => {
  if (error instanceof BinaryPreviewError && error.code === 'timeout') return 'fileRender.binaryTimeout';
  if (error instanceof BinaryPreviewError && error.code === 'limit') return 'fileRender.databaseLimit';
  return 'fileRender.databaseFailed';
};

export default function Sqlite({ data }: { data?: string | Blob }) {
  const intl = useIntl();
  const [session, setSession] = useState<{ client: PreviewWorkerClient; info: DatabaseInfo }>();
  const [selected, setSelected] = useState(0);
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<'rows' | 'schema'>('rows');
  const [result, setResult] = useState<DatabasePage>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setSession(undefined);
    setSelected(0);
    setOffset(0);
    setMode('rows');
    setResult(undefined);
    setError(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_DATABASE_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const info = await client.request('openSqlite', { buffer }, [buffer]);
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
    if (!session || !session.info.tables[selected]) return;
    let active = true;
    setResult(undefined);
    setError(undefined);
    void session.client
      .request('sqlitePage', { table: selected, offset })
      .then((page) => {
        if (active) setResult(page);
      })
      .catch((reason) => {
        if (active) setError(errorId(reason));
      });
    return () => {
      active = false;
    };
  }, [session, selected, offset]);
  const label = (id: string) => intl.formatMessage({ id: `fileRender.${id}` });
  const table = session?.info.tables[selected];
  return (
    <div className={styles.preview}>
      <Alert showIcon type="info" message={label('databaseNotice')} />
      {table && (
        <Space wrap>
          <Select<number>
            aria-label={label('databaseTable')}
            style={{ minWidth: 180, maxWidth: '100%' }}
            value={selected}
            options={session?.info.tables.map((item, index) => ({ value: index, label: item.name }))}
            onChange={(index) => {
              setSelected(index);
              setOffset(0);
            }}
          />
          <Segmented
            value={mode}
            onChange={(value) => setMode(value as 'rows' | 'schema')}
            options={[
              { value: 'rows', label: label('databaseRows') },
              { value: 'schema', label: label('databaseSchema') },
            ]}
          />
        </Space>
      )}
      {(session?.info.skippedTables || table?.columnsLimited) && (
        <Alert type="info" showIcon message={label('databaseSkipped')} />
      )}
      {error && <Alert showIcon type="warning" message={intl.formatMessage({ id: error })} />}
      {!session && !error && <Spin />}
      {session && !table && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {table && mode === 'schema' && (
        <div className={styles.scroll}>
          <table className={styles.table} aria-label={label('databaseSchema')}>
            <thead>
              <tr>
                {['databaseColumn', 'databaseType', 'databasePrimaryKey', 'databaseNotNull'].map((id) => (
                  <th scope="col" key={id}>
                    {label(id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.columns.map((column) => (
                <tr key={column.name}>
                  <th scope="row">{column.name}</th>
                  <td>{column.type}</td>
                  <td>{column.primaryKey ? '✓' : '—'}</td>
                  <td>{column.notNull ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table &&
        mode === 'rows' &&
        !error &&
        (!result ? (
          <Spin />
        ) : (
          <>
            {result.rows.length ? (
              <div className={styles.scroll}>
                <table className={styles.table} aria-label={label('databaseRows')}>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      {table.columns.map((column) => (
                        <th scope="col" key={column.name}>
                          {column.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, index) => (
                      <tr key={offset + index}>
                        <th scope="row">{offset + index + 1}</th>
                        {row.map((cell, column) => (
                          <td key={column}>
                            {cell.kind === 'null' ? (
                              <em>NULL</em>
                            ) : cell.kind === 'blob' ? (
                              intl.formatMessage({ id: 'fileRender.databaseBlob' }, { bytes: cell.bytes })
                            ) : (
                              <>
                                {cell.text}
                                {cell.truncated && '…'}
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
            <Space>
              <Button disabled={offset === 0} onClick={() => setOffset((value) => value - DATABASE_PAGE_SIZE)}>
                {label('previous')}
              </Button>
              <span>
                {intl.formatMessage({ id: 'fileRender.databasePage' }, { number: offset / DATABASE_PAGE_SIZE + 1 })}
              </span>
              <Button
                disabled={!result.hasMore || offset + DATABASE_PAGE_SIZE >= MAX_DATABASE_ROWS}
                onClick={() => setOffset((value) => value + DATABASE_PAGE_SIZE)}
              >
                {label('next')}
              </Button>
            </Space>
            {result.hasMore && offset + DATABASE_PAGE_SIZE >= MAX_DATABASE_ROWS && (
              <Alert type="info" showIcon message={label('databaseRowsLimit')} />
            )}
          </>
        ))}
    </div>
  );
}
