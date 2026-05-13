import { performanceMonitor, usePerformanceMonitoring, measureFunction } from '../performance';

// Mock React hooks
jest.mock('react', () => ({
  useEffect: jest.fn((fn) => fn()),
  useRef: jest.fn(() => ({ current: null })),
  useCallback: jest.fn((fn) => fn),
  useState: jest.fn(() => [null, jest.fn()]),
}));

// Mock lodash
jest.mock('lodash', () => ({
  noop: jest.fn(),
}));

// Mock performance API
const mockPerformance = {
  getEntriesByType: jest.fn(),
  now: jest.fn(() => Date.now()),
  mark: jest.fn(),
  measure: jest.fn(),
  memory: {
    usedJSHeapSize: 1000000,
    totalJSHeapSize: 2000000,
    jsHeapSizeLimit: 4000000,
  },
};

const mockPerformanceObserver = jest.fn().mockImplementation((callback) => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock navigator.connection
const mockConnection = {
  effectiveType: '4g',
  downlink: 10,
  rtt: 50,
};

const originalWindow = window;
const originalNavigator = navigator;

describe('Performance Utils', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    performanceMonitor.stopMonitoring();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Setup global mocks
    Object.defineProperty(global, 'performance', {
      value: mockPerformance,
      writable: true,
    });

    Object.defineProperty(global, 'PerformanceObserver', {
      value: mockPerformanceObserver,
      writable: true,
    });

    Object.defineProperty(global, 'navigator', {
      value: { connection: mockConnection },
      writable: true,
    });

    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
    });

    window.addEventListener = jest.fn();
    window.removeEventListener = jest.fn();
  });

  afterEach(() => {
    performanceMonitor.stopMonitoring();
    consoleLogSpy.mockRestore();
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
    });
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
    });
  });

  describe('PerformanceMonitor', () => {
    it('should start monitoring', () => {
      performanceMonitor.startMonitoring();
      expect(mockPerformanceObserver).toHaveBeenCalled();
    });

    it('should not start monitoring if already monitoring', () => {
      performanceMonitor.startMonitoring();
      const initialCallCount = mockPerformanceObserver.mock.calls.length;

      performanceMonitor.startMonitoring();
      expect(mockPerformanceObserver.mock.calls.length).toBe(initialCallCount);
    });

    it('should stop monitoring', () => {
      const mockObserver = {
        observe: jest.fn(),
        disconnect: jest.fn(),
      };
      mockPerformanceObserver.mockReturnValue(mockObserver);

      performanceMonitor.startMonitoring();
      performanceMonitor.stopMonitoring();

      expect(mockObserver.disconnect).toHaveBeenCalled();
    });

    it('should get metrics', () => {
      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');
    });

    it('should get network info', () => {
      const networkInfo = performanceMonitor.getNetworkInfo();
      expect(networkInfo).toEqual({
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
      });
    });

    it('should return null network info when connection not available', () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
      });

      const networkInfo = performanceMonitor.getNetworkInfo();
      expect(networkInfo).toBeNull();
    });

    it('should measure function execution time', () => {
      const mockFn = jest.fn(() => 'result');
      const result = performanceMonitor.measureFunction(mockFn, 'test-function');

      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalled();
      expect(mockPerformance.mark).toHaveBeenCalledWith('test-function-start');
      expect(mockPerformance.mark).toHaveBeenCalledWith('test-function-end');
      expect(mockPerformance.measure).toHaveBeenCalledWith('test-function', 'test-function-start', 'test-function-end');
    });

    it('should handle function errors in measurement', () => {
      const mockFn = jest.fn(() => {
        throw new Error('Test error');
      });

      expect(() => {
        performanceMonitor.measureFunction(mockFn, 'test-function');
      }).toThrow('Test error');

      expect(mockPerformance.mark).toHaveBeenCalledWith('test-function-start');
      expect(mockPerformance.mark).toHaveBeenCalledWith('test-function-end');
    });
  });

  describe('usePerformanceMonitoring', () => {
    it('should return performance monitor instance', () => {
      const monitor = usePerformanceMonitoring();
      expect(monitor).toBeDefined();
    });

    it('should start monitoring on mount', () => {
      usePerformanceMonitoring();
      expect(mockPerformanceObserver).toHaveBeenCalled();
    });
  });

  describe('measureFunction', () => {
    it('should measure function execution time', () => {
      const mockFn = jest.fn(() => 'result');
      const result = measureFunction(mockFn, 'test-function');

      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalled();
      expect(mockPerformance.mark).toHaveBeenCalledWith('test-function-start');
      expect(mockPerformance.mark).toHaveBeenCalledWith('test-function-end');
      expect(mockPerformance.measure).toHaveBeenCalledWith('test-function', 'test-function-start', 'test-function-end');
    });

    it('should handle async functions', async () => {
      const mockAsyncFn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async result';
      });

      const result = await measureFunction(mockAsyncFn, 'async-function');

      expect(result).toBe('async result');
      expect(mockAsyncFn).toHaveBeenCalled();
      expect(mockPerformance.mark).toHaveBeenCalledWith('async-function-start');
      expect(mockPerformance.mark).toHaveBeenCalledWith('async-function-end');
    });

    it('should handle function errors', () => {
      const mockFn = jest.fn(() => {
        throw new Error('Test error');
      });

      expect(() => {
        measureFunction(mockFn, 'error-function');
      }).toThrow('Test error');

      expect(mockPerformance.mark).toHaveBeenCalledWith('error-function-start');
      expect(mockPerformance.mark).toHaveBeenCalledWith('error-function-end');
    });
  });

  describe('Performance monitoring in different environments', () => {
    it('should handle missing window object', () => {
      Object.defineProperty(global, 'window', {
        value: undefined,
        writable: true,
      });

      expect(() => performanceMonitor.startMonitoring()).not.toThrow();
    });

    it('should handle missing performance API', () => {
      Object.defineProperty(global, 'performance', {
        value: undefined,
        writable: true,
      });

      expect(() => performanceMonitor.startMonitoring()).not.toThrow();
    });

    it('should handle missing PerformanceObserver', () => {
      Object.defineProperty(global, 'PerformanceObserver', {
        value: undefined,
        writable: true,
      });

      expect(() => performanceMonitor.startMonitoring()).not.toThrow();
    });
  });

  describe('Memory monitoring', () => {
    it('should update memory info when available', () => {
      performanceMonitor.startMonitoring();

      // Simulate memory update
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.memoryUsage).toBeDefined();
    });

    it('should handle missing memory API', () => {
      Object.defineProperty(global, 'performance', {
        value: { ...mockPerformance, memory: undefined },
        writable: true,
      });

      performanceMonitor.startMonitoring();
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.memoryUsage).toBeNull();
    });
  });

  describe('Web Vitals monitoring', () => {
    it('should observe paint events', () => {
      performanceMonitor.startMonitoring();

      expect(mockPerformanceObserver).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should observe largest contentful paint', () => {
      performanceMonitor.startMonitoring();

      expect(mockPerformanceObserver).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should observe first input delay', () => {
      performanceMonitor.startMonitoring();

      expect(mockPerformanceObserver).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should observe layout shift', () => {
      performanceMonitor.startMonitoring();

      expect(mockPerformanceObserver).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
