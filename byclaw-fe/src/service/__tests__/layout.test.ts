import {
  qryConversations,
  updateConversation,
  removeConversation,
  getDefaultByaiAgent,
  getSearchList,
  getDcSystemConfigValueByCode,
} from '../layout';
import { GET, POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockGET = GET as jest.Mock;
const mockPOST = POST as jest.Mock;

describe('Layout Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('qryConversations', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { userId: 'user123', pageNum: 1 };
      qryConversations(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/qryConversations', data, {
        responseCfg: {
          hideErrorTips: true,
        },
      });
    });

    it('should call POST with empty object when no data provided', () => {
      qryConversations({});
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/assiman/qryConversations',
        {},
        {
          responseCfg: {
            hideErrorTips: true,
          },
        }
      );
    });
  });

  describe('updateConversation', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { conversationId: 'conv1', title: 'Updated Chat' };
      updateConversation(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/updateConversation', data);
    });

    it('should call POST with empty object when no data provided', () => {
      updateConversation({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/updateConversation', {});
    });
  });

  describe('removeConversation', () => {
    it('should call GET with correct endpoint and params', () => {
      const params = { conversationId: 'conv1' };
      removeConversation(params);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/removeConversation', params);
    });

    it('should call GET with empty object when no params provided', () => {
      removeConversation({});
      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/removeConversation', {});
    });
  });

  describe('getDefaultByaiAgent', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { userId: 'user123' };
      getDefaultByaiAgent(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getDefaultByaiAgent', data);
    });

    it('should call POST with empty object when no data provided', () => {
      getDefaultByaiAgent({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getDefaultByaiAgent', {});
    });
  });

  describe('getSearchList', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { keyword: 'test', type: 'agent' };
      getSearchList(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', payload, { cancelToken: undefined });
    });

    it('should call POST with cancelToken', () => {
      const payload = { keyword: 'test', type: 'agent' };
      const cancelToken = new AbortController();
      getSearchList(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', payload, { cancelToken });
    });

    it('should call POST with empty object when no payload provided', () => {
      getSearchList({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', {}, { cancelToken: undefined });
    });
  });

  describe('getDcSystemConfigValueByCode', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { code: 'CONFIG_KEY', systemType: 'main' };
      getDcSystemConfigValueByCode(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfigValueByCode', payload, {
        cancelToken: undefined,
      });
    });

    it('should call POST with cancelToken', () => {
      const payload = { code: 'CONFIG_KEY', systemType: 'main' };
      const cancelToken = new AbortController();
      getDcSystemConfigValueByCode(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfigValueByCode', payload, {
        cancelToken,
      });
    });

    it('should call POST with empty object when no payload provided', () => {
      getDcSystemConfigValueByCode({});
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/system/staticdata/getDcSystemConfigValueByCode',
        {},
        { cancelToken: undefined }
      );
    });
  });
});
