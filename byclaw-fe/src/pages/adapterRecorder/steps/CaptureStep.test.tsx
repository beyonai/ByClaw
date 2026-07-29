import { render, screen } from '@testing-library/react';
import CaptureStep from './CaptureStep';

jest.mock('./VncFrame', () => () => <div data-testid="recording-preview" />);

describe('CaptureStep recording layout', () => {
  const recordingAProps = {
    phase: 'A' as const,
    state: 'page_ready' as const,
    loading: false,
    recording: 'A' as const,
    recordingMode: 'vnc' as const,
    onSeedChange: jest.fn(),
    onStartA: jest.fn(),
    onStopA: jest.fn(),
    onStartB: jest.fn(),
    onStopB: jest.fn(),
  };

  it('renders the preview and keeps the stop action available while recording A', () => {
    render(
      <CaptureStep
        phase="A"
        state="page_ready"
        loading={false}
        recording="A"
        recordingMode="vnc"
        onSeedChange={jest.fn()}
        onStartA={jest.fn()}
        onStopA={jest.fn()}
        onStartB={jest.fn()}
        onStopB={jest.fn()}
      />
    );

    const preview = screen.getByTestId('recording-preview');
    expect(preview).toBeVisible();
    expect(screen.getByRole('button', { name: '结束 A 录制' })).toBeVisible();
  });

  it('renders the recording keyword input while recording', () => {
    render(<CaptureStep {...recordingAProps} />);

    const input = screen.getByPlaceholderText(/本次搜索的关键词/);
    expect(input).toBeVisible();
  });
});
