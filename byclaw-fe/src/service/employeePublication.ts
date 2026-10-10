import { GET, POST } from '@/service/common/request';
import { getIntl, history } from '@umijs/max';

export interface Publication {
  requestId: string;
  sourceId: string;
  officialId?: string;
  employeeName: string;
  authorName: string;
  status: string;
  revision: number;
  updatedAt: string;
  reviewerName?: string;
  reviewedAt?: string;
  comment?: string;
  publishError?: string;
  canReview?: boolean;
  requiresAdminVipReview?: boolean;
}
export interface PublicationDependency {
  resourceId: string;
  name: string;
  action: string;
  error?: string;
  warning?: string;
  resourceType?: string;
  availabilityScope?: string;
  reason?: string;
  impact?: string;
}
export interface PublicationDetail {
  publication: Publication;
  employee: any;
  dependencies: PublicationDependency[];
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canWithdraw: boolean;
  canRevise?: boolean;
  previousReview?: { requestId: string; reviewerName?: string; reviewedAt?: string; comment?: string };
  updateTarget?: { resourceId: string; name: string; fromPersonal: boolean; changed: boolean };
  sourceResourcesChanged?: boolean;
}
// 保持既有状态表接口；每次取值时使用当前语言，避免切换语言后状态文案仍为中文。
export const publicationStatus: Record<string, string> = {
  get DRAFT() {
    return getIntl().formatMessage({ id: 'employeePublication.status.DRAFT' });
  },
  get PENDING() {
    return getIntl().formatMessage({ id: 'employeePublication.status.PENDING' });
  },
  get APPLYING() {
    return getIntl().formatMessage({ id: 'employeePublication.status.APPLYING' });
  },
  get PUBLISHED() {
    return getIntl().formatMessage({ id: 'employeePublication.status.PUBLISHED' });
  },
  get REJECTED() {
    return getIntl().formatMessage({ id: 'employeePublication.status.REJECTED' });
  },
  get WITHDRAWN() {
    return getIntl().formatMessage({ id: 'employeePublication.status.WITHDRAWN' });
  },
  get FAILED() {
    return getIntl().formatMessage({ id: 'employeePublication.status.FAILED' });
  },
};

export const publicationEntryLabel = (status?: string, updating = false) => {
  const updateMessageIds: Record<string, string> = {
    DRAFT: 'employeePublication.entry.continueUpdate',
    PENDING: 'employeePublication.entry.updateProgress',
    APPLYING: 'employeePublication.entry.updateProgress',
  };
  const messageIds: Record<string, string> = {
    DRAFT: 'employeePublication.entry.continuePublish',
    PENDING: 'employeePublication.entry.progress',
    APPLYING: 'employeePublication.entry.progress',
    REJECTED: 'employeePublication.entry.reviewResult',
    WITHDRAWN: 'employeePublication.entry.application',
    FAILED: 'employeePublication.entry.result',
    PUBLISHED: 'employeePublication.toolbar.publishUpdate',
  };
  // 数字员工与技能共用企业发布文案，避免不同入口的名称不一致。
  return getIntl().formatMessage({
    id: (updating && updateMessageIds[status || '']) || messageIds[status || ''] || 'resource.publishToEnterprise',
  });
};
const base = '/byaiService/digitalEmployeePublication';
export const getPublicationPendingCount = () => GET<number>(`${base}/pendingCount`);
export const getPublicationCapabilities = () =>
  GET<{ enabled: boolean; administrator: boolean; canCreateEnterprise: boolean }>(`${base}/capabilities`);
export const getPublication = (requestId: string) => GET<PublicationDetail>(`${base}/detail`, { requestId });

/** 统一页面加载入口：只同步个人来源的未提交草稿，历史申请保持原快照。 */
export const openPublication = (requestId: string) => POST<PublicationDetail>(`${base}/open`, { requestId });
export const previewPublication = (publication: Pick<Publication, 'requestId' | 'revision'>) =>
  POST<PublicationDetail>(`${base}/preview`, { requestId: publication.requestId, revision: publication.revision });
export const getCurrentPublication = (resourceId: string) =>
  GET<PublicationDetail | null>(`${base}/current`, { resourceId });
export const listPublications = (review: boolean, page = 1) =>
  GET<{ list: Publication[]; total: number }>(`${base}/list`, { review, page, size: 20 });
export const publicationAction = (
  action: 'revise' | 'save' | 'submit' | 'approve' | 'reject' | 'withdraw' | 'refreshTarget',
  publication: Pick<Publication, 'requestId' | 'revision'>,
  extra: { employee?: any; comment?: string } = {}
) =>
  POST<PublicationDetail>(`${base}/${action}`, {
    requestId: publication.requestId,
    revision: publication.revision,
    ...extra,
  });
export const publicationUrl = (detail: PublicationDetail) =>
  `/digitalEmployeesCreate?publicationId=${detail.publication.requestId}&appId=${detail.employee.resourceId}&log=false&manage=false`;
export const preparePublication = (resourceId: string) => POST<PublicationDetail>(`${base}/prepare`, { resourceId });

/** 普通编辑页只在保存时建立更新草稿，进入页面本身不会产生申请。 */
export const saveOfficialUpdateDraft = async (resourceId: string, employee: any) => {
  let detail = await preparePublication(resourceId);
  if (String(detail.publication.officialId) !== String(resourceId)) {
    throw new Error(getIntl().formatMessage({ id: 'employeePublication.officialChanged' }));
  }
  if (detail.canRevise) detail = await publicationAction('revise', detail.publication);
  if (detail.publication.status !== 'DRAFT' || !detail.canEdit) {
    throw new Error(getIntl().formatMessage({ id: 'approvalCenter.employeeUpdateUnfinished' }));
  }
  return publicationAction('save', detail.publication, { employee });
};
export const openEmployeePublication = async (
  resourceId: string,
  intent: 'view' | 'editOfficial' | 'publishUpdate' = 'view'
) => {
  const current = intent === 'view' ? await getCurrentPublication(resourceId) : null;
  const detail =
    current ||
    (await POST<PublicationDetail>(`${base}/${intent === 'publishUpdate' ? 'prepareUpdate' : 'prepare'}`, {
      resourceId,
    }));
  sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
  history.push(publicationUrl(detail));
};

export const openOfficialEmployee = (resourceId: string) => {
  sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
  history.push(`/digitalEmployeesCreate?appId=${resourceId}&readOnly=true&log=false&manage=false`);
};

export const downloadPublicationSkill = async (requestId: string, resourceId: string) => {
  const data = await GET<Blob>(`${base}/skillSnapshot`, { requestId, resourceId }, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `skill-${resourceId}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
