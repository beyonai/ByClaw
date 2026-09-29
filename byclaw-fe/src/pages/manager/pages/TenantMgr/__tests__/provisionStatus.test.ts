import { tenantProvisionDisplayStatus } from '../provisionStatus';

describe('tenant provision display status', () => {
  it('keeps internal DB and Redis stages under the provisioning label until Node confirms READY', () => {
    for (const state of ['DB_PROVIDER_READY', 'DB_ADMIN_VERIFIED', 'REDIS_PUBLISHED', 'NODE_STARTING']) {
      expect(tenantProvisionDisplayStatus(state)).toBe('开通中');
    }
    expect(tenantProvisionDisplayStatus('READY')).toBe('已开通');
  });

  it('shows only the four business statuses', () => {
    const states = ['RESERVED', 'DB_PROVIDER_READY', 'REDIS_PUBLISHED', 'READY', 'FAILED', 'UNAVAILABLE'];
    expect(new Set(states.map(tenantProvisionDisplayStatus))).toEqual(new Set(['未开通', '开通中', '已开通', '失败']));
  });
});
