import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import Sqlite from './Sqlite';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError } from './binaryPreview';
import { MAX_DATABASE_BYTES } from './sqliteTypes';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
const blob = () => {
  const file = new Blob(['sqlite']);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(100) });
  return file;
};
const info = {
  tables: [
    {
      name: 'users',
      columnsLimited: false,
      columns: [{ name: 'name', type: 'TEXT', primaryKey: true, notNull: true }],
    },
  ],
  skippedTables: false,
};
describe('SQLite preview', () => {
  let worker: { request: jest.Mock; dispose: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    worker = {
      request: jest.fn(async (operation, input) => {
        if (operation === 'openSqlite') return info;
        return {
          rows: [
            [{ kind: 'value', text: input.offset ? 'second page' : '<script>text only</script>', truncated: false }],
          ],
          hasMore: !input.offset,
        };
      }),
      dispose: jest.fn(),
    };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
  });
  it('renders cells as text, paginates, switches to schema and disposes on close', async () => {
    const { container, unmount } = render(<Sqlite data={blob()} />);
    expect(await screen.findByText('<script>text only</script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'fileRender.next' }));
    await screen.findByText('second page');
    expect(worker.request).toHaveBeenLastCalledWith('sqlitePage', { table: 0, offset: 50 });
    expect(screen.getByRole('button', { name: 'fileRender.next' })).toBeDisabled();
    fireEvent.click(screen.getByText('fileRender.databaseSchema'));
    expect(screen.getByRole('table', { name: 'fileRender.databaseSchema' })).toHaveTextContent('TEXT');
    unmount();
    expect(worker.dispose).toHaveBeenCalled();
  });
  it('clears old results when a different database opens', async () => {
    let resolve!: (value: unknown) => void;
    worker.request.mockImplementation(async (operation) => {
      if (operation === 'openSqlite') return info;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const { rerender } = render(<Sqlite data={blob()} />);
    await waitFor(() => expect(worker.request).toHaveBeenCalledWith('sqlitePage', { table: 0, offset: 0 }));
    const old = worker;
    worker = { request: jest.fn(async () => ({ tables: [], skippedTables: false })), dispose: jest.fn() };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
    rerender(<Sqlite data={blob()} />);
    await act(async () => resolve({ rows: [[{ kind: 'value', text: 'stale', truncated: false }]], hasMore: false }));
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(old.dispose).toHaveBeenCalled();
  });
  it('returns to page one when selecting another table', async () => {
    worker.request.mockImplementation(async (operation, input) => {
      if (operation === 'openSqlite')
        return { ...info, tables: [...info.tables, { ...info.tables[0], name: 'orders' }] };
      return {
        rows: [[{ kind: 'value', text: `table-${input.table}-offset-${input.offset}`, truncated: false }]],
        hasMore: true,
      };
    });
    render(
      <ConfigProvider virtual={false} theme={{ token: { motion: false } }}>
        <Sqlite data={blob()} />
      </ConfigProvider>
    );
    await screen.findByText('table-0-offset-0');
    fireEvent.click(screen.getByRole('button', { name: 'fileRender.next' }));
    await screen.findByText('table-0-offset-50');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'fileRender.databaseTable' }));
    fireEvent.click(await screen.findByText('orders'));
    await screen.findByText('table-1-offset-0');
    expect(worker.request).toHaveBeenLastCalledWith('sqlitePage', { table: 1, offset: 0 });
    expect(screen.getByRole('button', { name: 'fileRender.previous' })).toBeDisabled();
  });
  it.each([
    ['invalid', 'databaseFailed'],
    ['timeout', 'binaryTimeout'],
  ] as const)('shows %s failures', async (code, key) => {
    worker.request.mockRejectedValue(new BinaryPreviewError(code));
    render(<Sqlite data={blob()} />);
    await screen.findByText(`fileRender.${key}`);
    expect(worker.dispose).toHaveBeenCalled();
  });
  it('rejects oversized input before loading SQLite', async () => {
    const file = blob();
    Object.defineProperty(file, 'size', { value: MAX_DATABASE_BYTES + 1 });
    render(<Sqlite data={file} />);
    await screen.findByText('fileRender.databaseLimit');
    expect(createPreviewWorker).not.toHaveBeenCalled();
  });
});
