import {
  COVER_OUTPUT_HEIGHT,
  COVER_OUTPUT_WIDTH,
  getCoverDrawRect,
  getContainDrawRect,
  normalizeSkillGroupCover,
} from '../coverProcessor';

describe('skill group cover processing geometry', () => {
  it('fills the 3:4 canvas with the blurred background without stretching the source', () => {
    expect(getCoverDrawRect(1600, 900, 900, 1200)).toEqual({
      x: -616.6666666666665,
      y: 0,
      width: 2133.333333333333,
      height: 1200,
    });
  });

  it('keeps the complete source visible in the foreground', () => {
    expect(getContainDrawRect(1600, 900, 900, 1200)).toEqual({
      x: 0,
      y: 346.875,
      width: 900,
      height: 506.25,
    });
  });

  it('returns an exact 1:1 source file unchanged', async () => {
    const createElement = jest.spyOn(document, 'createElement');
    const createObjectURL = jest.fn(() => 'blob:square-cover');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    class MockSquareImage {
      naturalHeight = 1080;
      naturalWidth = 1080;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }
    const originalImage = global.Image;
    Object.defineProperty(global, 'Image', { configurable: true, value: MockSquareImage });
    const source = new File(['square'], 'square.jpg', { type: 'image/jpeg', lastModified: 123 });

    try {
      await expect(normalizeSkillGroupCover(source)).resolves.toBe(source);
      expect(createElement).not.toHaveBeenCalledWith('canvas');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:square-cover');
    } finally {
      createElement.mockRestore();
      Object.defineProperty(global, 'Image', { configurable: true, value: originalImage });
    }
  });

  it('renders a blurred background and complete foreground into a 3:4 PNG file', async () => {
    const drawImage = jest.fn();
    const context = {
      drawImage,
      fillRect: jest.fn(),
      filter: 'none',
      fillStyle: '',
      globalAlpha: 1,
      restore: jest.fn(),
      save: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => context),
      toBlob: jest.fn((callback: BlobCallback) => callback(new Blob(['normalized'], { type: 'image/png' }))),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElement = jest
      .spyOn(document, 'createElement')
      .mockImplementation(((tagName: string) =>
        tagName === 'canvas' ? canvas : originalCreateElement(tagName)) as typeof document.createElement);
    const createObjectURL = jest.fn(() => 'blob:source-cover');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    class MockImage {
      naturalHeight = 900;
      naturalWidth = 1600;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }
    const originalImage = global.Image;
    Object.defineProperty(global, 'Image', { configurable: true, value: MockImage });

    try {
      const result = await normalizeSkillGroupCover(new File(['source'], 'cover.jpg', { type: 'image/jpeg' }));

      expect(canvas.width).toBe(COVER_OUTPUT_WIDTH);
      expect(canvas.height).toBe(COVER_OUTPUT_HEIGHT);
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(result.name).toBe('cover-3x4.png');
      expect(result.type).toBe('image/png');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:source-cover');
    } finally {
      createElement.mockRestore();
      Object.defineProperty(global, 'Image', { configurable: true, value: originalImage });
    }
  });
});
