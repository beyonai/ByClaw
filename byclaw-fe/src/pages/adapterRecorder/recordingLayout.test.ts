import { isActiveRecordingLayout } from './recordingLayout';

describe('isActiveRecordingLayout', () => {
  it('releases the fixed VNC layout after recording advances to ranking', () => {
    expect(isActiveRecordingLayout('ranked', 'A')).toBe(false);
  });

  it('keeps the fixed layout only while the recording page is active', () => {
    expect(isActiveRecordingLayout('page_ready', 'A')).toBe(true);
  });
});
