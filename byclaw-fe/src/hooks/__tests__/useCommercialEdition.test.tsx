import { renderHook, waitFor } from '@testing-library/react';
import useCommercialEdition from '../useCommercialEdition';
import { getDcSystemConfig } from '@/pages/manager/service/session';

jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));

describe('commercial resource entry visibility', () => {
  it.each(['commercial', 'openSource', undefined])(
    'resolves edition %s without initially exposing entries',
    async (edition) => {
      (getDcSystemConfig as jest.Mock).mockResolvedValue({ paramValue: edition });
      const { result } = renderHook(() => useCommercialEdition());
      expect(result.current).toBe(false);
      await waitFor(() => expect(getDcSystemConfig).toHaveBeenCalledWith({ paramCode: 'BYAI_BRAND_VERSION' }));
      await waitFor(() => expect(result.current).toBe(edition === 'commercial'));
    }
  );

  it('keeps entries hidden when deployment configuration cannot be read', async () => {
    (getDcSystemConfig as jest.Mock).mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useCommercialEdition());
    await waitFor(() => expect(getDcSystemConfig).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
