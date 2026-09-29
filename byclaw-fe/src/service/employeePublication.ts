import { GET, POST } from '@/service/common/request';
import { history } from '@umijs/max';

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
}
export const publicationStatus: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  APPLYING: '发布中',
  PUBLISHED: '已发布',
  REJECTED: '已驳回',
  WITHDRAWN: '已撤回',
  FAILED: '发布失败',
};
export const publicationEntryLabel = (status?: string) =>
  ((
    {
      DRAFT: '继续发布',
      PENDING: '查看发布进度',
      APPLYING: '查看发布进度',
      REJECTED: '查看审核结果',
      WITHDRAWN: '查看发布申请',
      FAILED: '查看发布结果',
      PUBLISHED: '查看发布结果',
    } as Record<string, string>
  )[status || ''] || '发布到官方推荐');
const base = '/byaiService/digitalEmployeePublication';
export const getPublicationPendingCount = () => GET<number>(`${base}/pendingCount`);
export const getPublicationCapabilities = () =>
  GET<{ enabled: boolean; administrator: boolean; canCreateEnterprise: boolean }>(`${base}/capabilities`);
export const getPublication = (requestId: string) => GET<PublicationDetail>(`${base}/detail`, { requestId });
export const previewPublication = (publication: Pick<Publication, 'requestId' | 'revision'>) =>
  POST<PublicationDetail>(`${base}/preview`, { requestId: publication.requestId, revision: publication.revision });
export const getCurrentPublication = (resourceId: string) =>
  GET<PublicationDetail | null>(`${base}/current`, { resourceId });
export const listPublications = (review: boolean, page = 1) =>
  GET<{ list: Publication[]; total: number }>(`${base}/list`, { review, page, size: 20 });
export const publicationAction = (
  action: 'revise' | 'save' | 'submit' | 'approve' | 'reject' | 'withdraw',
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
    throw new Error('官方副本已变化，请刷新页面后重试');
  }
  if (detail.canRevise) detail = await publicationAction('revise', detail.publication);
  if (detail.publication.status !== 'DRAFT' || !detail.canEdit) {
    throw new Error('该员工已有未完成的更新申请，请先在审核中心处理或撤回申请后再保存');
  }
  return publicationAction('save', detail.publication, { employee });
};
export const openEmployeePublication = async (resourceId: string, intent: 'view' | 'editOfficial' = 'view') => {
  const current = intent === 'view' ? await getCurrentPublication(resourceId) : null;
  const detail = current || (await POST<PublicationDetail>(`${base}/prepare`, { resourceId }));
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
