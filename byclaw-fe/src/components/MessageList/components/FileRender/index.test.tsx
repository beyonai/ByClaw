import { fireEvent, render, screen } from '@testing-library/react';
import type { IFile } from '@/typescript/file';
import FileRender from './index';

const mockPreview = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/utils/file', () => ({ formatBytes: () => '1 KB' }));
jest.mock('@/hooks/useGlobal', () => () => ({ layoutMode: 'chat', EventEmitter: { emit: jest.fn() } }));
jest.mock('./components/IconRender', () => () => null);
jest.mock('./components/Previewer', () => () => null);
jest.mock('./components/Previewer/MessageFilePreviewPanel', () => () => null);
jest.mock('@/layout/sider/siderContentContext', () => ({
  SiderContentContext: require('react').createContext({}),
  HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH: 400,
}));
jest.mock('./components/Previewer/usePreview', () => () => ({
  onPreview: mockPreview,
  previewInfo: {},
  onClosePreviewModal: jest.fn(),
  previewing: false,
}));
jest.mock('./useDownload', () => () => ({ downloading: false }));

describe('message attachment preview formats', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['SVG', 'JPEG', 'ico', 'avif', 'csv', 'tsv', 'xls', 'webm', 'mp3', 'm4a', 'pdf', 'docx', 'pptx'])(
    'offers the preview action for %s attachments',
    (type) => {
      const fileItem: IFile = {
        uid: '1',
        status: 'done',
        fileType: 'file',
        queryFile: { fileName: `attachment.${type}`, fileType: type } as IFile['queryFile'],
      };
      render(<FileRender fileItem={fileItem} />);
      fireEvent.click(screen.getByTitle('common.preview'));
      expect(mockPreview).toHaveBeenCalledWith(fileItem);
    }
  );

  it('preserves download for a format without an online decoder', () => {
    const fileItem: IFile = {
      uid: '1',
      status: 'done',
      fileType: 'file',
      downloadUrl: '/archive.zip',
      queryFile: { fileName: 'archive.zip', fileType: 'zip' } as IFile['queryFile'],
    };
    render(<FileRender fileItem={fileItem} />);
    expect(screen.queryByTitle('common.preview')).not.toBeInTheDocument();
    expect(screen.getByTitle('common.download')).toBeInTheDocument();
  });
});
