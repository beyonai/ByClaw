import { fireEvent, render, screen } from '@testing-library/react';
import type { IFile } from '@/typescript/file';
import FileRender from './index';

const mockPreview = jest.fn();
const mockPreviewer = jest.fn();
let mockPreviewing = false;
let mockDownloading = false;

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
  previewing: mockPreviewing,
}));
jest.mock('./useDownload', () => () => ({ downloading: mockDownloading }));

describe('message attachment preview formats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreviewing = false;
    mockDownloading = false;
  });

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
    ['照片.JP2', 'image/jp2', 'jp2'],
    ['照片.PPM', 'image/x-portable-pixmap', 'ppm'],
    ['照片.TGA', 'image/x-tga', 'tga'],
    ['sample.png.alpha', 'alpha', 'png'],
    ['电子书.EPUB', 'application/epub+zip', 'epub'],
    ['文档.ODT', 'application/vnd.oasis.opendocument.text', 'odt'],
    ['演示.ODP', 'application/vnd.oasis.opendocument.presentation', 'odp'],
    ['分析.IPYNB', 'application/x-ipynb+json', 'ipynb'],
    ['邮件.EML', 'message/rfc822', 'eml'],
    ['邮件.MSG', 'application/vnd.ms-outlook', 'msg'],
    ['资料.RAR', 'application/vnd.rar', 'rar'],
    ['资料.7Z', 'application/x-7z-compressed', '7z'],
    ['资料.TAR', 'application/x-tar', 'tar'],
    ['资料.TGZ', 'application/gzip', 'tgz'],
    ['资料.TAR.GZ', 'gz', 'tgz'],
    ['日志.txt.GZ', 'application/gzip', 'gz'],
    ['文档.DOCM', 'application/vnd.ms-word.document.macroEnabled.12', 'docm'],
    ['模板.DOTX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template', 'dotx'],
    ['表格.XLSM', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'xlsm'],
    ['模板.XLTX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template', 'xltx'],
    ['演示.PPTM', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12', 'pptm'],
    ['放映.PPSX', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow', 'ppsx'],
    ['模板.POTX', 'application/vnd.openxmlformats-officedocument.presentationml.template', 'potx'],
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

  it.each([
    ['archive.bz2', 'bz2'],
    ['attachment.exe', 'exe'],
    ['report.pdf', 'unknown'],
    ['attachment', undefined],
  ])('offers preview and download regardless of the format for %s', (fileName, fileType) => {
    const fileItem: IFile = {
      uid: '1',
      status: 'done',
      fileType: 'file',
      downloadUrl: '/attachment',
      queryFile: { fileName, fileType } as IFile['queryFile'],
    };
    render(<FileRender fileItem={fileItem} />);
    fireEvent.click(screen.getByTitle('common.preview'));
    expect(mockPreview).toHaveBeenCalledWith(fileItem);
    expect(screen.getByTitle('common.download')).toBeInTheDocument();
  });

  it.each(['uploading', 'previewing', 'downloading'])(
    'hides preview only while %s and restores it afterward',
    (state) => {
      mockPreviewing = state === 'previewing';
      mockDownloading = state === 'downloading';
      const fileItem: IFile = {
        uid: '1',
        status: state === 'uploading' ? 'uploading' : 'done',
        fileType: 'file',
        queryFile: { fileName: 'archive.bz2', fileType: 'bz2' } as IFile['queryFile'],
      };
      const { rerender } = render(<FileRender fileItem={fileItem} />);
      expect(screen.queryByTitle('common.preview')).not.toBeInTheDocument();

      mockPreviewing = false;
      mockDownloading = false;
      rerender(<FileRender fileItem={{ ...fileItem, status: 'done' }} />);
      expect(screen.getByTitle('common.preview')).toBeInTheDocument();
    }
  );
});
