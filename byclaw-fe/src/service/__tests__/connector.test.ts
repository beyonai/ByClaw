import { listConnectors } from '../connector';

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

  it('loads the current user connector catalog from the list endpoint', () => {
    listConnectors();

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/connector/listAll', {});
  });
});
