import { isMultiTenancyEnabled, setMultiTenancyConfig } from '../multiTenancy';
import { getTenantContext, hasStoredTenantSelection, selectEnterprise } from '../tenantContext';

jest.mock('@umijs/max', () => ({ getDvaApp: jest.fn() }));

beforeEach(() => {
  window.localStorage.setItem('SESSION', 'session-1');
  window.sessionStorage.clear();
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
  expect(() => selectEnterprise('123', 'token', '2099-01-01')).toThrow('Multi-tenancy is disabled');
});

it('enables tenants only for the exact configured string and clears stale scope when disabled', () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  expect(isMultiTenancyEnabled()).toBe(true);
  selectEnterprise('123', 'token', '2099-01-01');
  expect(getTenantContext()?.enterpriseId).toBe('123');
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' });
  expect(getTenantContext()).toBeNull();
  expect(hasStoredTenantSelection()).toBe(false);
  expect(window.sessionStorage.getItem('BYCLAW_TAB_ENTERPRISE')).toBeNull();
});
