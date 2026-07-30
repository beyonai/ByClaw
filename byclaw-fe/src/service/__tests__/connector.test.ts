import { queryConnectorList } from '../connector';

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
});
