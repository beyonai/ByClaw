import { useSyncExternalStore } from 'react';

export const MULTI_TENANCY_CONFIG_CODE = 'ENABLE_MULTI_TENACY';

type MultiTenancyState = { loaded: boolean; enabled: boolean };
let state: MultiTenancyState = { loaded: false, enabled: false };
const listeners = new Set<() => void>();
let revision = 0;
export const getMultiTenancyRevision = () => revision;

export const isMultiTenancyEnabled = (): boolean => state.enabled;

export const resetMultiTenancyConfig = (): void => {
  if (state.enabled) revision += 1;
  state = { loaded: false, enabled: false };
  listeners.forEach((listener) => listener());
};

/** The session config endpoint returns a code/value object; only the exact nonempty string enables tenants. */
export const setMultiTenancyConfig = (config: unknown): void => {
  const enabled =
    config !== null &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    (config as Record<string, unknown>)[MULTI_TENANCY_CONFIG_CODE] === '1';
  if (state.enabled !== enabled) revision += 1;
  state = { loaded: true, enabled };
  if (!enabled && typeof window !== 'undefined') window.sessionStorage.removeItem('BYCLAW_TAB_ENTERPRISE');
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useMultiTenancy = (): MultiTenancyState =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );
