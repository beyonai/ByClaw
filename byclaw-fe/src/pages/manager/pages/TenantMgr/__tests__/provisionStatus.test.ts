import { shouldPollTenantProvision, tenantProvisionDisplayStatus, tenantProvisionSteps } from '../provisionStatus';

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
  it('keeps manual recovery distinct and stops polling paused commands', () => {
    expect(tenantProvisionDisplayStatus('MANUAL_REQUIRED')).toBe('MANUAL_REQUIRED');
    expect(shouldPollTenantProvision('MANUAL_REQUIRED')).toBe(false);
    expect(shouldPollTenantProvision('RUNNING')).toBe(true);
    expect(shouldPollTenantProvision('PENDING')).toBe(true);
  });

  it.each([
    ['DB_CREATE', ['done', 'paused', 'pending', 'pending']],
    ['DB_PROBE', ['done', 'paused', 'pending', 'pending']],
    ['CONFIG_PUBLISH', ['done', 'done', 'paused', 'pending']],
    ['NODE_CREATE', ['done', 'done', 'paused', 'pending']],
    ['SCHEMA_INIT', ['done', 'done', 'done', 'paused']],
    ['READY_PUBLISH', ['done', 'done', 'done', 'paused']],
  ])('shows the paused command stage %s without a loading step', (stage, expected) => {
    expect(tenantProvisionSteps('MANUAL_REQUIRED', stage as string)).toEqual(expected);
  });

  it('uses the command stage while a recovered command is running', () => {
    expect(tenantProvisionSteps('RUNNING', 'NODE_CREATE')).toEqual(['done', 'done', 'active', 'pending']);
  });

});
