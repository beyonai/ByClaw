import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { message } from 'antd';
import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';
import { checkUploadFileConflicts, uploadFiles } from '@/service/knowledgeCenter';
import { getLocaleIntl } from '@/testUtils/localeIntl';
import UploadFile from '..';

const MB = 1024 * 1024;
const mockPick = jest.fn();
let mockConfig: Partial<IAgentFileUploadConf> | undefined;
let mockIntl = getLocaleIntl();

jest.mock('antd', () => {
  const actualAntd = jest.requireActual<typeof import('antd')>('antd');
  return {
    ...actualAntd,
    // 上传规则不依赖悬浮提示的动画与布局，保留真实按钮和点击交互。
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ uploadFileConfig: mockConfig }),
}));
jest.mock('@/hooks/useFileTookit', () => ({ useFileTookit: () => ({ pick: mockPick }) }));
jest.mock('@/components/AntdIcon', () => ({ __esModule: true, default: () => null }));
jest.mock('@/service/knowledgeCenter', () => ({
  checkUploadFileConflicts: jest.fn(),
  uploadFiles: jest.fn(),
}));
jest.mock('@/components/UploadConfirmModal', () => ({
  __esModule: true,
  default: function UploadConfirmModalMock({ open, onOk }: { open: boolean; onOk: (parse: boolean) => void }) {
    return open ? (
      <button type="button" onClick={() => onOk(false)}>
        Confirm upload
      </button>
    ) : null;
  },
}));

function createFile(name: string, size: number) {
  // 只模拟大小元数据，避免为 512MB 边界用例分配真实内容。
  const file = new File(['content'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function renderUploader() {
  return render(
    <UploadFile
      baseInfo={{ resourceId: '42' }}
      directoryPath="/docs/"
      uploadLoading={false}
      setUploadLoading={jest.fn()}
    />
  );
}

async function chooseFiles(files: File[]) {
  mockPick.mockResolvedValue(files);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: mockIntl.formatMessage({ id: 'knowledgeDetail.uploadFile' }) }));
  });
}

async function confirmUpload() {
  // 等待上传 Promise 及确认弹窗状态更新，避免断言完成后仍有未提交的更新。
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm upload' }));
  });
}

describe('knowledge upload limits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIntl = getLocaleIntl();
    mockConfig = { maxFileSize: 512, maxFileCount: 2 };
    jest.spyOn(message, 'error').mockImplementation(jest.fn());
    jest.spyOn(message, 'success').mockImplementation(jest.fn());
    jest.mocked(checkUploadFileConflicts).mockResolvedValue({ conflict: false, overwritePaths: [] });
    jest.mocked(uploadFiles).mockResolvedValue({ summary: { succeeded: 2, failed: 0 } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['zh-CN', 'en-US'] as const)('rejects the whole batch with localized feedback in %s', async (locale) => {
    mockIntl = getLocaleIntl(locale);
    renderUploader();
    await chooseFiles([createFile('small.pdf', MB), createFile('oversized.pdf', 512 * MB + 1)]);

    expect(message.error).toHaveBeenCalledWith(mockIntl.formatMessage({ id: 'upload.fileSizeLimit' }, { size: 512 }));
    expect(checkUploadFileConflicts).not.toHaveBeenCalled();
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm upload' })).not.toBeInTheDocument();
  });

  it('uploads an entire batch above 200MB and allows files exactly at the configured limit', async () => {
    const files = [createFile('first.pdf', 512 * MB), createFile('second.pdf', 300 * MB)];
    renderUploader();
    await chooseFiles(files);

    expect(mockPick).toHaveBeenCalledWith({ multiple: true });
    expect(checkUploadFileConflicts).toHaveBeenCalledWith({
      resourceId: '42',
      directoryPath: '/docs/',
      fileNames: ['first.pdf', 'second.pdf'],
    });
    await confirmUpload();
    expect(uploadFiles).toHaveBeenCalledTimes(1);
    const [formData] = jest.mocked(uploadFiles).mock.calls[0];
    expect(formData.getAll('files')).toEqual(files);
    expect(formData.get('directoryPath')).toBe('/docs/');
    expect(formData.get('processFrontMatter')).toBe('false');
  });

  it.each([undefined, {}, { maxFileSize: 0 }])('does not apply a fallback size limit for %p', async (config) => {
    mockConfig = config;
    renderUploader();
    await chooseFiles([createFile('large.pdf', 600 * MB)]);

    expect(screen.getByRole('button', { name: 'Confirm upload' })).toBeInTheDocument();
    expect(message.error).not.toHaveBeenCalled();
  });

  it('rechecks the current size limit when confirming a pending upload', async () => {
    const { rerender } = renderUploader();
    await chooseFiles([createFile('pending.pdf', 300 * MB)]);
    mockConfig = { maxFileSize: 100 };
    rerender(
      <UploadFile
        baseInfo={{ resourceId: '42' }}
        directoryPath="/docs/"
        uploadLoading={false}
        setUploadLoading={jest.fn()}
      />
    );
    await confirmUpload();

    expect(message.error).toHaveBeenCalledWith(mockIntl.formatMessage({ id: 'upload.fileSizeLimit' }, { size: 100 }));
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it.each(['zh-CN', 'en-US'] as const)('rejects a batch above the configured count in %s', async (locale) => {
    mockIntl = getLocaleIntl(locale);
    mockConfig = { maxFileCount: 2, maxFileSize: 0 };
    renderUploader();
    await chooseFiles(Array.from({ length: 3 }, (_, index) => createFile(`document-${index}.pdf`, 1)));

    expect(message.error).toHaveBeenCalledWith(mockIntl.formatMessage({ id: 'upload.maxFilesLimit' }, { count: 2 }));
    expect(checkUploadFileConflicts).not.toHaveBeenCalled();
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it('allows the exact configured count above the former ten-file limit', async () => {
    mockConfig = { maxFileCount: 12, maxFileSize: 512 };
    const files = Array.from({ length: 12 }, (_, index) => createFile(`document-${index}.pdf`, 1));
    renderUploader();
    await chooseFiles(files);
    await confirmUpload();

    expect(uploadFiles).toHaveBeenCalledTimes(1);
    expect(jest.mocked(uploadFiles).mock.calls[0][0].getAll('files')).toEqual(files);
    expect(message.error).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { maxFileCount: 0 }, { maxFileCount: -1 }])(
    'does not fall back to ten files when the count configuration is %p',
    async (config) => {
      mockConfig = config;
      const files = Array.from({ length: 11 }, (_, index) => createFile(`document-${index}.pdf`, 1));
      renderUploader();
      await chooseFiles(files);
      await confirmUpload();

      expect(uploadFiles).toHaveBeenCalledTimes(1);
      expect(jest.mocked(uploadFiles).mock.calls[0][0].getAll('files')).toEqual(files);
      expect(message.error).not.toHaveBeenCalled();
    }
  );

  it('rechecks the current count limit when confirming a pending upload', async () => {
    const { rerender } = renderUploader();
    await chooseFiles([createFile('first.pdf', 1), createFile('second.pdf', 1)]);
    mockConfig = { maxFileCount: 1, maxFileSize: 512 };
    rerender(
      <UploadFile
        baseInfo={{ resourceId: '42' }}
        directoryPath="/docs/"
        uploadLoading={false}
        setUploadLoading={jest.fn()}
      />
    );
    await confirmUpload();

    expect(message.error).toHaveBeenCalledWith(mockIntl.formatMessage({ id: 'upload.maxFilesLimit' }, { count: 1 }));
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it('does not preflight an empty selection', async () => {
    renderUploader();
    await chooseFiles([]);

    expect(checkUploadFileConflicts).not.toHaveBeenCalled();
    expect(uploadFiles).not.toHaveBeenCalled();
  });
});
