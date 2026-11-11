import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import UnfinishedUploads from '..';
import { abortStoredUpload, listStoredUploads } from '@/service/resumableFileUpload';
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: any) => id }) }));
jest.mock('@/service/resumableFileUpload', () => ({ listStoredUploads: jest.fn(), abortStoredUpload: jest.fn() }));
it('requires an explicit action to clean an owned saved session and hides it after account changes', async () => {
  const row = {
    ownerKey: 'alice',
    storageKey: 'key',
    uploadId: 'id',
    fileName: 'old.bin',
    path: '/by/test/',
    totalSize: 1024,
    state: 'UPLOADING',
  };
  (listStoredUploads as jest.Mock).mockResolvedValue([row]);
  (abortStoredUpload as jest.Mock).mockResolvedValue(undefined);
  const { rerender } = render(<UnfinishedUploads ownerKey="alice" />);
  fireEvent.click(await screen.findByRole('button', { name: 'fileBrowser.upload.manageUnfinished' }));
  await screen.findByText('old.bin');
  expect(abortStoredUpload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'fileBrowser.upload.abortSession' }));
  await waitFor(() => expect(abortStoredUpload).toHaveBeenCalledWith('alice', row, expect.any(Function)));
  await waitFor(() => expect(screen.queryByText('old.bin')).not.toBeInTheDocument());
  rerender(<UnfinishedUploads ownerKey="bob" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('loads the authorized resource inventory and hides the old dialog after switching resources', async () => {
  jest.clearAllMocks();
  (listStoredUploads as jest.Mock).mockResolvedValue([
    { ownerKey: 'alice', storageKey: 'key', fileName: 'file.bin', totalSize: 1, state: 'UPLOADING' },
  ]);
  const { rerender } = render(<UnfinishedUploads ownerKey="alice" resourceId="42" />);
  fireEvent.click(await screen.findByRole('button', { name: 'fileBrowser.upload.manageUnfinished' }));
  await waitFor(() => expect(listStoredUploads).toHaveBeenCalledWith('alice', '42', expect.any(Function)));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  rerender(<UnfinishedUploads ownerKey="alice" resourceId="43" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(abortStoredUpload).not.toHaveBeenCalled();
});

it.each([
  { ownerKey: 'alice', resourceId: '43' },
  { ownerKey: 'bob', resourceId: '42' },
])('invalidates cancellation request guards when switching to %p', async (next) => {
  jest.clearAllMocks();
  const row = {
    ownerKey: 'alice',
    storageKey: 'race',
    uploadId: 'id',
    fileName: 'race.bin',
    path: '/by/',
    totalSize: 8,
    state: 'UPLOADING',
  };
  (listStoredUploads as jest.Mock).mockResolvedValue([row]);
  (abortStoredUpload as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const { rerender } = render(<UnfinishedUploads ownerKey="alice" resourceId="42" />);
  fireEvent.click(await screen.findByRole('button', { name: 'fileBrowser.upload.manageUnfinished' }));
  await screen.findByText('race.bin');
  fireEvent.click(screen.getByRole('button', { name: 'fileBrowser.upload.abortSession' }));
  const checkContext = (abortStoredUpload as jest.Mock).mock.calls[0][2];
  expect(() => checkContext()).not.toThrow();
  rerender(<UnfinishedUploads {...next} />);
  expect(() => checkContext()).toThrow('Upload context changed');
});

it('keeps the entry hidden for empty, completed or failed inventory queries', async () => {
  for (const result of [[], [{ state: 'COMPLETED' }], [{ state: 'EXPIRED' }]]) {
    (listStoredUploads as jest.Mock).mockResolvedValue(result);
    const { unmount } = render(<UnfinishedUploads ownerKey="alice" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'fileBrowser.upload.manageUnfinished' })).not.toBeInTheDocument();
    unmount();
  }
  (listStoredUploads as jest.Mock).mockRejectedValue(new Error('offline'));
  const { unmount } = render(<UnfinishedUploads ownerKey="alice" />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole('button', { name: 'fileBrowser.upload.manageUnfinished' })).not.toBeInTheDocument();
  unmount();
});

it('starts hidden and ignores an old account response', async () => {
  let resolve!: (rows: any[]) => void;
  (listStoredUploads as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { rerender } = render(<UnfinishedUploads ownerKey="alice" />);
  expect(screen.queryByRole('button', { name: 'fileBrowser.upload.manageUnfinished' })).not.toBeInTheDocument();
  (listStoredUploads as jest.Mock).mockResolvedValue([]);
  rerender(<UnfinishedUploads ownerKey="bob" />);
  await act(async () => {
    resolve([{ state: 'UPLOADING' }]);
  });
  expect(screen.queryByRole('button', { name: 'fileBrowser.upload.manageUnfinished' })).not.toBeInTheDocument();
});
