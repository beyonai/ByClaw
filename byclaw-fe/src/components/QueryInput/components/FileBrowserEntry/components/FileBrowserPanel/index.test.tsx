import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import FileBrowserPanel from '.';
import { getDefaultPath, listFiles } from '@/service/fileBrowser';

const mockEmit = jest.fn();
let mockEventEmitter: { emit: jest.Mock } | undefined = { emit: mockEmit };

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEventEmitter }),
}));

jest.mock('@/components/Preview/Twins', () => ({
  PreViewFile: ({ title }: { title: string }) => <div>local-preview:{title}</div>,
}));

jest.mock('@/service/fileBrowser', () => ({
  getDefaultPath: jest.fn(),
  listFiles: jest.fn(),
  uploadFiles: jest.fn(),
  downloadFile: jest.fn(),
  downloadFolder: jest.fn(),
  deleteFiles: jest.fn(),
  renameFile: jest.fn(),
  moveFiles: jest.fn(),
  createFolder: jest.fn(),
  searchFiles: jest.fn(),
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: { type: string }) => <span data-testid={type} />,
}));

jest.mock('@/components/KnowledgeBreadcrumb', () => ({
  __esModule: true,
  default: ({ folderPath }: { folderPath: Array<{ id: string; title: string }> }) => (
    <div>{folderPath.map((item) => item.title).join(' / ')}</div>
  ),
}));

jest.mock('@/components/ButtonsWithMore', () => ({
  __esModule: true,
  default: ({ actions, handleAction }: { actions: Array<any>; handleAction: (key: string) => void }) => (
    <div>
      {actions.map((action) => (
        <button key={action.key} type="button" onClick={() => handleAction(action.key)}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('@/components/InfiniteScrollTable', () => ({
  __esModule: true,
  default: ({ dataSource, columns }: { dataSource: Array<any>; columns: Array<any> }) => (
    <div>
      {dataSource.map((record) => (
        <div key={record.path}>
          {columns.map((column, index) => (
            <div key={column.dataIndex || index}>
              {column.render ? column.render(record[column.dataIndex], record) : record[column.dataIndex]}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

jest.mock('./RenameModal', () => () => null);
jest.mock('./MoveModal', () => () => null);

describe('FileBrowserPanel custom read-only providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = { emit: mockEmit };
  });

  it('uses the recycle providers and keeps search and download actions hidden', async () => {
    const listProvider = jest.fn().mockResolvedValue({
      data: [{ name: 'preview.txt', path: '/preview.txt', isDir: false, size: 7 }],
    });
    const downloadProvider = jest.fn().mockResolvedValue(new Blob(['preview']));

    render(
      <FileBrowserPanel
        resourceId="recycle-7-11"
        mode="preview"
        initialPath="/"
        listProvider={listProvider}
        downloadProvider={downloadProvider}
        showSearch={false}
        showDownloadAction={false}
      />
    );

    await waitFor(() => expect(listProvider).toHaveBeenCalledWith('/'));
    expect(getDefaultPath).not.toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('fileBrowser.toolbar.search')).toBeNull();
    expect(screen.queryByText('fileBrowser.action.download')).toBeNull();

    fireEvent.click(screen.getByText('preview.txt'));

    await waitFor(() => expect(downloadProvider).toHaveBeenCalledWith('/preview.txt'));
    expect(mockEmit).toHaveBeenCalledWith(
      'beyond-main-driver-open-type',
      expect.objectContaining({ title: 'preview.txt', drawerType: 'preview' })
    );
    expect(mockEmit).toHaveBeenCalledWith(
      'beyond-main-driver-message',
      expect.objectContaining({ title: 'preview.txt', type: 'txt' })
    );
  });

  it('navigates folders through the custom list provider', async () => {
    const listProvider = jest.fn((path: string) =>
      Promise.resolve({ data: path === '/' ? [{ name: 'docs', path: '/docs/', isDir: true }] : [] })
    );

    render(
      <FileBrowserPanel
        resourceId="recycle-7-11"
        mode="preview"
        initialPath="/"
        listProvider={listProvider}
        downloadProvider={jest.fn()}
        showSearch={false}
        showDownloadAction={false}
      />
    );

    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());
    fireEvent.click(screen.getByText('docs'));

    await waitFor(() => expect(listProvider).toHaveBeenLastCalledWith('/docs/'));
  });

  it('falls back to a local preview modal when the manager layout has no event driver', async () => {
    mockEventEmitter = undefined;
    const listProvider = jest.fn().mockResolvedValue({
      data: [{ name: 'archived.md', path: '/archived.md', isDir: false, size: 8 }],
    });
    const downloadProvider = jest.fn().mockResolvedValue(new Blob(['archived']));

    render(
      <FileBrowserPanel
        resourceId="recycle-7-11"
        mode="preview"
        initialPath="/"
        listProvider={listProvider}
        downloadProvider={downloadProvider}
        showSearch={false}
        showDownloadAction={false}
      />
    );

    fireEvent.click(await screen.findByText('archived.md'));

    await waitFor(() => expect(downloadProvider).toHaveBeenCalledWith('/archived.md'));
    expect(await screen.findByText('local-preview:archived.md')).toBeTruthy();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
