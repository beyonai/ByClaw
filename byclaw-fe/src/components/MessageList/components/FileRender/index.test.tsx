import { fireEvent, render, screen } from '@testing-library/react';
import type { IFile } from '@/typescript/file';
import FileRender from './index';

const mockPreview = jest.fn();
const mockPreviewer = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/utils/file', () => ({ formatBytes: () => '1 KB' }));
jest.mock('@/hooks/useGlobal', () => () => ({ layoutMode: 'chat', EventEmitter: { emit: jest.fn() } }));
jest.mock('./components/IconRender', () => () => null);
jest.mock('./components/Previewer', () => (props: unknown) => {
  mockPreviewer(props);
  return null;
});
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

  it.each([
    'SVG',
    'JPEG',
    'JFIF',
    'jpe',
    'jif',
    'pjp',
    'pjpeg',
    'HIF',
    'JXL',
    'ico',
    'avif',
    'csv',
    'tsv',
    'xls',
    'webm',
    'mp3',
    'm4a',
    'pdf',
    'docx',
    'pptx',
    'doc',
    'ppt',
    'heic',
    'heif',
    'tif',
    'tiff',
    'zip',
    'RTF',
    'ODS',
    'EPUB',
    'SQLITE',
    'SQLITE3',
    'DB',
    'DNG',
    'CR2',
    'CR3',
    'NEF',
    'ARW',
    'RAF',
    'RW2',
    'ORF',
  ])('offers the preview action for %s attachments', (type) => {
    const fileItem: IFile = {
      uid: '1',
      status: 'done',
      fileType: 'file',
      queryFile: { fileName: `attachment.${type}`, fileType: type } as IFile['queryFile'],
    };
    render(<FileRender fileItem={fileItem} />);
    fireEvent.click(screen.getByTitle('common.preview'));
    expect(mockPreview).toHaveBeenCalledWith(fileItem);
  });

  it.each([
    ['照片.JFIF', undefined, 'jpg'],
    ['照片.HIF', 'image', 'heif'],
    ['照片.JXL', 'image/jxl', 'jxl'],
    ['电子书.EPUB', 'application/epub+zip', 'epub'],
    ['数据.DB', 'application/x-sqlite3', 'db'],
    ['照片.CR3', 'image', 'cr3'],
  ])('preserves the original filename for %s modal previews', (fileName, fileType, expectedType) => {
    const fileItem: IFile = {
      uid: 'photo',
      status: 'done',
      fileType: 'file',
      queryFile: { fileName, fileType } as IFile['queryFile'],
    };
    render(<FileRender fileItem={fileItem} />);
    expect(screen.getByTitle('common.preview')).toBeVisible();
    expect(mockPreviewer).toHaveBeenCalledWith(expect.objectContaining({ fileName, fileType: expectedType }));
  });

  it('preserves download for a format without an online decoder', () => {
    const fileItem: IFile = {
      uid: '1',
      status: 'done',
      fileType: 'file',
      downloadUrl: '/archive.rar',
      queryFile: { fileName: 'archive.rar', fileType: 'rar' } as IFile['queryFile'],
    };
    render(<FileRender fileItem={fileItem} />);
    expect(screen.queryByTitle('common.preview')).not.toBeInTheDocument();
    expect(screen.getByTitle('common.download')).toBeInTheDocument();
  });
});
