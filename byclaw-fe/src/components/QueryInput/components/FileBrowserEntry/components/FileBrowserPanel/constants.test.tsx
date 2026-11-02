import { render, screen } from '@testing-library/react';
import { getFileIcon, getMimeType, isPreviewable, isVideo } from './constants';

describe('knowledge file preview support', () => {
  it.each(['backup.tgz', 'backup.tar.gz', 'backup.tar', 'report.csv.gz'])('shows an archive icon for %s', (name) => {
    render(<>{getFileIcon(name, false)}</>);
    expect(screen.getByRole('img', { name: 'file-zip' })).toBeInTheDocument();
  });
  it.each(['sample.jp2', 'sample.ppm', 'sample.tga', 'sample.png.alpha'])('shows an image icon for %s', (name) => {
    render(<>{getFileIcon(name, false)}</>);
    expect(screen.getByRole('img', { name: 'file-image' })).toBeInTheDocument();
  });

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
    'jp2',
    'ppm',
    'tga',
    'png.alpha',
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
    'rar',
    '7z',
    'tar',
    'gz',
    'tgz',
    'tar.gz',
    'msg',
    'RTF',
    'ODS',
    'ODT',
    'ODP',
    'IPYNB',
    'DOCM',
    'DOTX',
    'XLSM',
    'XLTX',
    'PPTM',
    'PPSX',
    'POTX',
    'EML',
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
