import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import EmployeeGroupMembers from '../EmployeeGroupMembers';

let mockLocale = 'en-US';
jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({ queryEmployeeGroupMemberCandidates: jest.fn() }));
jest.mock('@/pages/manager/utils/agent', () => ({ getAvatarUrl: () => '', getDefaultAgentAvatar: () => '' }));

afterEach(() => jest.restoreAllMocks());

it.each(['zh-CN', 'en-US'])('localizes missing API error messages in %s', async (locale) => {
  mockLocale = locale;
  const notify = jest.spyOn(message, 'error').mockImplementation(() => jest.fn());
  const loader = jest.fn().mockResolvedValue({ code: -1 });
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <EmployeeGroupMembers candidateLoader={loader} addText="Add member" />
    </ConfigProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: /Add member/ }));
  const intl = jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(locale);
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(intl.formatMessage({ id: 'employeeDetail.groupMember.loadFailed' }))
  );
});
