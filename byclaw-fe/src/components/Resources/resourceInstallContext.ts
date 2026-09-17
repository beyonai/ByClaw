export type ResourceInstallTargetContext =
  | { mode: 'select' }
  | {
      mode: 'unavailable';
      digitalEmployeeName?: string;
    }
  | {
      mode: 'fixed';
      digitalEmployeeId: string;
      digitalEmployeeName: string;
    };

export interface ResourceCenterLocationState {
  resourceInstallContext?: {
    source?: string;
    digitalEmployeeId?: string | number;
    digitalEmployeeName?: string;
  };
}

export const resolveResourceInstallTargetContext = (state: unknown): ResourceInstallTargetContext => {
  const installContext = (state as ResourceCenterLocationState | undefined)?.resourceInstallContext;
  if (installContext?.source === 'currentEmployee') {
    if (
      installContext.digitalEmployeeId === undefined ||
      installContext.digitalEmployeeId === null ||
      `${installContext.digitalEmployeeId}` === ''
    ) {
      return {
        mode: 'unavailable',
        digitalEmployeeName: installContext.digitalEmployeeName,
      };
    }
    return {
      mode: 'fixed',
      digitalEmployeeId: `${installContext.digitalEmployeeId}`,
      digitalEmployeeName: installContext.digitalEmployeeName || `${installContext.digitalEmployeeId}`,
    };
  }
  return { mode: 'select' };
};
