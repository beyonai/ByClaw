import {
  queryKnowledgeBaseByUser,
  queryAllIndicator,
  queryKnowledge,
  querySearchSuggestions,
  getChatSystemConfig,
  queryKnowledgeBaseView,
  queryKnowledgeBaseViewMeta,
} from '../chatBI';
import { POST } from '@/service/common/request';

jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockPOST = POST as jest.Mock;

describe('ChatBI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('queryKnowledgeBaseByUser', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { userId: 'user123', pageNum: 1 };
      queryKnowledgeBaseByUser(payload);
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainService/queryKnowledgeBaseByUser', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      queryKnowledgeBaseByUser({});
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainService/queryKnowledgeBaseByUser', {});
    });
  });

  describe('queryAllIndicator', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { category: 'sales', type: 'metric' };
      queryAllIndicator(payload);
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/queryAllIndicator', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      queryAllIndicator({});
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/queryAllIndicator', {});
    });
  });

  describe('queryKnowledge', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { query: 'test query', limit: 10 };
      queryKnowledge(payload);
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/queryKnowledge', payload, {
        cancelToken: undefined,
      });
    });

    it('should call POST with cancelToken', () => {
      const payload = { query: 'test query', limit: 10 };
      const cancelToken = new AbortController();
      queryKnowledge(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/queryKnowledge', payload, {
        cancelToken,
      });
    });

    it('should call POST with empty object when no payload provided', () => {
      queryKnowledge({});
      expect(mockPOST).toHaveBeenCalledWith(
        '/knowledgeService/callDomainModel/queryKnowledge',
        {},
        {
          cancelToken: undefined,
        }
      );
    });
  });

  describe('querySearchSuggestions', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { keyword: 'test', limit: 5 };
      querySearchSuggestions(payload);
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/querySearchSuggestions', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      querySearchSuggestions({});
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/querySearchSuggestions', {});
    });
  });

  describe('getChatSystemConfig', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { configType: 'chat', systemId: 'sys1' };
      getChatSystemConfig(payload);
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/getChatSystemConfig', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getChatSystemConfig({});
      expect(mockPOST).toHaveBeenCalledWith('/knowledgeService/callDomainModel/getChatSystemConfig', {});
    });
  });

  describe('queryKnowledgeBaseViewMeta', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { baseId: 'base1', viewType: 'table' };
      const cancelToken = new AbortController();
      queryKnowledgeBaseViewMeta(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith('knowledgeService/callDomainModel/queryKnowledgeBaseViewMeta', payload, {
        cancelToken,
      });
    });

    it('should call POST without cancelToken', () => {
      const payload = { baseId: 'base1', viewType: 'table' };
      queryKnowledgeBaseViewMeta(payload);
      expect(mockPOST).toHaveBeenCalledWith('knowledgeService/callDomainModel/queryKnowledgeBaseViewMeta', payload, {
        cancelToken: undefined,
      });
    });

    it('should call POST with empty object when no payload provided', () => {
      queryKnowledgeBaseViewMeta({});
      expect(mockPOST).toHaveBeenCalledWith(
        'knowledgeService/callDomainModel/queryKnowledgeBaseViewMeta',
        {},
        {
          cancelToken: undefined,
        }
      );
    });
  });

  describe('queryKnowledgeBaseView', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { baseId: 'base1', viewType: 'table' };
      const cancelToken = new AbortController();
      queryKnowledgeBaseView(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith('knowledgeService/callDomainModel/queryKnowledgeBaseView', payload, {
        cancelToken,
      });
    });

    it('should call POST without cancelToken', () => {
      const payload = { baseId: 'base1', viewType: 'chart' };
      queryKnowledgeBaseView(payload);
      expect(mockPOST).toHaveBeenCalledWith('knowledgeService/callDomainModel/queryKnowledgeBaseView', payload, {
        cancelToken: undefined,
      });
    });
  });
});
