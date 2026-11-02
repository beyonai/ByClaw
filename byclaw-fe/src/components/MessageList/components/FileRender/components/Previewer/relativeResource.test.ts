import {
  createRelativePathResourceResolver,
  createRelativeResourceResolver,
  getCommonFilePreviewUrl,
} from './relativeResource';

jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({ 'fileBrowser.preview.empty': '文件内容为空，无法预览', 'common.requestFailed': '请求失败，请稍后重试' }[id] ||
      id),
  }),
}));

jest.mock('@/utils/file', () => ({
  getFileUrl: (fileUrl: string) => `/byaiService${fileUrl}`,
}));

const sessionHtmlPath = '/by/.sessions/20011325/deliverables/40-package/wechat-public-account/package-001/preview.html';
const sessionImagePath =
  '/by/.sessions/20011325/deliverables/40-package/wechat-public-account/package-001/assets/01-asset-cover.png';
const originalFetch = Object.getOwnPropertyDescriptor(global, 'fetch');

describe('relativeResource', () => {
  beforeEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    if (originalFetch) {
      Object.defineProperty(global, 'fetch', originalFetch);
      return;
    }

    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('shows localized errors for empty and failed relative resources', async () => {
    const resolver = createRelativeResourceResolver(getCommonFilePreviewUrl(sessionHtmlPath));
    const fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob([])),
    } as Response);
    await expect(resolver?.('assets/empty.png')).rejects.toThrow('文件内容为空，无法预览');

    fetchMock.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' } as Response);
    await expect(resolver?.('assets/missing.png')).rejects.toThrow('请求失败，请稍后重试');
    fetchMock.mockRestore();
  });

  it('loads a commonFile HTML image from its session directory preview URL', async () => {
    const firstSessionHtmlPath = sessionHtmlPath.replace('20011325', '20011326');
    const firstSessionImagePath = sessionImagePath.replace('20011325', '20011326');
    const resolver = createRelativeResourceResolver(getCommonFilePreviewUrl(firstSessionHtmlPath));
    const imageBlob = new Blob(['image'], { type: 'image/png' });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(imageBlob),
    } as Response);

    await expect(resolver?.('assets/01-asset-cover.png')).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `${window.location.origin}/byaiService/commonFile/preview?filePath=${encodeURIComponent(firstSessionImagePath)}`
      ),
      { cache: 'no-store' }
    );
    fetchMock.mockRestore();
  });

  it('normalizes legacy session paths with the /by prefix', async () => {
    const legacySessionHtmlPath = sessionHtmlPath.replace('/by/', '/');
    const resolver = createRelativeResourceResolver(
      `${window.location.origin}/byaiService/commonFile/preview?filePath=${encodeURIComponent(legacySessionHtmlPath)}`
    );
    const imageBlob = new Blob(['image'], { type: 'image/png' });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(imageBlob),
    } as Response);

    await expect(resolver?.('assets/01-asset-cover.png')).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `${window.location.origin}/byaiService/commonFile/preview?filePath=${encodeURIComponent(sessionImagePath)}`
      ),
      { cache: 'no-store' }
    );
    fetchMock.mockRestore();
  });

  it('keeps session artifact resources on the commonFile preview endpoint', async () => {
    const downloadResource = jest.fn((path: string) => Promise.resolve(new Blob([path])));
    const resolver = createRelativePathResourceResolver(sessionHtmlPath, downloadResource);

    await expect(resolver('assets/01-asset-cover.png')).resolves.toBe(
      `${window.location.origin}/byaiService/commonFile/preview?filePath=${encodeURIComponent(sessionImagePath)}`
    );
    expect(downloadResource).not.toHaveBeenCalled();
  });
});
