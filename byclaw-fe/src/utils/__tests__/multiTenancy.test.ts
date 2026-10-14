import {
  isMultiTenancyEnabled,
  resetMultiTenancyConfig,
  setMultiTenancyConfig,
  useMultiTenancy,
} from '../multiTenancy';
import { act, renderHook } from '@testing-library/react';

beforeEach(() => {
  window.sessionStorage.clear();
  resetMultiTenancyConfig();
});

it.each([
  null,
  undefined,
  {},
  [],
  { ENABLE_MULTI_TENACY: null },
  { ENABLE_MULTI_TENACY: '' },
  { ENABLE_MULTI_TENACY: '0' },
  { ENABLE_MULTI_TENACY: 1 },
  { ENABLE_MULTI_TENACY: ' 1 ' },
])('keeps tenants disabled for a missing, empty or nonmatching config: %p', (config) => {
  setMultiTenancyConfig(config);
  expect(isMultiTenancyEnabled()).toBe(false);
});

it('publishes loaded and enabled config state without modifying legacy tab storage', () => {
  window.sessionStorage.setItem('BYCLAW_TAB_ENTERPRISE', 'legacy-selection');
  const { result } = renderHook(() => useMultiTenancy());
  expect(result.current).toEqual({ loaded: false, enabled: false });
  act(() => setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' }));
  expect(isMultiTenancyEnabled()).toBe(true);
  expect(result.current).toEqual({ loaded: true, enabled: true });
  act(() => setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' }));
  expect(isMultiTenancyEnabled()).toBe(false);
  expect(result.current).toEqual({ loaded: true, enabled: false });
  expect(window.sessionStorage.getItem('BYCLAW_TAB_ENTERPRISE')).toBe('legacy-selection');
  act(() => resetMultiTenancyConfig());
  expect(result.current).toEqual({ loaded: false, enabled: false });
  expect(window.sessionStorage.getItem('BYCLAW_TAB_ENTERPRISE')).toBe('legacy-selection');
});
