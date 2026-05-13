jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { getDcSystemConfigValueByCodes } from '@/service/layout';
import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('manager/service/layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts payload with cancelToken when provided', () => {
    const payload = { paramCodes: ['A', 'B'] };
    const cancelToken = new AbortController();

    getDcSystemConfigValueByCodes(payload, cancelToken);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfigValueByCodes', payload, {
      cancelToken,
    });
  });

  it('posts payload with undefined cancelToken when omitted', () => {
    const payload = { paramCodes: ['A'] };

    getDcSystemConfigValueByCodes(payload);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfigValueByCodes', payload, {
      cancelToken: undefined,
    });
  });
});
