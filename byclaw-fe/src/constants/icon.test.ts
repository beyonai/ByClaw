import { getFileIconType } from './icon';

describe('photo file icons', () => {
  it.each([
    'jpg',
    'jpeg',
    'jfif',
    'jpe',
    'jif',
    'pjp',
    'pjpeg',
    'heic',
    'heif',
    'hif',
    'tif',
    'tiff',
    'jxl',
    'avif',
    'apng',
    'raw',
    'dng',
    'cr2',
    'cr3',
    'nef',
    'nrw',
    'arw',
    'srf',
    'sr2',
    'raf',
    'rw2',
    'orf',
    'pef',
    'srw',
  ])('uses the image icon for %s filenames and type-only values', (extension) => {
    expect(getFileIconType(`照片.${extension.toUpperCase()}`)).toBe('Image');
    expect(getFileIconType(extension)).toBe('Image');
  });

  it('preserves directory and unknown-format icons', () => {
    expect(getFileIconType('album.jxl', { isDirectory: true })).toBe('wenjianjialanse');
    expect(getFileIconType('photo.unknown')).toBe('a-Data-fileshujuwenjian');
  });

  it('identifies RTF documents and ODS spreadsheets', () => {
    expect(getFileIconType('书.EPUB')).toBe('Word');
    expect(getFileIconType('数据.SQLITE')).toBe('sql1');
    expect(getFileIconType('数据.DB')).toBe('sql1');
    expect(getFileIconType('正文.RTF')).toBe('Word');
    expect(getFileIconType('数据.ODS')).toBe('Excel');
  });
});
