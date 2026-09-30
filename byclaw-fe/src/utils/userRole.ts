/** 权限比较忽略角色编码大小写，不改变接口原值或各业务允许的角色范围。 */
export const hasAnyUserRole = (
  userTypes: readonly (string | null | undefined)[] | null | undefined,
  allowedRoles: readonly string[]
): boolean => {
  const allowed = allowedRoles.map((role) => role.toUpperCase());
  return (userTypes || []).some((role) => typeof role === 'string' && allowed.includes(role.toUpperCase()));
};
