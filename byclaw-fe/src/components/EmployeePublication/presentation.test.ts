import type { Publication } from '@/service/employeePublication';
import { publicationApprovalFeedback, publicationPresentation } from './presentation';

const regional: Publication = {
  requestId: '100',
  sourceId: '10',
  officialId: '90',
  employeeName: '员工',
  authorName: '作者',
  status: 'PENDING',
  revision: 3,
  updatedAt: '',
  targets: [{ orgId: '10', orgName: '研发中心', status: 'APPROVED' }],
};

it('shows the published visible organization without changing the overall request status', () => {
  const snapshot = JSON.stringify(regional);
  expect(publicationPresentation(regional)).toEqual({
    status: 'PUBLISHED',
    scopeMessage: { messageId: 'employeePublication.audience.organizationPublished', values: { orgNames: '研发中心' } },
  });
  expect(publicationApprovalFeedback(regional)).toMatchObject({ kind: 'success', values: { orgNames: '研发中心' } });
  expect(JSON.stringify(regional)).toBe(snapshot);
});

it('keeps the other visible pending organization pending while showing partial publication', () => {
  const publication: Publication = {
    ...regional,
    targets: [...regional.targets!, { orgId: '20', orgName: '销售中心', status: 'PENDING' }],
  };
  expect(publicationPresentation(publication)).toMatchObject({
    status: 'PARTIALLY_PUBLISHED',
    scopeMessage: { values: { orgNames: '研发中心' } },
  });
  expect(publication.targets![1].status).toBe('PENDING');
});

it('does not equate an approved organization with a completed enterprise copy', () => {
  const publication = { ...regional, officialId: undefined };
  expect(publicationPresentation(publication)).toEqual({ status: 'PENDING' });
  expect(publicationApprovalFeedback(publication).kind).toBe('info');
});

it('does not announce a shared version update as published before every organization approves', () => {
  const publication = { ...regional, scopeUpdate: true };
  expect(publicationPresentation(publication)).toMatchObject({
    status: 'APPROVED',
    scopeMessage: { messageId: 'employeePublication.audience.updateApproved' },
  });
  expect(publicationApprovalFeedback(publication).messageId).toBe('employeePublication.audience.updateApproved');
  expect(publicationPresentation({ ...publication, status: 'PUBLISHED' }).status).toBe('PUBLISHED');
});

it.each(['FAILED', 'APPLYING', 'DRAFT', 'WITHDRAWN'])('retains the actual execution state %s', (status) => {
  expect(publicationPresentation({ ...regional, status })).toEqual({ status });
});

it('reports a failed execution even when an older enterprise copy exists', () => {
  expect(publicationApprovalFeedback({ ...regional, status: 'FAILED', publishError: '技能复制失败' })).toMatchObject({
    kind: 'error',
    error: '技能复制失败',
  });
});

it('keeps the existing whole-company and legacy publication feedback', () => {
  const publication: Publication = {
    ...regional,
    status: 'PUBLISHED',
    targets: [{ orgId: '-1', orgName: '全公司', status: 'APPROVED' }],
  };
  expect(publicationPresentation(publication)).toEqual({ status: 'PUBLISHED' });
  expect(publicationApprovalFeedback(publication)).toEqual({
    kind: 'success',
    messageId: 'employeePublication.approvedAndPublished',
  });
});
