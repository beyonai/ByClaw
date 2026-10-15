import { useEffect, useMemo, useState } from 'react';
import { Alert, Empty, Pagination } from 'antd';
import { useIntl } from '@umijs/max';
import { MAX_DELIMITED_COLUMNS, MAX_DELIMITED_ROWS, parseDelimited } from './parseDelimited';
import styles from './Delimited.module.less';

const PAGE_SIZE = 50;
const MAX_TEXT_SIZE = 2 * 1024 * 1024;

export default function Delimited({ content, type }: { content: string; type: 'csv' | 'tsv' }) {
  const intl = useIntl();
  const [page, setPage] = useState(1);
  const result = useMemo(() => {
    if (new Blob([content]).size > MAX_TEXT_SIZE) return null;
    return parseDelimited(content, type === 'tsv' ? '\t' : ',');
  }, [content, type]);

  useEffect(() => setPage(1), [content, type]);

  if (!result || result.malformed) {
    return (
      <Alert
        type="warning"
        showIcon
        message={intl.formatMessage({ id: result ? 'fileRender.delimitedMalformed' : 'fileRender.delimitedTooLarge' })}
      />
    );
  }
  if (!result.rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const start = (page - 1) * PAGE_SIZE;
  return (
    <div className={styles.preview}>
      {result.truncated && (
        <Alert
          type="info"
          showIcon
          message={intl.formatMessage(
            { id: 'fileRender.delimitedTruncated' },
            { rows: MAX_DELIMITED_ROWS, columns: MAX_DELIMITED_COLUMNS }
          )}
        />
      )}
      <div className={styles.scroll}>
        <table className={styles.table} aria-label={intl.formatMessage({ id: 'fileRender.delimitedTable' })}>
          <thead>
            <tr>
              <th scope="col">#</th>
              {Array.from({ length: result.columnCount }, (_, column) => (
                <th scope="col" key={column}>
                  {intl.formatMessage({ id: 'fileRender.delimitedColumn' }, { number: column + 1 })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.slice(start, start + PAGE_SIZE).map((row, index) => (
              <tr key={start + index}>
                <th scope="row">{start + index + 1}</th>
                {Array.from({ length: result.columnCount }, (_, column) => (
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
        total={result.rows.length}
        onChange={setPage}
        showSizeChanger={false}
        hideOnSinglePage
        size="small"
      />
    </div>
  );
}
