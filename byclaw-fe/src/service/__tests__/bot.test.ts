import { logged } from '../bot';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
}));

import { GET } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;

describe('Bot Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logged', () => {
    it('should call GET with correct endpoint and payload', () => {
      const payload = { userId: 'user123', botId: 'bot456' };

      logged(payload);

      expect(mockGET).toHaveBeenCalledWith('/api/bote/logged', payload);
    });

    it('should call GET with empty payload', () => {
      logged({});

      expect(mockGET).toHaveBeenCalledWith('/api/bote/logged', {});
    });

    it('should return the result from GET', () => {
      const mockResult = { success: true, data: 'test' };
      mockGET.mockReturnValue(mockResult as any);

      const result = logged({ userId: 'user123' });

      expect(result).toBe(mockResult);
    });
  });
});
