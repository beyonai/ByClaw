import { queryAllConnectors, queryConnectorList } from '../connector';

jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('connector service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the connector catalog with pagination from the list endpoint', () => {
    const query = { pageNum: 1, pageSize: 100, keyword: '' };
    queryConnectorList(query);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/connector/listAll', query);
  });

  it('loads every connector page and removes duplicate connector ids', async () => {
    mockPOST
      .mockResolvedValueOnce({
        list: [
          {
            connectorCode: 'dingtalk',
            connectorId: 1,
            connectorName: '钉钉',
            connectorType: 'SYSTEM',
            description: '',
            enableFlag: 'Y',
          },
        ],
        pageNum: 1,
        pageSize: 100,
        total: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        list: [
          {
            connectorCode: 'dingtalk',
            connectorId: 1,
            connectorName: '钉钉',
            connectorType: 'SYSTEM',
            description: '',
            enableFlag: 'Y',
          },
          {
            connectorCode: 'wecom',
            connectorId: 2,
            connectorName: '企业微信',
            connectorType: 'SYSTEM',
            description: '',
            enableFlag: 'N',
          },
        ],
        pageNum: 2,
        pageSize: 100,
        total: 2,
        totalPages: 2,
      });

    await expect(queryAllConnectors()).resolves.toEqual([
      expect.objectContaining({ connectorId: 1 }),
      expect.objectContaining({ connectorId: 2 }),
    ]);
    expect(mockPOST).toHaveBeenNthCalledWith(1, '/byaiService/connector/listAll', {
      pageNum: 1,
      pageSize: 100,
      keyword: '',
    });
    expect(mockPOST).toHaveBeenNthCalledWith(2, '/byaiService/connector/listAll', {
      pageNum: 2,
      pageSize: 100,
      keyword: '',
    });
  });
});
