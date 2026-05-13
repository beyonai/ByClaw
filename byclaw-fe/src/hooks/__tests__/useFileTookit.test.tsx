import { renderHook, act } from '@testing-library/react';

jest.mock('@/pages/manager/utils/file', () => ({
  compressImgFileAndUpload: jest.fn(),
}));

import { useFileTookit } from '../useFileTookit';

describe('hooks/useFileTookit', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pick resolves selected file and updates file state', async () => {
    const originalCreateElement = document.createElement.bind(document);
    let inputEl: any;
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') {
        inputEl = {
          type: '',
          multiple: false,
          accept: '',
          style: {},
          click: jest.fn(),
          remove: jest.fn(),
        };
        return inputEl;
      }
      return originalCreateElement(tag as any);
    });

    const { result } = renderHook(() => useFileTookit());
    const file = new File(['hello'], 'a.png', { type: 'image/png' });

    const promise = result.current.pick({ accept: '.png' });
    await act(async () => {
      inputEl.onchange({
        target: {
          files: [file],
        },
      });
      await promise;
    });

    expect(await promise).toBe(file);
    expect(result.current.file).toBe(file);
  });

  it('pick rejects oversize file and stores message', async () => {
    const originalCreateElement = document.createElement.bind(document);
    let inputEl: any;
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') {
        inputEl = {
          type: '',
          multiple: false,
          accept: '',
          style: {},
          click: jest.fn(),
          remove: jest.fn(),
        };
        return inputEl;
      }
      return originalCreateElement(tag as any);
    });

    const { result } = renderHook(() => useFileTookit());
    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 10 });

    const promise = result.current.pick({ maxSize: 1 });
    await act(async () => {
      inputEl.onchange({
        target: {
          files: [file],
        },
      });
      try {
        await promise;
      } catch {}
    });

    await expect(promise).rejects.toThrow('文件大小超出限制');
    expect(result.current.message).toContain('最大');
  });

  it('toBase64 resolves reader result and clear resets file', async () => {
    const readAsDataURL = jest.fn(function (this: any) {
      this.result = 'data:image/png;base64,abc';
      this.onload();
    });
    (global as any).FileReader = jest.fn().mockImplementation(() => ({
      result: null,
      onload: jest.fn(),
      onerror: jest.fn(),
      readAsDataURL,
    }));

    const { result } = renderHook(() => useFileTookit());
    const file = new File(['hello'], 'a.png', { type: 'image/png' });

    await expect(result.current.toBase64(file)).resolves.toBe('data:image/png;base64,abc');

    act(() => {
      result.current.clear();
    });

    expect(result.current.file).toBeUndefined();
  });
});
