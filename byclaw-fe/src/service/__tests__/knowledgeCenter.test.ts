import {
  getResourceListByPage,
  createResource,
  updateResource,
  createAndShelf,
  queryResourceDetail,
  queryKnowledgeCapability,
  deleteResource,
  share,
  listAuthDetail,
  beShared,
  queryAuthDoc,
  delShare,
  createFolder,
  getDataList,
  queryDirAndFileByLevel,
} from '../knowledgeCenter';
import { callDomainServiceByMultipart } from '../file';
import { GET, POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockPOST = POST as jest.Mock;
const mockGET = GET as jest.Mock;

describe('Knowledge Center Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getResourceListByPage', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { pageNum: 1, pageSize: 10, userId: 'user123' };
      getResourceListByPage(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/selectDatasetByQo', data);
    });

    it('should call POST with empty object when no data provided', () => {
      getResourceListByPage({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/selectDatasetByQo', {});
    });
  });

  describe('callDomainServiceByMultipart', () => {
    it('should call POST with correct endpoint and FormData', () => {
      const formData = new FormData();
      formData.append('file', 'test-file');
      callDomainServiceByMultipart(formData);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/commonFile/uploadIcon', formData, {
        timeout: 480000,
        headers: {
          'Content-Type': 'multipart/form-data; charset=utf-8',
        },
      });
    });
  });

  describe('createResource', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { name: 'Test Resource', type: 'document' };
      createResource(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/createDataset', {
        ...data,
        implType: '',
        workerAgentType: '',
      });
    });

    it('should call POST with empty object when no data provided', () => {
      createResource({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/createDataset', {
        implType: '',
        workerAgentType: '',
      });
    });
  });

  describe('updateResource', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { resourceId: 'res1', name: 'Updated Resource' };
      updateResource(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/updateDataset', {
        ...data,
        implType: '',
        workerAgentType: '',
      });
    });

    it('should call POST with empty object when no data provided', () => {
      updateResource({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/updateDataset', {
        implType: '',
        workerAgentType: '',
      });
    });
  });

  describe('createAndShelf', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { name: 'New Resource', publish: true };
      createAndShelf(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/createDataset', {
        ...data,
        implType: '',
        workerAgentType: '',
      });
    });

    it('should call POST with empty object when no data provided', () => {
      createAndShelf({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/createDataset', {
        implType: '',
        workerAgentType: '',
      });
    });
  });

  describe('queryResourceDetail', () => {
    it('should call GET with correct endpoint and data', () => {
      const data = { resourceId: 'res1' };
      queryResourceDetail(data);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/datasetController/detail', data);
    });

    it('should call GET with empty object when no data provided', () => {
      queryResourceDetail({});
      expect(mockGET).toHaveBeenCalledWith('/byaiService/datasetController/detail', {});
    });
  });

  describe('queryKnowledgeCapability', () => {
    it('should call GET with correct endpoint', () => {
      queryKnowledgeCapability();
      expect(mockGET).toHaveBeenCalledWith('/byaiService/datasetController/queryKnowledgeCapability');
    });
  });

  describe('deleteResource', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { resourceId: 'res1' };
      deleteResource(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/deleteDataset', data);
    });

    it('should call POST with empty object when no data provided', () => {
      deleteResource({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/deleteDataset', {});
    });
  });

  describe('share', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { resourceId: 'res1', shareTo: ['user1', 'user2'] };
      share(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/share', data);
    });

    it('should call POST with empty object when no data provided', () => {
      share({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/share', {});
    });
  });

  describe('listAuthDetail', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { resourceId: 'res1' };
      listAuthDetail(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/listAuthDetail', data);
    });

    it('should call POST with empty object when no data provided', () => {
      listAuthDetail({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/listAuthDetail', {});
    });
  });

  describe('beShared', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { userId: 'user123', pageNum: 1 };
      beShared(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/beShared', data);
    });

    it('should call POST with empty object when no data provided', () => {
      beShared({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/beShared', {});
    });
  });

  describe('queryAuthDoc', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { pageNum: 1, pageSize: 100, keyword: '', type: 'authorize' };
      queryAuthDoc(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v2/resource/queryAuthDoc', data);
    });

    it('should call POST with empty object when no data provided', () => {
      queryAuthDoc({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v2/resource/queryAuthDoc', {});
    });
  });

  describe('delShare', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { shareId: 'share1' };
      delShare(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/delShare', data);
    });

    it('should call POST with empty object when no data provided', () => {
      delShare({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/delShare', {});
    });
  });

  describe('createFolder', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { name: 'New Folder', parentId: 'parent1' };
      createFolder(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/createFolder', data);
    });

    it('should call POST with empty object when no data provided', () => {
      createFolder({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/createFolder', {});
    });
  });

  describe('getDataList', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { folderId: 'folder1', pageNum: 1 };
      getDataList(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/getDataList', data);
    });

    it('should call POST with empty object when no data provided', () => {
      getDataList({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/getDataList', {});
    });
  });

  describe('queryDirAndFileByLevel', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { resourceId: 10014248, directoryPath: '/' };
      queryDirAndFileByLevel(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/queryDirAndFileByLevel', data);
    });

    it('should call POST with nested directory path', () => {
      const data = { resourceId: 1, directoryPath: '/一级目录' };
      queryDirAndFileByLevel(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/datasetController/queryDirAndFileByLevel', data);
    });
  });
});
