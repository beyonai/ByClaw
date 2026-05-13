import { downloadFile, readDocContent, fileDownload, fileToBase64, formatBytes, isBase64 } from '../file';

// Mock dependencies
jest.mock('@/service/file', () => ({
  callDomainServiceByMultipart: jest.fn(),
}));

jest.mock(
  'mammoth',
  () => ({
    convertToHtml: jest.fn(),
  }),
  { virtual: true }
);

// Mock window.URL
Object.defineProperty(window, 'URL', {
  value: {
    createObjectURL: jest.fn(() => 'mock-blob-url'),
  },
  writable: true,
});

// Mock document methods
Object.defineProperty(document, 'createElement', {
  value: jest.fn(() => ({
    href: '',
    download: '',
    click: jest.fn(),
    remove: jest.fn(),
  })),
  writable: true,
});

Object.defineProperty(document, 'createElement', {
  value: jest.fn((tagName: string) => {
    if (tagName === 'a') {
      return {
        href: '',
        download: '',
        click: jest.fn(),
        remove: jest.fn(),
      };
    }
    return {};
  }),
  writable: true,
});

Object.defineProperty(document.body, 'appendChild', {
  value: jest.fn(),
  writable: true,
});

Object.defineProperty(document.body, 'removeChild', {
  value: jest.fn(),
  writable: true,
});

describe.skip('file utils', () => {
  describe('downloadFile', () => {
    it('should download file with fileUrl', () => {
      const mockRes = {
        fileUrl: 'http://example.com/file.pdf',
        fileName: 'test.pdf',
      };

      downloadFile(mockRes);

      expect(document.createElement).toHaveBeenCalledWith('a');
    });

    it('should download file with blob when no fileUrl', () => {
      const mockFile = new Blob(['test content']);
      const mockRes = {
        file: mockFile,
        fileName: 'test.txt',
      };

      downloadFile(mockRes);

      expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockFile);
    });

    it('should handle byaiService URL', () => {
      const mockRes = {
        fileUrl: 'byaiService/test.pdf',
        fileName: 'test.pdf',
      };

      downloadFile(mockRes);

      expect(document.createElement).toHaveBeenCalledWith('a');
    });
  });

  describe.skip('readDocContent', () => {
    it('should read docx file content', async () => {
      const mockFile = new Blob(['test content'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const mockHtml = '<p>Test content</p>';

      // Mock mammoth before importing
      jest.doMock('mammoth', () => ({
        convertToHtml: jest.fn().mockResolvedValue({ value: mockHtml }),
      }));

      const result = await readDocContent(mockFile);

      expect(result).toBe(mockHtml);
    });

    it('should reject on file read error', async () => {
      const mockFile = new Blob(['test content']);

      // Mock FileReader to trigger error
      const originalFileReader = window.FileReader;
      window.FileReader = jest.fn().mockImplementation(() => ({
        readAsArrayBuffer: jest.fn(),
        onload: null,
        onerror: null,
      })) as any;

      await expect(readDocContent(mockFile)).rejects.toBe('浏览器不支持文件内容读取');

      window.FileReader = originalFileReader;
    });
  });

  describe('fileDownload', () => {
    it('should download file with text content', () => {
      const params = {
        text: 'test content',
        type: 'text/plain',
        filename: 'test.txt',
      };

      fileDownload(params);

      expect(document.createElement).toHaveBeenCalledWith('a');
    });
  });

  describe.skip('fileToBase64', () => {
    it('should convert file to base64', async () => {
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });

      const result = await fileToBase64(mockFile);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^data:/);
    });

    it('should reject on file read error', async () => {
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });

      // Mock FileReader to trigger error
      const originalFileReader = window.FileReader;
      window.FileReader = jest.fn().mockImplementation(() => ({
        readAsDataURL: jest.fn(),
        onload: null,
        onerror: jest.fn((callback) => {
          setTimeout(() => callback(new Error('Read error')), 0);
        }),
      })) as any;

      await expect(fileToBase64(mockFile)).rejects.toThrow();

      window.FileReader = originalFileReader;
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(1024)).toBe('1 KiB');
      expect(formatBytes(1048576)).toBe('1 MiB');
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(undefined)).toBe('0 B');
    });

    it('should use decimal units when binary is false', () => {
      expect(formatBytes(1000, 2, false)).toBe('1 KB');
      expect(formatBytes(1000000, 2, false)).toBe('1 MB');
    });

    it('should respect decimal places', () => {
      expect(formatBytes(1024, 0)).toBe('1 KiB');
      expect(formatBytes(1024, 4)).toBe('1 KiB');
    });
  });

  describe('isBase64', () => {
    it('should return true for valid base64 string', () => {
      expect(isBase64('dGVzdA==')).toBe(true);
      expect(isBase64('SGVsbG8gV29ybGQ=')).toBe(true);
    });

    it('should return false for invalid base64 string', () => {
      expect(isBase64('invalid base64!')).toBe(false);
      expect(isBase64('')).toBe(false);
      expect(isBase64('   ')).toBe(false);
    });

    it('should handle empty and whitespace strings', () => {
      expect(isBase64('')).toBe(false);
      expect(isBase64('   ')).toBe(false);
    });
  });
});
