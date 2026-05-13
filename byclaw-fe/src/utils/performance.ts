/**
 * 性能监控和优化工具
 */
import { useEffect, useState } from 'react';

// 性能指标接口
export interface PerformanceMetrics {
  // 页面加载性能
  loadTime: number;
  domContentLoaded: number;
  firstPaint: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  firstInputDelay: number;
  cumulativeLayoutShift: number;

  // 资源加载性能
  resourceLoadTime: number;
  resourceCount: number;

  // 内存使用情况
  memoryUsage: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;

  // 网络性能
  networkInfo: {
    effectiveType: string;
    downlink: number;
    rtt: number;
  } | null;
}

// 性能监控器类
class PerformanceMonitor {
  private metrics: Partial<PerformanceMetrics> = {};

  private observers: PerformanceObserver[] = [];

  private isMonitoring = false;

  /**
   * 开始性能监控
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.observePageLoad();
    this.observeWebVitals();
    this.observeResources();
    this.observeMemory();
  }

  /**
   * 停止性能监控
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];
  }

  /**
   * 获取性能指标
   */
  getMetrics(): PerformanceMetrics {
    return this.metrics as PerformanceMetrics;
  }

  /**
   * 监听页面加载性能
   */
  private observePageLoad(): void {
    if (typeof window === 'undefined' || typeof performance === 'undefined') return;

    window.addEventListener('load', () => {
      const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (!navigation) return;

      this.metrics.loadTime = navigation.loadEventEnd - navigation.loadEventStart;
      this.metrics.domContentLoaded = navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart;
    });
  }

  /**
   * 监听Web Vitals
   */
  private observeWebVitals(): void {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

    // First Paint
    const paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-paint') {
          this.metrics.firstPaint = entry.startTime;
        } else if (entry.name === 'first-contentful-paint') {
          this.metrics.firstContentfulPaint = entry.startTime;
        }
      }
    });
    paintObserver.observe({ entryTypes: ['paint'] });
    this.observers.push(paintObserver);

    // Largest Contentful Paint
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      this.metrics.largestContentfulPaint = lastEntry?.startTime || 0;
    });
    lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
    this.observers.push(lcpObserver);

    // First Input Delay
    const fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.metrics.firstInputDelay = (entry as any).processingStart - entry.startTime;
      }
    });
    fidObserver.observe({ entryTypes: ['first-input'] });
    this.observers.push(fidObserver);

    // Cumulative Layout Shift
    const clsObserver = new PerformanceObserver((list) => {
      let clsValue = 0;
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value;
        }
      }
      this.metrics.cumulativeLayoutShift = clsValue;
    });
    clsObserver.observe({ entryTypes: ['layout-shift'] });
    this.observers.push(clsObserver);
  }

  /**
   * 监听资源加载性能
   */
  private observeResources(): void {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

    const resourceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      this.metrics.resourceCount = entries.length;

      let totalLoadTime = 0;
      entries.forEach((entry) => {
        totalLoadTime += entry.duration;
      });
      this.metrics.resourceLoadTime = totalLoadTime;
    });
    resourceObserver.observe({ entryTypes: ['resource'] });
    this.observers.push(resourceObserver);
  }

  /**
   * 监听内存使用情况
   */
  private observeMemory(): void {
    if (typeof window === 'undefined' || typeof performance === 'undefined') return;

    const updateMemoryInfo = () => {
      if ('memory' in performance && (performance as any).memory) {
        const { memory } = performance as any;
        this.metrics.memoryUsage = {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
        };
      } else {
        this.metrics.memoryUsage = null;
      }
    };

    updateMemoryInfo();
    setInterval(updateMemoryInfo, 5000); // 每5秒更新一次
  }

  /**
   * 获取网络信息
   */
  getNetworkInfo(): PerformanceMetrics['networkInfo'] {
    if (typeof window === 'undefined' || !('connection' in navigator)) {
      return null;
    }

    const { connection } = navigator as any;
    return {
      effectiveType: connection.effectiveType || 'unknown',
      downlink: connection.downlink || 0,
      rtt: connection.rtt || 0,
    };
  }

  /**
   * 测量函数执行时间
   */
  measureFunction<T>(fn: () => T, name: string): T {
    performance.mark?.(`${name}-start`);
    const start = performance.now();

    try {
      const result = fn();
      return result;
    } finally {
      const end = performance.now();
      performance.mark?.(`${name}-end`);
      performance.measure?.(name, `${name}-start`, `${name}-end`);
      console.log(`${name} 执行时间: ${(end - start).toFixed(2)}ms`);
    }
  }

  /**
   * 测量异步函数执行时间
   */
  async measureAsyncFunction<T>(fn: () => Promise<T>, name: string): Promise<T> {
    performance.mark?.(`${name}-start`);
    const start = performance.now();

    try {
      const result = await fn();
      return result;
    } finally {
      const end = performance.now();
      performance.mark?.(`${name}-end`);
      performance.measure?.(name, `${name}-start`, `${name}-end`);
      console.log(`${name} 执行时间: ${(end - start).toFixed(2)}ms`);
    }
  }
}

// 创建性能监控器实例
export const performanceMonitor = new PerformanceMonitor();

// React Hook for performance monitoring
export function usePerformanceMonitoring() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);

  useEffect(() => {
    performanceMonitor.startMonitoring();

    const updateMetrics = () => {
      const currentMetrics = performanceMonitor.getMetrics();
      setMetrics(currentMetrics as PerformanceMetrics);
    };

    // 初始更新
    updateMetrics();

    // 定期更新
    const interval = setInterval(updateMetrics, 10000); // 每10秒更新一次

    return () => {
      clearInterval(interval);
      performanceMonitor.stopMonitoring();
    };
  }, []);

  return metrics;
}

// 代码分割工具
export class CodeSplitter {
  private static cache = new Map<string, Promise<any>>();

  /**
   * 动态导入组件
   */
  static async loadComponent<T = any>(importFn: () => Promise<{ default: T }>, fallback?: T): Promise<T> {
    try {
      const module = await importFn();
      return module.default;
    } catch (error) {
      console.error('组件加载失败:', error);
      if (fallback) {
        return fallback;
      }
      throw error;
    }
  }

  /**
   * 带缓存的组件加载
   */
  static async loadComponentWithCache<T = any>(
    key: string,
    importFn: () => Promise<{ default: T }>,
    fallback?: T
  ): Promise<T> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const promise = this.loadComponent(importFn, fallback);
    this.cache.set(key, promise);
    return promise;
  }

  /**
   * 预加载组件
   */
  static preloadComponent<T = any>(key: string, importFn: () => Promise<{ default: T }>): void {
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        importFn().then((module) => module.default)
      );
    }
  }

  /**
   * 清除缓存
   */
  static clearCache(): void {
    this.cache.clear();
  }
}

// 性能分析工具
export class PerformanceAnalyzer {

  /**
   * 分析包大小
   */
  static analyzeBundleSize(): void {
    if (typeof window === 'undefined') return;

    const scripts = document.querySelectorAll('script[src]');
    const totalSize = 0;

    scripts.forEach((script) => {
      const { src } = script as HTMLScriptElement;
      if (src) {
        // 这里可以添加实际的包大小分析逻辑
        console.log('Script:', src);
      }
    });

    console.log('总包大小:', totalSize);
  }

  /**
   * 分析渲染性能
   */
  static analyzeRenderPerformance(componentName: string): () => void {
    const start = performance.now();

    return () => {
      const end = performance.now();
      console.log(`${componentName} 渲染时间: ${(end - start).toFixed(2)}ms`);
    };
  }

  /**
   * 分析内存泄漏
   */
  static checkMemoryLeaks(): void {
    if (typeof window === 'undefined' || !('memory' in performance)) return;

    const { memory } = performance as any;
    const used = memory.usedJSHeapSize / 1024 / 1024; // MB
    const total = memory.totalJSHeapSize / 1024 / 1024; // MB
    const limit = memory.jsHeapSizeLimit / 1024 / 1024; // MB

    console.log(`内存使用: ${used.toFixed(2)}MB / ${total.toFixed(2)}MB (限制: ${limit.toFixed(2)}MB)`);

    if (used / limit > 0.8) {
      console.warn('内存使用率过高，可能存在内存泄漏');
    }
  }
}

// 导出便捷方法
export const measureFunction = (fn: () => any, name: string) => performanceMonitor.measureFunction(fn, name);

export const measureAsyncFunction = (fn: () => Promise<any>, name: string) =>
  performanceMonitor.measureAsyncFunction(fn, name);

export const { loadComponent } = CodeSplitter;
export const { loadComponentWithCache } = CodeSplitter;
export const { preloadComponent } = CodeSplitter;
