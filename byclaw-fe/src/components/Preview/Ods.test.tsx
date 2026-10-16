import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import Ods from './Ods';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import type { OdsSheet } from './odsTypes';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

const blob = () => {
  const data = new Blob(['ods']);
  Object.defineProperty(data, 'arrayBuffer', { value: jest.fn(async () => new ArrayBuffer(4)) });
  return data;
};
const sheet = (name: string, rows: string[][], truncated = false): OdsSheet => ({
  name,
  rows,
  columnCount: Math.max(0, ...rows.map((row) => row.length)),
  truncated,
});
const panel = (data: Blob) => (
  <ConfigProvider virtual={false} theme={{ token: { motion: false } }}>
    <Ods data={data} />
  </ConfigProvider>
);

describe('ODS worksheet preview', () => {
  let worker: { request: jest.Mock; dispose: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    worker = { request: jest.fn().mockResolvedValue([sheet('数据', [['值']])]), dispose: jest.fn() };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
  });

  it('paginates saved rows and resets to page one when selecting another worksheet', async () => {
    worker.request.mockResolvedValue([
      sheet(
        '统计',
        Array.from({ length: 51 }, (_, index) => [`row-${index + 1}`])
      ),
      sheet('明细', [['second-sheet']], true),
    ]);
    render(panel(blob()));
    expect(await screen.findByText('row-1')).toBeVisible();
    expect(screen.queryByText('row-51')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Next Page'));
    expect(screen.getByText('row-51')).toBeVisible();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'fileRender.odsWorksheet' }));
    fireEvent.click(await screen.findByText('明细'));
    expect(await screen.findByText('second-sheet')).toBeVisible();
    expect(screen.queryByText('row-51')).not.toBeInTheDocument();
    expect(screen.getByText('fileRender.odsTruncated')).toBeVisible();
    expect(worker.dispose).toHaveBeenCalled();
  });

  it('renders values and formulas as inert text and labels wide columns', async () => {
    worker.request.mockResolvedValue([
      sheet('数据', [
        Array.from({ length: 28 }, (_, index) => (index === 0 ? '<img src=x onerror=alert(1)>' : '=1+1')),
      ]),
    ]);
    const { container } = render(panel(blob()));
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(screen.getAllByText('=1+1')).toHaveLength(27);
    expect(screen.getByRole('columnheader', { name: 'AB' })).toBeVisible();
    expect(container.querySelector('td img')).toBeNull();
    expect(screen.getByText('fileRender.odsNotice')).toBeVisible();
    expect(worker.request).toHaveBeenCalledWith('readOds', { buffer: expect.any(ArrayBuffer) }, [
      expect.any(ArrayBuffer),
    ]);
  });

  it('disposes the old worker and ignores its response after switching files', async () => {
    let resolveOld!: (value: OdsSheet[]) => void;
    worker.request.mockImplementation(
      () =>
        new Promise<OdsSheet[]>((resolve) => {
          resolveOld = resolve;
        })
    );
    const { rerender, unmount } = render(panel(blob()));
    await waitFor(() => expect(worker.request).toHaveBeenCalled());
    const oldWorker = worker;
    worker = { request: jest.fn().mockResolvedValue([sheet('new', [['new-data']])]), dispose: jest.fn() };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
    rerender(panel(blob()));
    expect(await screen.findByText('new-data')).toBeVisible();
    await act(async () => resolveOld([sheet('old', [['old-data']])]));
    expect(screen.queryByText('old-data')).not.toBeInTheDocument();
    expect(oldWorker.dispose).toHaveBeenCalled();
    unmount();
    expect(worker.dispose).toHaveBeenCalled();
  });

  it.each([
    ['limit', 'fileRender.odsLimit'],
    ['timeout', 'fileRender.binaryTimeout'],
    ['invalid', 'fileRender.odsFailed'],
  ] as const)('shows the %s failure and releases the worker', async (code, message) => {
    worker.request.mockRejectedValue(new BinaryPreviewError(code));
    render(panel(blob()));
    expect(await screen.findByText(message)).toBeVisible();
    expect(worker.dispose).toHaveBeenCalled();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('rejects oversized files before reading and supports empty workbooks', async () => {
    const data = blob();
    Object.defineProperty(data, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    const { rerender } = render(panel(data));
    expect(await screen.findByText('fileRender.odsLimit')).toBeVisible();
    expect(data.arrayBuffer).not.toHaveBeenCalled();
    expect(createPreviewWorker).not.toHaveBeenCalled();
    worker.request.mockResolvedValue([]);
    rerender(panel(blob()));
    await waitFor(() => expect(worker.dispose).toHaveBeenCalled());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('fileRender.odsFailed')).not.toBeInTheDocument();
  });
});
