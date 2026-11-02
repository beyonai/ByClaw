import { act, fireEvent, render, screen } from '@testing-library/react';
import DetailDrawer from './DetailDrawer';
import { downloadFile } from '@/service/workSpace';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id }),
  getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/components/Markdown', () => () => null);
jest.mock('@/components/ReferenceSource', () => ({ RenderSourceIcon: () => null }));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/workSpace', () => ({ downloadFile: jest.fn() }));
jest.mock('@/utils/file', () => ({ downloadFile: jest.fn(), getFileUrl: (url: string) => url }));
jest.mock('@/service/file', () => ({
  downloadResourceFile: jest.fn(),
  normalizeDatasetDirectoryPath: (value: string) => value,
}));
jest.mock('@/components/Preview/Twins', () => ({
  PreViewFile: ({ data, type }: any) => (
    <div data-testid="shared-preview">
      {type}:{data.name}
    </div>
  ),
}));

beforeEach(() => jest.clearAllMocks());

it('opens legacy Excel through the same shared renderer as message attachments', async () => {
  (downloadFile as jest.Mock).mockResolvedValue({ file: new Blob(['data']), fileName: 'data.xls' });
  render(<DetailDrawer drawerOpen detailInfo={{ title: 'data.xls', documentId: 1 }} setShowDetail={() => {}} />);
  fireEvent.click(screen.getByText('sourceDrawer.filePreview'));
  expect(await screen.findByTestId('shared-preview')).toHaveTextContent('xls:data.xls');
});

it('can reopen after cancellation and never replaces the new preview with an aborted result', async () => {
  let finish: (file: any) => void = () => {};
  (downloadFile as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({ file: new Blob(['new']), fileName: 'new.xls' });
  render(<DetailDrawer drawerOpen detailInfo={{ title: 'data.xls', documentId: 1 }} setShowDetail={() => {}} />);
  fireEvent.click(screen.getByText('sourceDrawer.filePreview'));
  const request = (downloadFile as jest.Mock).mock.calls[0][1].cancelToken;
  expect(request).toBeInstanceOf(AbortController);
  fireEvent.click(screen.getByText('sourceDrawer.referenceDetails (0)'));
  expect(request.signal.aborted).toBe(true);
  fireEvent.click(screen.getByText('sourceDrawer.filePreview'));
  expect(await screen.findByTestId('shared-preview')).toHaveTextContent('new.xls');
  await act(async () => finish({ file: new Blob(['old']), fileName: 'old.xls' }));
  expect(screen.getByTestId('shared-preview')).toHaveTextContent('new.xls');
});
