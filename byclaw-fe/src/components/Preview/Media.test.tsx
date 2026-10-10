import { fireEvent, render, screen } from '@testing-library/react';
import MediaPreview from './Media';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

describe('native media preview', () => {
  let pause: jest.SpyInstance;

  beforeEach(() => {
    pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['audio', 'video'] as const)('renders %s with playback controls and without autoplay', (type) => {
    render(<MediaPreview type={type} url="blob:media" title="recording" active />);
    const media = screen.getByLabelText('recording');
    expect(media.tagName.toLowerCase()).toBe(type);
    expect(media).toHaveAttribute('src', 'blob:media');
    expect(media).toHaveAttribute('controls');
    expect(media).toHaveAttribute('preload', 'metadata');
    expect(media).not.toHaveAttribute('autoplay');
  });

  it('shows a translated fallback for unsupported codecs and recovers for the next file', () => {
    const { rerender } = render(<MediaPreview type="video" url="blob:first" title="recording" active />);
    fireEvent.error(screen.getByLabelText('recording'));
    expect(screen.getByText('fileRender.mediaUnsupported')).toBeVisible();
    rerender(<MediaPreview type="video" url="blob:second" title="recording" active />);
    expect(screen.getByLabelText('recording')).toHaveAttribute('src', 'blob:second');
    expect(screen.queryByText('fileRender.mediaUnsupported')).not.toBeInTheDocument();
  });

  it('pauses on hiding, replacing and closing the preview', () => {
    const { rerender, unmount } = render(<MediaPreview type="audio" url="blob:first" title="recording" active />);
    rerender(<MediaPreview type="audio" url="blob:first" title="recording" active={false} />);
    expect(pause).toHaveBeenCalledTimes(1);
    rerender(<MediaPreview type="audio" url="blob:second" title="recording" active />);
    expect(pause).toHaveBeenCalledTimes(2);
    unmount();
    expect(pause).toHaveBeenCalledTimes(3);
  });
});
