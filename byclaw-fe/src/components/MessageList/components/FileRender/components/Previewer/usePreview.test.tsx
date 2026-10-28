import { act, renderHook } from '@testing-library/react';
import { message } from 'antd';
import usePreview from './usePreview';
import { downloadResourceFile, getDatasetDownloadParamsFromQueryFile } from '@/service/file';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
jest.mock('@/service/file', () => ({
  downloadResourceFile: jest.fn(),
  getDatasetDownloadParamsFromQueryFile: jest.fn(),
  downloadMinIOFileURL: '/download',
}));
jest.mock('@/utils/file', () => ({ getFileUrl: (url: string) => url }));
jest.mock('./relativeResource', () => ({ isSessionFilePath: () => false }));
jest.mock('antd', () => ({ message: { warning: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

it('does not let an older download overwrite a newly selected file', async () => {
  let finish: (result: { file: Blob }) => void = () => {};
  const first = new Promise<{ file: Blob }>((resolve) => {
    finish = resolve;
  });
  const newest = new Blob(['newest']);
  const { result } = renderHook(() => usePreview());
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.onPreview({ downloadRequest: () => first } as any);
  });
  await act(async () => result.current.onPreview({ downloadRequest: async () => ({ file: newest }) } as any));
  await act(async () => {
    finish({ file: new Blob(['old']) });
    await pending;
  });
  expect(result.current.previewInfo.blob).toBe(newest);
  expect(result.current.previewing).toBe(false);
});

it('always clears loading after dataset errors or empty downloads', async () => {
  (getDatasetDownloadParamsFromQueryFile as jest.Mock).mockReturnValue({ resourceId: 1, directoryPath: '/a.txt' });
  (downloadResourceFile as jest.Mock).mockRejectedValue(new Error('missing'));
  const { result } = renderHook(() => usePreview());
  await act(async () => result.current.onPreview({ queryFile: {} } as any));
  expect(result.current.previewInfo.loading).toBe(false);
  expect(result.current.previewing).toBe(false);
  expect(result.current.previewInfo.error).toBe('fileRender.previewUnavailable');
  expect(message.warning).toHaveBeenCalledWith('fileRender.previewUnavailable');
  await act(async () => result.current.onPreview({ downloadRequest: async () => ({ file: new Blob([]) }) } as any));
  expect(result.current.previewInfo.open).toBe(false);
  expect(result.current.previewInfo.error).toBe('preview.empty');
});

it('discards pending results after closing the panel and supports local upload files', async () => {
  const localFile = new File(['local text'], 'README');
  const { result } = renderHook(() => usePreview());
  await act(async () => result.current.onPreview({ file: localFile } as any));
  expect(result.current.previewInfo.blob).toBe(localFile);
  let finish: (result: { file: Blob }) => void = () => {};
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = result.current.onPreview({
      downloadRequest: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    } as any);
  });
  act(() => result.current.onClosePreviewModal());
  await act(async () => {
    finish({ file: new Blob(['late']) });
    await pending;
  });
  expect(result.current.previewInfo.open).toBe(false);
  expect(result.current.previewInfo.blob).toBeNull();
});
