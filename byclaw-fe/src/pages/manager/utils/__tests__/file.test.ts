jest.mock('@/service/file', () => ({
  callDomainServiceByMultipart: jest.fn(),
}));

import { formatBytes, getFileTypeByName, getFileUrl, isBase64, validateAccept } from '../file';

describe('manager/utils/file', () => {
  describe('getFileUrl', () => {
    it('returns absolute http and blob URLs unchanged', () => {
      expect(getFileUrl('https://example.com/file.pdf')).toBe('https://example.com/file.pdf');
      expect(getFileUrl('blob:http://localhost/file')).toBe('blob:http://localhost/file');
    });

    it('prefixes other relative paths with /byaiService', () => {
      expect(getFileUrl('upload/file/3')).toBe('/byaiService/upload/file/3');
      expect(getFileUrl('/upload/file/3')).toBe('/byaiService/upload/file/3');
    });
  });

  describe('formatBytes', () => {
    it('returns zero for empty input', () => {
      expect(formatBytes()).toBe('0 B');
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats binary units by default', () => {
      expect(formatBytes(1024)).toBe('1 KiB');
      expect(formatBytes(1536)).toBe('1.5 KiB');
    });

    it('formats decimal units when binary is disabled', () => {
      expect(formatBytes(1500, 2, false)).toBe('1.5 KB');
    });
  });

  describe('isBase64', () => {
    it('recognizes valid base64 strings', () => {
      expect(isBase64('dGVzdA==')).toBe(true);
    });

    it('rejects blank and invalid strings', () => {
      expect(isBase64('')).toBe(false);
      expect(isBase64('   ')).toBe(false);
      expect(isBase64('not-base64')).toBe(false);
    });
  });

  describe('getFileTypeByName', () => {
    it('detects image, video and audio types case-insensitively', () => {
      expect(getFileTypeByName('cover.PNG')).toBe('image');
      expect(getFileTypeByName('movie.Mp4')).toBe('video');
      expect(getFileTypeByName('voice.WAV')).toBe('audio');
    });

    it('falls back to file for unknown or empty names', () => {
      expect(getFileTypeByName('archive.zip')).toBe('file');
      expect(getFileTypeByName('filename')).toBe('file');
      expect(getFileTypeByName('')).toBe('file');
    });
  });

  describe('validateAccept', () => {
    const pngFile = new File(['x'], 'avatar.PNG', { type: 'image/png' });
    const pdfFile = new File(['x'], 'report.pdf', { type: 'application/pdf' });

    it('returns true when accept is missing', () => {
      expect(validateAccept(pngFile)).toBe(true);
    });

    it('supports MIME wildcards and exact MIME types', () => {
      expect(validateAccept(pngFile, 'image/*')).toBe(true);
      expect(validateAccept(pdfFile, 'application/pdf')).toBe(true);
    });

    it('supports extension rules with and without leading dot', () => {
      expect(validateAccept(pdfFile, '.pdf')).toBe(true);
      expect(validateAccept(pdfFile, 'pdf')).toBe(true);
    });

    it('supports mixed accept strings and rejects unmatched files', () => {
      expect(validateAccept(pdfFile, 'image/*,.pdf,.doc')).toBe(true);
      expect(validateAccept(pdfFile, 'image/*,.png')).toBe(false);
    });
  });
});
