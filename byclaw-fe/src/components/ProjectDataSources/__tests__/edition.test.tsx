import { act, renderHook, waitFor } from '@testing-library/react';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { useProjectDataSourcesEnabled } from '../useProjectDataSourcesEnabled';

jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

it('keeps data sources hidden until the open-source edition is confirmed', async () => {
  let finish!: (config: any) => void;
  jest.mocked(getDcSystemConfig).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { result } = renderHook(useProjectDataSourcesEnabled);
  expect(result.current).toBe(false);
  expect(getDcSystemConfig).toHaveBeenCalledWith({ paramCode: 'BYAI_BRAND_VERSION' });
  await act(async () => finish({ paramValue: 'openSource' }));
  expect(result.current).toBe(true);
});

it.each(['commercial', 'custom', '', undefined])('hides data sources for edition %s', async (paramValue) => {
  jest.mocked(getDcSystemConfig).mockResolvedValue({ paramValue });
  const { result } = renderHook(useProjectDataSourcesEnabled);
  await act(async () => undefined);
  expect(result.current).toBe(false);
});

it('supports the legacy nested configuration response', async () => {
  jest.mocked(getDcSystemConfig).mockResolvedValue({ data: { paramValue: 'openSource' } });
  const { result } = renderHook(useProjectDataSourcesEnabled);
  await waitFor(() => expect(result.current).toBe(true));
});

it('keeps data sources hidden if edition configuration cannot be loaded', async () => {
  jest.mocked(getDcSystemConfig).mockRejectedValue(new Error('configuration unavailable'));
  const { result } = renderHook(useProjectDataSourcesEnabled);
  await act(async () => undefined);
  expect(result.current).toBe(false);
});
