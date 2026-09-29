const STORAGE_KEY = 'BYCLAW_TAB_ENTERPRISE';

type StoredTenant = {
  enterpriseId: string;
  sessionId: string;
};

let switchSeq = 0;

export const getTenantSwitchSeq = () => switchSeq;

export const getSelectedEnterpriseId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const selected = JSON.parse(raw) as StoredTenant;
    if (
      !/^[1-9][0-9]*$/.test(selected.enterpriseId) ||
      !selected.sessionId ||
      selected.sessionId !== window.localStorage.getItem('SESSION')
    ) {
      return null;
    }
    return selected.enterpriseId;
  } catch {
    return null;
  }
};

export const selectEnterprise = (enterpriseId: string): void => {
  if (typeof window === 'undefined' || !/^[1-9][0-9]*$/.test(enterpriseId)) {
    throw new Error('Invalid enterprise ID');
  }
  const sessionId = window.localStorage.getItem('SESSION');
  if (!sessionId) throw new Error('Login session is required');
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ enterpriseId, sessionId }));
  switchSeq += 1;
};

export const clearSelectedEnterprise = (): void => {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY);
  switchSeq += 1;
};
