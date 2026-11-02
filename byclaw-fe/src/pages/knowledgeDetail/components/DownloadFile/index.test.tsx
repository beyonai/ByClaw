import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { downloadResourceFile } from '@/service/file';
import DownloadFile from '.';

let mockLocale = 'en-US';
const mockError = jest.fn();
jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
jest.mock('@/service/file', () => ({ downloadResourceFile: jest.fn() }));
jest.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: mockError } }) },
  Button: ({ children, onClick }: any) => <button type="button" onClick={onClick}>{children}</button>,
  Modal: ({ open, onOk, okText }: any) => (open ? <button type="button" onClick={onOk}>{okText}</button> : null),
}));

it.each(['zh-CN', 'en-US'])('localizes invalid download responses in %s', async (locale) => {
  mockLocale = locale;
  mockError.mockClear();
  (downloadResourceFile as jest.Mock).mockResolvedValue({ file: null });
  const intl = jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(locale);
  render(<DownloadFile resourceId="9007199254740993" />);
  fireEvent.click(screen.getByText(intl.formatMessage({ id: 'knowledgeDetail.downloadFile' })));
  fireEvent.click(screen.getByText(intl.formatMessage({ id: 'common.confirm' })));
  await waitFor(() =>
    expect(mockError).toHaveBeenCalledWith(intl.formatMessage({ id: 'knowledgeDetail.downloadFailed' }))
  );
  expect(downloadResourceFile).toHaveBeenCalledWith({ resourceId: '9007199254740993', directoryPath: '/' });
});
