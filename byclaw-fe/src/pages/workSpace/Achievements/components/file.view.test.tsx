import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getCatalogsByTaskId, getWorkSpaceFile } from '@/service/workSpace';
import FileView from './file.view';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({ layoutMode: 'chat' }));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/components/KeepAlive', () => ({
  KeepAlive: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('./InputFilter', () => ({ InputFilter: () => null }));
jest.mock('./UploadFileModal', () => ({ useUploadFileModal: () => ({ holder: null, show: jest.fn() }) }));
jest.mock('./FilePreview', () => ({
  FilePreview: ({ fileInfo }: { fileInfo: { name: string } }) => (
    <div data-testid="selected-preview">{fileInfo.name}</div>
  ),
}));
jest.mock('./AchievementContext', () => {
  const task = { taskId: 'task-1' };
  return {
    AchievementContext: require('react').createContext({
      useValue: (key: string) => [key === 'task' ? task : key === 'sessionId' ? 'session-1' : undefined, jest.fn()],
    }),
  };
});
jest.mock('@/service/workSpace', () => ({
  getCatalogsByTaskId: jest.fn(),
  getWorkSpaceFile: jest.fn(),
  deleteFiles: jest.fn(),
  deleteCatalog: jest.fn(),
}));

describe('achievement file tree preview actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCatalogsByTaskId as jest.Mock).mockResolvedValue([]);
  });

  it.each(['SVG', 'jpeg', 'avif', 'csv', 'xls', 'webm', 'mp3', 'pdf', 'docx', 'pptx'])(
    'opens %s from the file tree',
    async (type) => {
      const fileName = `report.${type}`;
      (getWorkSpaceFile as jest.Mock).mockResolvedValue({
        files: [{ fileId: '1', fileName, fileUrl: `/files/${fileName}` }],
      });
      render(<FileView />);
      fireEvent.click((await screen.findByRole('img', { name: 'eye' })).closest('span')!);
      expect(screen.getByTestId('selected-preview')).toHaveTextContent(fileName);
    }
  );

  it('keeps downloads for binary formats without an online decoder', async () => {
    (getWorkSpaceFile as jest.Mock).mockResolvedValue({
      files: [{ fileId: '1', fileName: 'archive.zip', fileUrl: '/files/archive.zip' }],
    });
    render(<FileView />);
    await waitFor(() => expect(screen.getByText('archive.zip')).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: 'eye' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'download' })).toBeInTheDocument();
  });
});
