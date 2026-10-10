import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImagePreview from './Image';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

describe('image preview', () => {
  const createObjectURL = jest.fn(() => 'blob:image');
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

  it('preserves SVG MIME when previewing a named blob and revokes its URL on close', async () => {
    const svg = new Blob(['<svg />'], { type: 'application/octet-stream' });
    const { unmount } = render(<ImagePreview data={svg} title="diagram.svg" />);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:image');
    expect(createObjectURL.mock.calls[0][0].type).toBe('image/svg+xml');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image');
  });

  it('shows a translated decode error and recovers when the image changes', async () => {
    const { rerender } = render(<ImagePreview url="blob:first" title="picture" />);
    fireEvent.error(await screen.findByRole('img'));
    expect(screen.getByText('fileRender.previewUnavailable')).toBeVisible();
    rerender(<ImagePreview url="blob:second" title="picture" />);
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:second'));
  });
});
