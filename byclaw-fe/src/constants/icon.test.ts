import { getFileIconType } from './icon';

describe('photo file icons', () => {
  it.each([
    ['docm', 'Word'],
    ['dotx', 'Word'],
    ['xlsm', 'Excel'],
    ['xltx', 'Excel'],
    ['pptm', 'PPT'],
    ['ppsx', 'PPT'],
    ['potx', 'PPT'],
    ['eml', 'jishiben'],
    ['msg', 'jishiben'],
    ['rar', 'a-Data-fileshujuwenjian'],
    ['7z', 'a-Data-fileshujuwenjian'],
    ['jp2', 'Image'],
    ['ppm', 'Image'],
    ['tga', 'Image'],
    ['png.alpha', 'Image'],
    ['tar', 'a-Data-fileshujuwenjian'],
    ['gz', 'a-Data-fileshujuwenjian'],
    ['tgz', 'a-Data-fileshujuwenjian'],
    ['tar.gz', 'a-Data-fileshujuwenjian'],
  ])('recognizes %s document icons', (type, icon) => {
    expect(getFileIconType(`file.${type.toUpperCase()}`)).toBe(icon);
  });
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
    expect(getFileIconType('文档.ODT')).toBe('Word');
    expect(getFileIconType('演示.ODP')).toBe('PPT');
    expect(getFileIconType('分析.IPYNB')).toBe('a-Codedaima');
  });
});
