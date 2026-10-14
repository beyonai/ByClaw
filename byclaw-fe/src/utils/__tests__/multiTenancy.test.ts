import { isMultiTenancyEnabled, resetMultiTenancyConfig, setMultiTenancyConfig } from '../multiTenancy';

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

it('enables tenants only for the exact configured string', () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  expect(isMultiTenancyEnabled()).toBe(true);
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' });
  expect(isMultiTenancyEnabled()).toBe(false);
});

it('leaves unrelated session storage unchanged when disabling or resetting the configuration', () => {
  window.sessionStorage.setItem('BYCLAW_TAB_ENTERPRISE', 'unrelated-session-data');
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  setMultiTenancyConfig(null);
  expect(window.sessionStorage.getItem('BYCLAW_TAB_ENTERPRISE')).toBe('unrelated-session-data');
  resetMultiTenancyConfig();
  expect(window.sessionStorage.getItem('BYCLAW_TAB_ENTERPRISE')).toBe('unrelated-session-data');
});
