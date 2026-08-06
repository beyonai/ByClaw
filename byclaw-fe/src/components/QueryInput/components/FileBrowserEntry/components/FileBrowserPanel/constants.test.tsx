import { isPreviewable } from './constants';

describe('knowledge file preview support', () => {
  it('previews PPTX in the browser but rejects legacy PPT', () => {
    expect(isPreviewable('slides.pptx')).toBe(true);
    expect(isPreviewable('slides.ppt')).toBe(false);
  });
});
