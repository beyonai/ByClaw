import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { createRef } from 'react';

import { isUploadFileSizeExceeded } from '@/components/QueryInput/utils/fileUpload';
import { uploadFiles } from '@/service/file';
import type { IFile } from '@/typescript/file';
import UploadFile, { UploadFileRef } from '..';

jest.mock('@/service/file', () => ({ uploadFiles: jest.fn() }));
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const mockUploadFiles = uploadFiles as jest.MockedFunction<typeof uploadFiles>;
const originalCreateObjectURL = URL.createObjectURL;
const limit = 10 * 1024 * 1024;

// 只模拟浏览器提供的文件元数据，避免测试为超限样例分配大块视频内容。
function createFile(name: string, size: number) {
  const file = new File(['content'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function renderUploader(maxFileSize = 10) {
  const ref = createRef<UploadFileRef>();
  const beforeUpload = jest.fn((files: File[]) =>
    files.every((file) => !isUploadFileSizeExceeded({ maxFileSize }, file.size))
  );
  const onCreate = jest.fn<boolean, [IFile]>(() => true);
  const onUpdate = jest.fn();
  const onRemove = jest.fn();
  const setSessionId = jest.fn();
  const result = render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <UploadFile
          ref={ref}
          beforeUpload={beforeUpload}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onRemove={onRemove}
          setSessionId={setSessionId}
        >
          <span>Choose attachments</span>
        </UploadFile>
      </App>
    </ConfigProvider>
  );
  const input = result.container.querySelector('input[type="file"]')!;
  return { ...result, ref, input, beforeUpload, onCreate, onUpdate, onRemove, setSessionId };
}

describe('chat attachment validation and upload errors', () => {
  beforeAll(() => {
    URL.createObjectURL = jest.fn(() => 'blob:attachment');
  });

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadFiles.mockResolvedValue({ uploadItems: [{ fileId: 23, fileName: 'document.pdf' }] });
  });

  it('rejects an oversized file selected from the computer before creating an attachment or calling the API', async () => {
    const { input, beforeUpload, onCreate } = renderUploader();
    fireEvent.change(input, { target: { files: [createFile('video.mp4', 21196721)] } });

    await waitFor(() => expect(beforeUpload).toHaveBeenCalledTimes(1));
    expect(onCreate).not.toHaveBeenCalled();
    expect(mockUploadFiles).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('validates a mixed batch once and allows a valid selection after rejection', async () => {
    const { container, input, beforeUpload, onCreate, onUpdate } = renderUploader();
    const small = createFile('document.pdf', 100);
    const large = createFile('video.mp4', limit + 1);
    fireEvent.change(input, { target: { files: [small, large] } });

    await waitFor(() => expect(beforeUpload).toHaveBeenCalledTimes(1));
    expect(onCreate).not.toHaveBeenCalled();
    expect(mockUploadFiles).not.toHaveBeenCalled();

    // rc-upload 每次选择后会重建 input，重选文件时必须操作当前仍挂载的节点。
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [small] } });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(beforeUpload).toHaveBeenCalledTimes(2);
    expect(mockUploadFiles).toHaveBeenCalledTimes(1);
    expect(mockUploadFiles.mock.calls[0][0].getAll('files')).toEqual([small]);
  });

  it.each([
    [10, limit],
    [0, limit + 1],
    [30, 21196721],
  ])('uploads size %s configuration / %s bytes without imposing an extra limit', async (maxFileSize, size) => {
    const { input, onUpdate } = renderUploader(maxFileSize);
    const file = createFile('document.pdf', size);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' })));
    expect(mockUploadFiles).toHaveBeenCalledTimes(1);
  });

  it('also validates the imperative upload entry used for pasted files', async () => {
    const { ref, beforeUpload, onCreate } = renderUploader();
    await act(async () => {
      ref.current?.uploadFile(createFile('pasted.png', limit + 1));
    });

    expect(beforeUpload).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it.each([
    ['文件大小超出限制，最大允许:10MB,当前文件大小:20.215MB', '文件大小超出限制，最大允许:10MB,当前文件大小:20.215MB'],
    [new Error('Network Error'), 'Network Error'],
    [undefined, 'upload.failed'],
  ])('shows an upload rejection to the user and removes every failed attachment: %p', async (error, expected) => {
    mockUploadFiles.mockRejectedValue(error);
    const { input, onCreate, onUpdate, onRemove, setSessionId } = renderUploader();
    fireEvent.change(input, {
      target: { files: [createFile('first.pdf', 100), createFile('second.pdf', 100)] },
    });

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onRemove).toHaveBeenCalledTimes(2);
    onCreate.mock.calls.forEach(([payload]) => expect(onRemove).toHaveBeenCalledWith(payload));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(setSessionId).not.toHaveBeenCalled();
  });

  it('cleans up an empty upload result instead of leaving the attachment uploading indefinitely', async () => {
    mockUploadFiles.mockResolvedValue({ uploadItems: [] });
    const { input, onUpdate, onRemove } = renderUploader();
    fireEvent.change(input, { target: { files: [createFile('document.pdf', 100)] } });

    expect(await screen.findByText('upload.failed')).toBeInTheDocument();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
