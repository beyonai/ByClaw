/** 个人员工保存始终走普通编辑；审核标记只能用于明确的企业发布副本。 */
export function requiresOfficialUpdateReview(employee: {
  ownerType?: string;
  operationPermissions?: { officialPublication?: boolean; officialUpdateRequiresReview?: boolean };
}) {
  return (
    employee.ownerType === 'enterprise' &&
    employee.operationPermissions?.officialPublication === true &&
    employee.operationPermissions?.officialUpdateRequiresReview === true
  );
}
