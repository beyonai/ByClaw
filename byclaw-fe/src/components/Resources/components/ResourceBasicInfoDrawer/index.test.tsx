import { render, screen, waitFor } from '@testing-library/react';
import { queryResourceDetail } from '@/pages/manager/service/resources';
import ResourceBasicInfoDrawer from './index';

jest.mock('@/pages/manager/service/resources', () => ({ queryResourceDetail: jest.fn() }));

describe('resource metadata viewing', () => {
  it('loads only the basic information endpoint and shows the resource introduction', async () => {
    (queryResourceDetail as jest.Mock).mockResolvedValue({
      resourceName: '企业报表',
      resourceDesc: '整理企业报表',
      resourceBizType: 'SKILL',
      resourceCode: 'report-assistant',
      resourceVersionId: '2.0',
    });
    render(<ResourceBasicInfoDrawer resourceId="5001" onClose={jest.fn()} />);
    await waitFor(() => expect(queryResourceDetail).toHaveBeenCalledWith({ resourceId: '5001' }));
    expect(await screen.findByText('整理企业报表')).toBeInTheDocument();
    expect(screen.queryByText('下载')).not.toBeInTheDocument();
    expect(screen.queryByText('关联')).not.toBeInTheDocument();
  });
});
