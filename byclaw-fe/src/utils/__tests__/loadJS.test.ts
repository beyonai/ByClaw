import { loadJS } from '../loadJS';

// Mock getRuntimeActualUrl
jest.mock('../index', () => ({
  getRuntimeActualUrl: jest.fn((url) => `processed-${url}`),
}));

// Mock document methods
const mockAppendChild = jest.fn();
const mockCreateElement = jest.fn();

Object.defineProperty(document, 'createElement', {
  value: mockCreateElement,
  writable: true,
});

Object.defineProperty(document, 'head', {
  value: {
    appendChild: mockAppendChild,
  },
  writable: true,
});

describe.skip('loadJS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateElement.mockClear();
    mockAppendChild.mockClear();
  });

  it('should load JavaScript file successfully', async () => {
    const mockScript = {
      type: '',
      async: false,
      src: '',
      onload: null as any,
      onerror: null as any,
    };

    mockCreateElement.mockReturnValue(mockScript);

    const loadPromise = loadJS('test.js');

    // Simulate successful load
    if (mockScript.onload) {
      mockScript.onload();
    }

    const result = await loadPromise;

    expect(mockCreateElement).toHaveBeenCalledWith('script');
    expect(mockScript.type).toBe('text/javascript');
    expect(mockScript.async).toBe(true);
    expect(mockScript.src).toBe('processed-test.js');
    expect(mockAppendChild).toHaveBeenCalledWith(mockScript);
    expect(result).toBe(true);
  });

  it('should reject on script load error', async () => {
    const mockScript = {
      type: '',
      async: false,
      src: '',
      onload: null as any,
      onerror: null as any,
    };

    mockCreateElement.mockReturnValue(mockScript);

    const loadPromise = loadJS('test.js');

    // Simulate load error
    const error = new Error('Load failed');
    if (mockScript.onerror) {
      mockScript.onerror(error);
    }

    await expect(loadPromise).rejects.toThrow('Load failed');
  });

  it('should process URL through getRuntimeActualUrl', async () => {
    const { getRuntimeActualUrl } = require('../index');
    const mockScript = {
      type: '',
      async: false,
      src: '',
      onload: null as any,
      onerror: null as any,
    };

    mockCreateElement.mockReturnValue(mockScript);

    const loadPromise = loadJS('test.js');

    if (mockScript.onload) {
      mockScript.onload();
    }

    await loadPromise;

    expect(getRuntimeActualUrl).toHaveBeenCalledWith('test.js');
    expect(mockScript.src).toBe('processed-test.js');
  });

  it('should handle different file extensions', async () => {
    const mockScript = {
      type: '',
      async: false,
      src: '',
      onload: null as any,
      onerror: null as any,
    };

    mockCreateElement.mockReturnValue(mockScript);

    const loadPromise = loadJS('test.min.js');

    if (mockScript.onload) {
      mockScript.onload();
    }

    await loadPromise;

    expect(mockScript.src).toBe('processed-test.min.js');
  });

  it('should handle relative URLs', async () => {
    const mockScript = {
      type: '',
      async: false,
      src: '',
      onload: null as any,
      onerror: null as any,
    };

    mockCreateElement.mockReturnValue(mockScript);

    const loadPromise = loadJS('./js/test.js');

    if (mockScript.onload) {
      mockScript.onload();
    }

    await loadPromise;

    expect(mockScript.src).toBe('processed-./js/test.js');
  });

  it('should handle absolute URLs', async () => {
    const mockScript = {
      type: '',
      async: false,
      src: '',
      onload: null as any,
      onerror: null as any,
    };

    mockCreateElement.mockReturnValue(mockScript);

    const loadPromise = loadJS('https://cdn.example.com/test.js');

    if (mockScript.onload) {
      mockScript.onload();
    }

    await loadPromise;

    expect(mockScript.src).toBe('processed-https://cdn.example.com/test.js');
  });

  it('should set correct script attributes', async () => {
    const mockScript = {
      type: '',
      async: false,
      src: '',
      onload: null as any,
      onerror: null as any,
    };

    mockCreateElement.mockReturnValue(mockScript);

    const loadPromise = loadJS('test.js');

    if (mockScript.onload) {
      mockScript.onload();
    }

    await loadPromise;

    expect(mockScript.type).toBe('text/javascript');
    expect(mockScript.async).toBe(true);
    expect(typeof mockScript.onload).toBe('function');
    expect(typeof mockScript.onerror).toBe('function');
  });
});
