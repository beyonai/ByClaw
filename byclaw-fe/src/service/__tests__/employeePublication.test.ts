import { GET, POST } from '@/service/common/request';
import { history } from '@umijs/max';
import { openEmployeePublication, openOfficialEmployee, type PublicationDetail } from '../employeePublication';

jest.mock('@/service/common/request', () => ({ GET: jest.fn(), POST: jest.fn() }));
jest.mock('@umijs/max', () => ({ history: { push: jest.fn() } }));

const detail: PublicationDetail = {
  publication: {
    requestId: '100',
    sourceId: '10',
    employeeName: '员工',
    authorName: '作者',
    status: 'REJECTED',
    revision: 3,
    updatedAt: '',
    reviewerName: '审核员',
    comment: '请完善岗位描述',
  },
  employee: { resourceId: '10' },
  dependencies: [],
  canEdit: false,
  canSubmit: false,
  canReview: false,
  canWithdraw: false,
  canRevise: true,
};

describe('employee publication navigation', () => {
  beforeEach(() => {
    (GET as jest.Mock).mockReset();
    (POST as jest.Mock).mockReset();
    (history.push as jest.Mock).mockClear();
    sessionStorage.clear();
  });

  it.each(['DRAFT', 'PENDING', 'APPLYING', 'FAILED', 'REJECTED', 'WITHDRAWN', 'PUBLISHED'])(
    'reads %s without creating another draft',
    async (status) => {
      (GET as jest.Mock).mockResolvedValue({ ...detail, publication: { ...detail.publication, status } });
      await openEmployeePublication('10');
      expect(GET).toHaveBeenCalledWith('/byaiService/digitalEmployeePublication/current', { resourceId: '10' });
      expect(POST).not.toHaveBeenCalled();
      expect(history.push).toHaveBeenCalledWith(
        '/digitalEmployeesCreate?publicationId=100&appId=10&log=false&manage=false'
      );
    }
  );

  it('creates the initial draft only when there is no previous request', async () => {
    (GET as jest.Mock).mockResolvedValue(null);
    (POST as jest.Mock).mockResolvedValue(detail);
    await openEmployeePublication('10');
    expect(POST).toHaveBeenCalledWith('/byaiService/digitalEmployeePublication/prepare', { resourceId: '10' });
  });

  it('does not create a draft if reading the current result fails', async () => {
    (GET as jest.Mock).mockRejectedValue(new Error('无权访问'));
    await expect(openEmployeePublication('10')).rejects.toThrow('无权访问');
    expect(POST).not.toHaveBeenCalled();
    expect(history.push).not.toHaveBeenCalled();
  });

  it('explicit official editing still prepares an update candidate', async () => {
    (POST as jest.Mock).mockResolvedValue(detail);
    await openEmployeePublication('90', 'editOfficial');
    expect(GET).not.toHaveBeenCalled();
    expect(POST).toHaveBeenCalledWith('/byaiService/digitalEmployeePublication/prepare', { resourceId: '90' });
  });

  it('explicit personal publication update asks the server for a new candidate based on the saved personal employee', async () => {
    (POST as jest.Mock).mockResolvedValue({ ...detail, employee: { resourceId: '90', ownerType: 'enterprise' } });
    await openEmployeePublication('10', 'publishUpdate');
    expect(GET).not.toHaveBeenCalled();
    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST).toHaveBeenCalledWith('/byaiService/digitalEmployeePublication/prepareUpdate', { resourceId: '10' });
    expect(history.push).toHaveBeenCalledWith(
      '/digitalEmployeesCreate?publicationId=100&appId=90&log=false&manage=false'
    );
  });

  it('opens the published official copy in read-only mode without creating an update', () => {
    openOfficialEmployee('90');
    expect(history.push).toHaveBeenCalledWith('/digitalEmployeesCreate?appId=90&readOnly=true&log=false&manage=false');
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });
});
