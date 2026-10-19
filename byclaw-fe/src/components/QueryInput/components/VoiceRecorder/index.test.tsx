import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Recorder from 'recorder-core';
import VoiceRecorder from './index';

const mockRecorder = { open: jest.fn(), start: jest.fn(), stop: jest.fn(), close: jest.fn() };
jest.mock('recorder-core', () => ({ __esModule: true, default: jest.fn(() => mockRecorder) }));
jest.mock('recorder-core/src/engine/mp3', () => ({}));
jest.mock('recorder-core/src/engine/mp3-engine', () => ({}));
jest.mock('@/components/AntdIcon', () => () => <span />);

describe('voice recording gestures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.matchMedia = jest.fn().mockReturnValue({ matches: true, addListener: jest.fn(), removeListener: jest.fn() });
    mockRecorder.open.mockImplementation((opened) => opened());
    mockRecorder.stop.mockImplementation((stopped) => stopped(new Blob(['mp3']), 3200));
  });

  const openRecorder = async (onRecorded = jest.fn().mockResolvedValue(undefined)) => {
    render(<VoiceRecorder onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole('button', { name: '发语音' }));
    return { holdButton: await screen.findByRole('button', { name: '按住说话' }), onRecorded };
  };

  it('starts on a desktop click and sends only after an explicit send click', async () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    const onRecorded = jest.fn().mockResolvedValue(undefined);
    render(<VoiceRecorder onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole('button', { name: '发语音' }));
    expect(mockRecorder.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('group', { name: '语音录制' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('0″');
    expect(onRecorded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送语音' }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
  });

  it('cancels desktop recording with the X button', async () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    const onRecorded = jest.fn();
    render(<VoiceRecorder onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole('button', { name: '发语音' }));
    fireEvent.click(screen.getByRole('button', { name: '取消语音' }));
    expect(mockRecorder.close).toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '发语音' })).toBeInTheDocument();
  });

  it('records an MP3 only while held and sends the original audio after release', async () => {
    const { holdButton, onRecorded } = await openRecorder();
    fireEvent.keyDown(holdButton, { key: ' ' });
    expect(Recorder).toHaveBeenCalledWith(expect.objectContaining({ type: 'mp3', sampleRate: 16000, bitRate: 32 }));
    expect(mockRecorder.start).toHaveBeenCalledTimes(1);
    expect(onRecorded).not.toHaveBeenCalled();
    fireEvent.keyUp(holdButton, { key: ' ' });
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const [file, durationMs] = onRecorded.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toMatch(/\.mp3$/);
    expect(file.type).toBe('audio/mpeg');
    expect(durationMs).toBe(3200);
  });

  it('cancels when focus is lost instead of uploading', async () => {
    const { holdButton, onRecorded } = await openRecorder();
    fireEvent.keyDown(holdButton, { key: 'Enter' });
    fireEvent.blur(holdButton);
    expect(mockRecorder.close).toHaveBeenCalled();
    expect(mockRecorder.stop).not.toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('discards audio when the pointer slides up before release', async () => {
    const { holdButton, onRecorded } = await openRecorder();
    fireEvent(holdButton, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 200 }));
    expect(mockRecorder.start).toHaveBeenCalledTimes(1);
    fireEvent(holdButton, new MouseEvent('pointermove', { bubbles: true, clientY: 100 }));
    expect(screen.getByRole('status')).toHaveTextContent('松开取消');
    fireEvent(holdButton, new MouseEvent('pointerup', { bubbles: true, clientY: 100 }));
    expect(mockRecorder.close).toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('does not start if the user releases while microphone permission is pending', async () => {
    let allow: () => void = () => undefined;
    mockRecorder.open.mockImplementation((opened) => {
      allow = opened;
    });
    const { holdButton, onRecorded } = await openRecorder();
    fireEvent.keyDown(holdButton, { key: 'Enter' });
    fireEvent.keyUp(holdButton, { key: 'Enter' });
    await act(async () => allow());
    expect(mockRecorder.start).not.toHaveBeenCalled();
    expect(mockRecorder.close).toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
