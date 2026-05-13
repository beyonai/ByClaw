import { bathQryPropertyKey, getDcSystemConfigListByStandType } from '../system';

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('System Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bathQryPropertyKey requests system properties in batch', () => {
    const payload = { keys: ['a', 'b'] };

    bathQryPropertyKey(payload);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/property/bathQryPropertyKey', payload);
  });

  it('getDcSystemConfigListByStandType forwards standType and config', () => {
    const config = {
      timeout: 1000,
    };

    getDcSystemConfigListByStandType('voice', config);

    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/system/staticdata/getDcSystemConfigListByStandType',
      {
        standType: 'voice',
      },
      config
    );
  });
});
