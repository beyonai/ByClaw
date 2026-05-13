jest.mock('@/service/file', () => ({
  uploadImage: jest.fn(),
}));

import { act, renderHook } from '@testing-library/react';
import { uploadImage } from '@/service/file';

import { useUpload } from '../useUpload';

const mockUploadImage = uploadImage as jest.MockedFunction<typeof uploadImage>;

describe('hooks/useUpload', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('pick resolves the selected image file', async () => {
    const originalCreateElement = document.createElement.bind(document);
    let inputEl: any;

    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') {
        inputEl = {
          type: '',
          accept: '',
          multiple: false,
          style: {},
          click: jest.fn(),
          remove: jest.fn(),
        };
        return inputEl;
      }
      return originalCreateElement(tag as any);
    });

    const { result } = renderHook(() => useUpload());
    const file = new File(['hello'], 'a.png', { type: 'image/png' });

    const promise = result.current.pick();
    await act(async () => {
      inputEl.onchange({
        target: {
          files: [file],
          remove: inputEl.remove,
        },
      });
      await promise;
    });

    expect(await promise).toBe(file);
    expect(inputEl.accept).toBe('.jpeg,.jpg,.png,.gif,.bmp,.webp');
    expect(inputEl.remove).toHaveBeenCalled();
  });

  it('upload stores the uploaded image path and clear resets it', async () => {
    mockUploadImage.mockResolvedValue({
      fullPathName: '/upload/a.jpeg',
    } as any);

    const { result } = renderHook(() => useUpload());
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });

    await act(async () => {
      await result.current.upload(file);
    });

    const formData = mockUploadImage.mock.calls[0][0] as FormData;
    expect(formData.get('file')).toBe(file);
    expect(formData.get('module')).toBe('TEMP');
    expect(result.current.result).toBe('/upload/a.jpeg');
    expect(result.current.uploading).toBe(false);

    act(() => {
      result.current.clear();
    });

    expect(result.current.result).toBeUndefined();
  });

  it('compresses oversized files in upload2 before uploading', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const drawImage = jest.fn();
    const toBlob = jest.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob(['compressed'], { type: 'image/jpeg' }));
    });
    const createObjectURL = jest.fn(() => 'blob:preview');
    const revokeObjectURL = jest.fn();

    Object.defineProperty(window.URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });

    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        const canvas: any = {
          style: {},
          width: 0,
          height: 0,
          getContext: jest.fn(() => ({
            drawImage,
            canvas: {
              toBlob,
            },
          })),
        };
        return canvas;
      }
      return originalCreateElement(tag as any);
    });

    class MockImage {
      width = 800;

      height = 400;

      onload: null | (() => void) = null;

      onerror: null | (() => void) = null;

      set src(_value: string) {
        this.onload?.();
      }
    }

    Object.defineProperty(window, 'Image', {
      value: MockImage,
      configurable: true,
      writable: true,
    });

    mockUploadImage.mockResolvedValue({
      fullPathName: '/upload/compressed.jpeg',
    } as any);

    const { result } = renderHook(() => useUpload());
    const file = new File(['hello world'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 999999 });

    await act(async () => {
      await result.current.upload2(file, 1, 400, 100);
      await Promise.resolve();
    });

    const formData = mockUploadImage.mock.calls[0][0] as FormData;
    const uploadedFile = formData.get('file') as File;

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 200, 100);
    expect(uploadedFile.name).toBe('photo.jpeg');
    expect(result.current.result).toBe('/upload/compressed.jpeg');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});
