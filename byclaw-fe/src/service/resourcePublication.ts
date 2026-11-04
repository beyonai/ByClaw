import { GET, POST } from '@/service/common/request';

export interface PublishScope {
  mode: 'COMPANY' | 'ORGS';
  orgIds?: string[];
}
export interface ScopeLabel {
  orgId: string;
  orgName: string;
}
export interface ScopeOption extends ScopeLabel {
  parentOrgId: string;
}
export interface PublicationDetail {
  publication?: {
    requestId: string;
    resourceId: string;
    revision: number;
    operation: string;
    status: string;
    requestedScopeJson: string;
    reviewSnapshotJson: string;
    applicantName: string;
    createdAt: string;
  };
  targets: {
    target: ScopeLabel & { status: string; orgNameSnapshot: string; comment?: string; appliedAt?: string };
    canReview: boolean;
  }[];
  scopeMode: string;
  scopeRevision: number;
  scopeController: string;
  publishedScope: ScopeLabel[];
  canManage: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canReview: boolean;
}
const base = '/byaiService/resourcePublication';
export const scopeOptions = () => GET<ScopeOption[]>(`${base}/scopeOptions`);
export const currentPublication = (resourceId: string) => GET<PublicationDetail>(`${base}/current`, { resourceId });
export const publicationDetail = (requestId: string) => GET<PublicationDetail>(`${base}/detail`, { requestId });
export const publicationList = (params: {
  review: boolean;
  page: number;
  size: number;
  resourceBizTypeList: string[];
}) =>
  GET<{ list: PublicationDetail[]; total: number }>(`${base}/list`, {
    ...params,
    resourceBizTypeList: params.resourceBizTypeList.join(','),
  });
export const resourcePublicationCounts = () => GET<Record<string, number>>(`${base}/pendingCounts`);
export const publicationAction = (
  action: 'prepare' | 'save' | 'submit' | 'withdraw' | 'retract' | 'review',
  data: any
) => POST<PublicationDetail>(`${base}/${action}`, data);

export const scopeFromIds = (ids: string[]): PublishScope =>
  ids.includes('-1') ? { mode: 'COMPANY' } : { mode: 'ORGS', orgIds: ids };
export const validPublishScope = (scope?: PublishScope) =>
  !!scope && (scope.mode === 'COMPANY' || (scope.mode === 'ORGS' && !!scope.orgIds?.length));
export const publicationSnapshot = (detail: PublicationDetail) => {
  try {
    return JSON.parse(detail.publication?.reviewSnapshotJson || '{}') as {
      resourceName?: string;
      resourceDesc?: string;
      resourceBizType?: string;
    };
  } catch {
    return {};
  }
};
