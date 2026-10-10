import { getPreviewMimeType, isPreviewableName, PREVIEWABLE_TYPES, resolvePreviewType } from './formats';

describe('shared file preview formats', () => {
  it.each([
    ['picture.SVG', 'svg', 'image/svg+xml'],
    ['picture.JPEG', 'jpg', 'image/jpeg'],
    ['icon.ico', 'ico', 'image/x-icon'],
    ['picture.avif', 'avif', 'image/avif'],
    ['animation.apng', 'apng', 'image/apng'],
    ['page.HTM', 'html', 'text/html'],
    ['readme.markdown', 'md', 'text/markdown'],
    ['table.csv', 'csv', 'text/csv'],
    ['table.tsv', 'tsv', 'text/tab-separated-values'],
    ['report.xls', 'xls', 'application/vnd.ms-excel'],
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
    expect(resolvePreviewType('PDF', 'invoice.pdf')).toBe('pdf');
    expect(resolvePreviewType(undefined, undefined, 'application/pdf')).toBe('pdf');
    expect(resolvePreviewType()).toBe('txt');
  });

  it.each(['archive.zip', 'old.doc', 'old.ppt', 'scan.tiff', 'photo.heic', 'program.exe', 'README'])(
    'does not advertise an unavailable decoder for %s',
    (name) => expect(isPreviewableName(name)).toBe(false)
  );
});
