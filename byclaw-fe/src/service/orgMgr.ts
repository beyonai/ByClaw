import { POST } from '@/service/common/request';

// 查询全部组织
export async function getOrgTree(params: any) {
  return POST<any>('/byaiService/system/organization/getOrgTree', {
    ...params,
  });
}

export interface OrganizationMember {
  userId: string;
  userName: string;
  administrator: boolean;
}
export const getOrganizationAdministrators = (orgId: string | number) =>
  POST<OrganizationMember[]>(
    '/byaiService/system/organization/administrators',
    { orgId },
    {
      responseCfg: { hideErrorTips: true },
    }
  );

export interface AdministratorContext {
  orgId?: string | number;
  parentOrgId?: string | number;
}

export interface AdministratorOrganization {
  orgId: string | number;
  orgName: string;
  parentOrgId: string | number;
}

export const getAdministratorOrganizations = (context: AdministratorContext) =>
  POST<AdministratorOrganization[]>('/byaiService/system/organization/administratorOrganizations', context, {
    responseCfg: { hideErrorTips: true },
  });

export const getAdministratorCandidates = (context: AdministratorContext, memberOrgId: string | number) =>
  POST<OrganizationMember[]>(
    '/byaiService/system/organization/administratorCandidates',
    { ...context, memberOrgId },
    {
      responseCfg: { hideErrorTips: true },
    }
  );
