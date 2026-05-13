// 组织类型
export type OrgItem = {
  orgId: string;
  orgName: string;
  parentOrgId: string;
  pathCode: string;
  pathName?: string;
};

// 用户类型
export type UserItem = {
  userId: string;
  userName: string;
  userCode: string;
  orgId: number;
  orgName: string;
  pathName?: string;
};
