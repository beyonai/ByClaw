import { render, screen, waitFor } from '@testing-library/react';
import { queryResourceDetail } from '@/pages/manager/service/resources';
import ResourceBasicInfoDrawer from './index';

jest.mock('@/pages/manager/service/resources', () => ({ queryResourceDetail: jest.fn() }));

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
  getIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
beforeEach(() => {
  mockLocale = 'zh-CN';
});

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

it('localizes metadata labels and types while retaining resource content', async () => {
  mockLocale = 'en-US';
  (queryResourceDetail as jest.Mock).mockResolvedValue({
    resourceName: '企业报表',
    resourceDesc: '原始介绍',
    resourceBizType: 'SKILL',
    resourceCode: 'report-code',
    resourceVersionId: '2.0',
  });
  render(<ResourceBasicInfoDrawer resourceId="5002" onClose={jest.fn()} />);
  expect(await screen.findByText('原始介绍')).toBeInTheDocument();
  for (const label of ['Name', 'Introduction', 'Type', 'Code', 'Version', 'Skill', 'report-code']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

it('localizes metadata loading failures', async () => {
  mockLocale = 'en-US';
  (queryResourceDetail as jest.Mock).mockRejectedValue(new Error('unavailable'));
  render(<ResourceBasicInfoDrawer resourceId="5003" onClose={jest.fn()} />);
  expect(await screen.findByText('Unable to load resource information')).toBeInTheDocument();
  expect(screen.getByText('Resource information')).toBeInTheDocument();
});
