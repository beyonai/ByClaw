export type EmployeeUsePermission = {
  resourceId: string;
  hasUsePermission: boolean;
};

export const canShowEmployeeChat = (
  tab: string | null,
  resourceId: string,
  permission: EmployeeUsePermission | null
) => {
  if (tab !== 'enterprise') {
    return true;
  }

  return Boolean(permission?.resourceId === resourceId && permission.hasUsePermission);
};
