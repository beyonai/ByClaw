import { getMimeType, isPreviewable, isVideo } from './constants';

describe('knowledge file preview support', () => {
  it('previews PPTX in the browser but rejects legacy PPT', () => {
    expect(isPreviewable('slides.pptx')).toBe(true);
    expect(isPreviewable('slides.ppt')).toBe(false);
  });

  it.each(['svg', 'jpeg', 'ico', 'avif', 'apng', 'csv', 'tsv', 'xls', 'webm', 'mp3', 'wav', 'm4a', 'flac', 'htm'])(
    'recognizes %s and provides its MIME to the renderer',
    (type) => {
      expect(isPreviewable(`file.${type}`)).toBe(true);
      expect(getMimeType(`file.${type}`)).not.toBe('');
    }
  );

  it('classifies WebM as video and leaves audio on its own branch', () => {
    expect(isVideo('clip.WEBM')).toBe(true);
    expect(isVideo('recording.mp3')).toBe(false);
  });
});
