import { getMimeType, isPreviewable, isVideo } from './constants';

describe('knowledge file preview support', () => {
  it('recognizes both native PPTX and converted legacy PPT previews', () => {
    expect(isPreviewable('slides.pptx')).toBe(true);
    expect(isPreviewable('slides.ppt')).toBe(true);
    expect(isPreviewable('report.doc')).toBe(true);
  });

  it.each([
    'svg',
    'jpeg',
    'jfif',
    'jpe',
    'jif',
    'pjp',
    'pjpeg',
    'hif',
    'jxl',
    'ico',
    'avif',
    'apng',
    'csv',
    'tsv',
    'xls',
    'webm',
    'mp3',
    'wav',
    'm4a',
    'flac',
    'htm',
    'heic',
    'heif',
    'tif',
    'tiff',
    'zip',
    'RTF',
    'ODS',
    'epub',
    'db',
    'sqlite',
    'sqlite3',
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
  ])('recognizes %s and provides its MIME to the renderer', (type) => {
    expect(isPreviewable(`file.${type}`)).toBe(true);
    expect(getMimeType(`file.${type}`)).not.toBe('');
  });

  it('classifies WebM as video and leaves audio on its own branch', () => {
    expect(isVideo('clip.WEBM')).toBe(true);
    expect(isVideo('recording.mp3')).toBe(false);
  });
});
