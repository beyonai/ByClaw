import type { Publication } from '@/service/employeePublication';

interface ScopeMessage {
  messageId: string;
  values: { orgNames: string };
}

interface PublicationPresentation {
  status: string;
  scopeMessage?: ScopeMessage;
}

interface ApprovalFeedback {
  kind: 'success' | 'error' | 'info';
  messageId: string;
  values?: { orgNames: string };
  error?: string;
}

function approvedOrganizations(publication: Publication) {
  return (publication.targets || []).filter((target) => target.status === 'APPROVED' && target.orgId !== '-1');
}

/** 展示当前可见范围的结果，不修改整笔申请的流程状态或其他组织的审核状态。 */
export function publicationPresentation(publication: Publication): PublicationPresentation {
  const approved = approvedOrganizations(publication);
  if (!approved.length) return { status: publication.status };
  const values = { orgNames: approved.map((target) => target.orgName).join('、') };
  const allApproved = (publication.targets || []).every((target) => target.status === 'APPROVED');
  if (publication.scopeUpdate && publication.status === 'PENDING' && allApproved) {
    return { status: 'APPROVED', scopeMessage: { messageId: 'employeePublication.audience.updateApproved', values } };
  }
  // 首次发布的企业副本在配置和已批准范围落地后才写回 officialId；共享更新还须等待整笔发布完成。
  const published = publication.officialId && (!publication.scopeUpdate || publication.status === 'PUBLISHED');
  if (published && ['PENDING', 'PUBLISHED', 'REJECTED'].includes(publication.status)) {
    return {
      status: allApproved ? 'PUBLISHED' : 'PARTIALLY_PUBLISHED',
      scopeMessage: {
        messageId: allApproved
          ? 'employeePublication.audience.organizationPublished'
          : 'employeePublication.audience.partiallyPublished',
        values,
      },
    };
  }
  return { status: publication.status };
}

export function publicationApprovalFeedback(publication: Publication): ApprovalFeedback {
  if (publication.status === 'FAILED') {
    return { kind: 'error', messageId: 'employeePublication.publishFailedRetry', error: publication.publishError };
  }
  const presentation = publicationPresentation(publication);
  if (presentation.scopeMessage) return { kind: 'success', ...presentation.scopeMessage };
  if (publication.scopeUpdate && publication.status === 'PENDING') {
    const approved = approvedOrganizations(publication);
    if (approved.length) {
      return {
        kind: 'success',
        messageId: 'employeePublication.audience.updateApproved',
        values: { orgNames: approved.map((target) => target.orgName).join('、') },
      };
    }
  }
  if (publication.status === 'PUBLISHED')
    return { kind: 'success', messageId: 'employeePublication.approvedAndPublished' };
  if (['PENDING', 'APPLYING'].includes(publication.status)) {
    return { kind: 'info', messageId: `employeePublication.status.${publication.status}` };
  }
  return { kind: 'error', messageId: 'employeePublication.publishFailedRetry', error: publication.publishError };
}
