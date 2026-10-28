import { getPreviewMimeType, isPreviewableName, PREVIEWABLE_TYPES, resolvePreviewType } from './formats';

describe('shared file preview formats', () => {
  it.each([
    ['docm', 'application/vnd.ms-word.document.macroEnabled.12'],
    ['dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template'],
    ['xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    ['xltx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'],
    ['pptm', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'],
    ['ppsx', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow'],
    ['potx', 'application/vnd.openxmlformats-officedocument.presentationml.template'],
    ['eml', 'message/rfc822'],
    ['msg', 'application/vnd.ms-outlook'],
    ['rar', 'application/vnd.rar'],
    ['7z', 'application/x-7z-compressed'],
    ['tar', 'application/x-tar'],
    ['gz', 'application/gzip'],
  ])('recognizes %s by filename and case-insensitive MIME', (type, mime) => {
    expect(isPreviewableName(`文件.${type.toUpperCase()}`)).toBe(true);
    expect(resolvePreviewType('file', `文件.${type.toUpperCase()}`)).toBe(type);
    expect(resolvePreviewType(undefined, undefined, mime.toUpperCase() + '; charset=utf-8')).toBe(type);
    expect(getPreviewMimeType(`文件.${type}`)).toBe(mime);
  });
  it.each([
    ['book.EPUB', 'epub', 'application/epub+zip'],
    ['data.DB', 'db', 'application/vnd.sqlite3'],
    ['data.sqlite', 'sqlite', 'application/vnd.sqlite3'],
    ['data.sqlite3', 'sqlite3', 'application/vnd.sqlite3'],
    ['photo.DNG', 'dng', 'image/x-adobe-dng'],
    ['photo.CR3', 'cr3', 'image/x-canon-cr3'],
    ['photo.HEIC', 'heic', 'image/heic'],
    ['photo.heif', 'heif', 'image/heif'],
    ['camera.HIF', 'heif', 'image/heif'],
    ['photo.JXL', 'jxl', 'image/jxl'],
    ['photo.JP2', 'jp2', 'image/jp2'],
    ['photo.PPM', 'ppm', 'image/x-portable-pixmap'],
    ['photo.TGA', 'tga', 'image/x-tga'],
    ['sample.PNG.ALPHA', 'png', 'image/png'],
    ['scan.TIF', 'tif', 'image/tiff'],
    ['scan.tiff', 'tiff', 'image/tiff'],
    ['资料.ZIP', 'zip', 'application/zip'],
    ['资料.TGZ', 'tgz', 'application/gzip'],
    ['资料.TAR.GZ', 'tgz', 'application/gzip'],
    ['picture.SVG', 'svg', 'image/svg+xml'],
    ['picture.JPEG', 'jpg', 'image/jpeg'],
    ['picture.JFIF', 'jpg', 'image/jpeg'],
    ['picture.jpe', 'jpg', 'image/jpeg'],
    ['picture.jif', 'jpg', 'image/jpeg'],
    ['picture.pjp', 'jpg', 'image/jpeg'],
    ['picture.pjpeg', 'jpg', 'image/jpeg'],
    ['icon.ico', 'ico', 'image/x-icon'],
    ['picture.avif', 'avif', 'image/avif'],
    ['animation.apng', 'apng', 'image/apng'],
    ['page.HTM', 'html', 'text/html'],
    ['readme.markdown', 'md', 'text/markdown'],
    ['table.csv', 'csv', 'text/csv'],
    ['table.tsv', 'tsv', 'text/tab-separated-values'],
    ['report.xls', 'xls', 'application/vnd.ms-excel'],
    ['report.RTF', 'rtf', 'application/rtf'],
    ['report.ODS', 'ods', 'application/vnd.oasis.opendocument.spreadsheet'],
    ['report.ODT', 'odt', 'application/vnd.oasis.opendocument.text'],
    ['slides.ODP', 'odp', 'application/vnd.oasis.opendocument.presentation'],
    ['analysis.IPYNB', 'ipynb', 'application/x-ipynb+json'],
    ['report.DOC', 'doc', 'application/msword'],
    ['slides.PPT', 'ppt', 'application/vnd.ms-powerpoint'],
    ['clip.webm', 'webm', 'video/webm'],
    ['clip.mp4', 'mp4', 'video/mp4'],
    ['recording.mp3', 'mp3', 'audio/mpeg'],
    ['recording.m4a', 'm4a', 'audio/mp4'],
    ['recording.opus', 'opus', 'audio/ogg'],
    ['recording.flac', 'flac', 'audio/flac'],
  ])('shares recognition, renderer type and MIME for %s', (name, type, mime) => {
    expect(isPreviewableName(name)).toBe(true);
    expect(resolvePreviewType(undefined, name)).toBe(type);
    expect(getPreviewMimeType(name)).toBe(mime);
    expect(PREVIEWABLE_TYPES).toContain(type);
  });

  it.each(['pdf', 'docx', 'xlsx', 'pptx', 'md', 'html', 'json', 'xml', 'png', 'webp', 'yaml', 'ts'])(
    'retains existing %s support',
    (type) => expect(isPreviewableName(`file.${type}`)).toBe(true)
  );

  it('normalizes MIME, generic categories and dotted extensions', () => {
    expect(resolvePreviewType('image', 'diagram.svg')).toBe('svg');
    expect(resolvePreviewType('image', undefined, 'image/svg+xml;charset=UTF-8')).toBe('svg');
    expect(resolvePreviewType('image/svg+xml;charset=UTF-8')).toBe('svg');
    expect(resolvePreviewType('image', 'download.bin', 'image/png')).toBe('png');
    expect(resolvePreviewType('.JPEG')).toBe('jpg');
    expect(resolvePreviewType('.HIF')).toBe('heif');
    expect(resolvePreviewType('image', 'camera.HIF')).toBe('heif');
    expect(resolvePreviewType('image', 'download.bin', 'image/jxl')).toBe('jxl');
    expect(resolvePreviewType('image/jpeg', 'photo.JFIF')).toBe('jpg');
    expect(resolvePreviewType('PDF', 'invoice.pdf')).toBe('pdf');
    expect(resolvePreviewType(undefined, undefined, 'application/pdf')).toBe('pdf');
    expect(resolvePreviewType('text/rtf;charset=GBK')).toBe('rtf');
    expect(resolvePreviewType(undefined, undefined, 'application/rtf')).toBe('rtf');
    expect(resolvePreviewType('file', 'download.bin', 'application/vnd.oasis.opendocument.spreadsheet')).toBe('ods');
    expect(resolvePreviewType('application/x-sqlite3')).toBe('sqlite');
    expect(resolvePreviewType('image', 'camera.NEF')).toBe('nef');
    expect(resolvePreviewType('application/x-rar-compressed')).toBe('rar');
    expect(resolvePreviewType(undefined, undefined, 'application/x-rar')).toBe('rar');
    expect(resolvePreviewType('gz', 'archive.TAR.GZ')).toBe('tgz');
    expect(resolvePreviewType('.tar.gz')).toBe('tgz');
    expect(resolvePreviewType('application/x-gzip', 'archive.tgz')).toBe('tgz');
    expect(resolvePreviewType('application/x-gzip')).toBe('gz');
    expect(resolvePreviewType('application/x-compressed-tar')).toBe('tgz');
    expect(resolvePreviewType('alpha', 'sample.png.alpha')).toBe('png');
    expect(resolvePreviewType('png.alpha')).toBe('png');
    expect(isPreviewableName('sample.alpha')).toBe(false);
    expect(resolvePreviewType()).toBe('txt');
  });

  it.each(['archive.bz2', 'scan.psd', 'photo.jpx', 'program.exe'])(
    'does not advertise an unavailable decoder for %s',
    (name) => expect(isPreviewableName(name)).toBe(false)
  );
});

it.each(['raw', 'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'rw2', 'orf', 'pef', 'srw'])(
  'recognizes %s RAW extension without a text fallback',
  (type) => {
    expect(isPreviewableName(`photo.${type.toUpperCase()}`)).toBe(true);
    expect(resolvePreviewType('image', `photo.${type}`)).toBe(type);
    expect(getPreviewMimeType(`photo.${type}`)).toMatch(/^image\//);
  }
);
