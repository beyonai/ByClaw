import { getMultiTenancyRevision, isMultiTenancyEnabled } from './multiTenancy';
import { getRuntimeActualUrl } from './index';

const STORAGE_KEY = 'BYCLAW_TAB_ENTERPRISE';

type StoredTenant = {
  enterpriseId: string;
  sessionId: string;
  tenantContextToken: string;
  expiresAt: string;
};

let switchSeq = 0;

export const getTenantSwitchSeq = () => switchSeq + getMultiTenancyRevision();

export const hasStoredTenantSelection = (): boolean =>
  isMultiTenancyEnabled() && typeof window !== 'undefined' && window.sessionStorage.getItem(STORAGE_KEY) !== null;

export const getTenantContext = (): StoredTenant | null => {
  if (!isMultiTenancyEnabled() || typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const selected = JSON.parse(raw) as StoredTenant;
    if (
      !/^[1-9][0-9]*$/.test(selected.enterpriseId) ||
      !selected.sessionId ||
      selected.sessionId !== window.localStorage.getItem('SESSION') ||
      !selected.tenantContextToken ||
      !selected.expiresAt ||
      !Number.isFinite(Date.parse(selected.expiresAt)) ||
      Date.parse(selected.expiresAt) <= Date.now()
    ) {
      return null;
    }
    return selected;
  } catch {
    return null;
  }
};

export const getSelectedEnterpriseId = (): string | null => getTenantContext()?.enterpriseId ?? null;

export const selectEnterprise = (enterpriseId: string, tenantContextToken: string, expiresAt: string): void => {
  if (!isMultiTenancyEnabled()) throw new Error('Multi-tenancy is disabled');
  if (typeof window === 'undefined' || !/^[1-9][0-9]*$/.test(enterpriseId)) {
    throw new Error('Invalid enterprise ID');
  }
  if (!tenantContextToken || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    throw new Error('Invalid tenant context');
  }
  const sessionId = window.localStorage.getItem('SESSION');
  if (!sessionId) throw new Error('Login session is required');
  const previous = getTenantContext();
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ enterpriseId, sessionId, tenantContextToken, expiresAt })
  );
  if (previous?.enterpriseId !== enterpriseId || previous.sessionId !== sessionId) switchSeq += 1;
};

export const clearSelectedEnterprise = (): void => {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY);
  switchSeq += 1;
};

/** A fresh chat mount discards every session, message, project and realtime cache from the prior space. */
export const reloadChatForSpaceSwitch = (): void => {
  if (typeof window !== 'undefined') window.location.assign(getRuntimeActualUrl('/chat'));
};
