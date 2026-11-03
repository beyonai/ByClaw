import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { downloadFile } from '@/utils/file';

import { PreViewFile } from './Twins';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: { size?: number }) =>
      values?.size === undefined ? id : `${id} ${values.size}`,
  }),
}));
jest.mock('@/utils/file', () => ({ downloadFile: jest.fn() }));
jest.mock('./Html', () => ({ HtmlRender: () => null }));

beforeEach(() => jest.clearAllMocks());

test.each([
  ['report.pdf', 50],
  ['report.markdown', 100],
  ['report.html', 100],
  ['movie.mp4', 100],
  ['backup.tar.gz', 100],
] as const)('%s 超过 %i MB 时提示实际限额并可下载原件', (title, limit) => {
  const file = new Blob(['preview']);
  const read = jest.fn();
  Object.defineProperties(file, {
    size: { value: limit * 1_000_000 + 1 },
    text: { value: read },
  });
  render(<PreViewFile data={file} title={title} />);
  expect(screen.getByText(`preview.tooLarge ${limit}`)).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /common\.download$/ }));
  expect(downloadFile).toHaveBeenCalledWith({ file, fileName: title });
});

test('大 HTML 默认不读取源码，切换源码页签后再读取', async () => {
  const file = new Blob(['<p>large report</p>'], { type: 'text/html' });
  const read = jest.fn().mockResolvedValue('<p>large report</p>');
  Object.defineProperties(file, { size: { value: 12_000_000 }, text: { value: read } });
  const createObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:report') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  const view = render(<PreViewFile data={file} title="report.html" />);
  try {
    const [, source] = screen.getAllByRole('radio');
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(source);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('<p>large report</p>')).toBeVisible();
  } finally {
    view.unmount();
    if (createObjectUrl) Object.defineProperty(URL, 'createObjectURL', createObjectUrl);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (revokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrl);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
});
