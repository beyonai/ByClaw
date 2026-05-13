import { generateFixedMemory, removeFixedMemory, saveFixedMemory, selectFixedMemoryByQo } from '../memory';

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Memory Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generateFixedMemory calls POST with cancel token', () => {
    const payload = { content: 'memory' };
    const abortController = new AbortController();

    generateFixedMemory(payload, abortController);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/generateFixedMemory', payload, {
      cancelToken: abortController,
    });
  });

  it('saveFixedMemory calls POST with optional cancel token', () => {
    const payload = { id: 'm1' };
    const abortController = new AbortController();

    saveFixedMemory(payload, abortController);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/saveFixedMemory', payload, {
      cancelToken: abortController,
    });
  });

  it('selectFixedMemoryByQo calls POST with query payload', () => {
    const payload = { pageNum: 1 };

    selectFixedMemoryByQo(payload);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/selectFixedMemoryByQo', payload, {
      cancelToken: undefined,
    });
  });

  it('removeFixedMemory calls POST with delete payload', () => {
    const payload = { id: 'm1' };

    removeFixedMemory(payload);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/removeFixedMemory', payload, {
      cancelToken: undefined,
    });
  });
});
