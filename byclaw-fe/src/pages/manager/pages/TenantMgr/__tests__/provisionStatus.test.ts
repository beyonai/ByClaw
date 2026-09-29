import { tenantProvisionDisplayStatus, tenantProvisionSteps } from '../provisionStatus';

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

  it('shows tenant deletion progress separately from provisioning', () => {
    expect(tenantProvisionDisplayStatus('DELETING')).toBe('删除中');
    expect(tenantProvisionDisplayStatus('DELETE_FAILED')).toBe('删除失败');
  });

  it('shows the matching stage for Node startup, schema initialization, and failure', () => {
    expect(tenantProvisionSteps('NODE_CREATING')).toEqual(['done', 'done', 'active', 'pending']);
    expect(tenantProvisionSteps('SCHEMA_INIT')).toEqual(['done', 'done', 'done', 'active']);
    expect(tenantProvisionSteps('FAILED', 'DB_PROVIDER_READY')).toEqual(['done', 'failed', 'pending', 'pending']);
    expect(tenantProvisionSteps('READY')).toEqual(['done', 'done', 'done', 'done']);
  });
});
