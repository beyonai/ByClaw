import { uploadImage, uploadFiles, downloadResourceFile } from '../file';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import { GET, POST } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('File Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadImage', () => {
    it('should call POST with correct endpoint, data and config', () => {
      const formData = new FormData();
      formData.append('file', 'image.jpg');

      uploadImage(formData);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/search/upload-image', formData, {
        timeout: 480000,
        headers: {
          'Content-Type': 'multipart/form-data; charset=utf-8',
        },
      });
    });
  });

  describe('uploadFiles', () => {
    it('should call POST with correct endpoint, data and config', async () => {
      const formData = new FormData();
      formData.append('file', 'document.pdf');
      mockPOST.mockResolvedValue({
        uploadItems: [{ fileId: 'file-1' }],
      } as any);

      await expect(uploadFiles(formData)).resolves.toEqual({
        uploadItems: [{ fileId: 'file-1' }],
        rebuildFileList: [{ fileId: 'file-1' }],
      });

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/uploadFiles', formData, {
        timeout: 480000,
        headers: {
          'Content-Type': 'multipart/form-data; charset=utf-8',
        },
      });
    });
  });

  describe('downloadResourceFile', () => {
    it('should call GET with correct endpoint, params and config', () => {
      const params = { resourceId: 10053191, directoryPath: '/测试.docx' };

      downloadResourceFile(params);

      expect(mockGET).toHaveBeenCalledWith(
        '/byaiService/datasetController/download',
        { resourceId: 10053191, directoryPath: '/测试.docx' },
        {
          responseType: 'blob',
        }
      );
    });
  });
});
