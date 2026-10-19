import { tenantProvisionDisplayStatus, tenantProvisionSteps } from '../provisionStatus';

describe('tenant provision display status', () => {
  it('keeps internal DB and Redis stages under the provisioning label until Node confirms READY', () => {
    for (const state of ['DB_PROVIDER_READY', 'DB_ADMIN_VERIFIED', 'REDIS_PUBLISHED', 'NODE_STARTING']) {
      expect(tenantProvisionDisplayStatus(state)).toBe('PROVISIONING');
    }
    expect(tenantProvisionDisplayStatus('READY')).toBe('READY');
  });

  it('shows only the four business statuses', () => {
    const states = ['RESERVED', 'DB_PROVIDER_READY', 'REDIS_PUBLISHED', 'READY', 'FAILED', 'UNAVAILABLE'];
    expect(new Set(states.map(tenantProvisionDisplayStatus))).toEqual(
      new Set(['RESERVED', 'PROVISIONING', 'READY', 'FAILED'])
    );
  });

  it('shows tenant deletion progress separately from provisioning', () => {
    expect(tenantProvisionDisplayStatus('DELETING')).toBe('DELETING');
    expect(tenantProvisionDisplayStatus('DELETE_FAILED')).toBe('DELETE_FAILED');
  });

  it('shows the matching stage for Node startup, schema initialization, and failure', () => {
    expect(tenantProvisionSteps('NODE_CREATING')).toEqual(['done', 'done', 'active', 'pending']);
    expect(tenantProvisionSteps('SCHEMA_INIT')).toEqual(['done', 'done', 'done', 'active']);
    expect(tenantProvisionSteps('FAILED', 'DB_PROVIDER_READY')).toEqual(['done', 'failed', 'pending', 'pending']);
    expect(tenantProvisionSteps('READY')).toEqual(['done', 'done', 'done', 'done']);
  });
});
