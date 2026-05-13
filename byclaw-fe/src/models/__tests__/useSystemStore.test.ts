import { renderHook, act } from '@testing-library/react';
import { useSystemStore } from '../common/useSystemStore';

// Mock zustand persist
jest.mock('zustand/middleware', () => ({
  devtools: (fn: any) => fn,
  persist: (fn: any) => fn,
}));

describe('useSystemStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSystemStore.setState({
      screenWidth: 600,
      isPc: undefined,
    });
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useSystemStore());

      expect(result.current.screenWidth).toBe(600);
      expect(result.current.isPc).toBeUndefined();
    });
  });

  describe('setScreenWidth', () => {
    it('should update screenWidth and set isPc to true for large screens', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(1200);
      });

      expect(result.current.screenWidth).toBe(1200);
      expect(result.current.isPc).toBe(true);
    });

    it('should update screenWidth and set isPc to false for small screens', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(800);
      });

      expect(result.current.screenWidth).toBe(800);
      expect(result.current.isPc).toBe(false);
    });

    it('should handle boundary case at 900px', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(900);
      });

      expect(result.current.screenWidth).toBe(900);
      expect(result.current.isPc).toBe(true);
    });

    it('should handle boundary case just below 900px', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(899);
      });

      expect(result.current.screenWidth).toBe(899);
      expect(result.current.isPc).toBe(false);
    });

    it('should handle very small screen widths', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(320);
      });

      expect(result.current.screenWidth).toBe(320);
      expect(result.current.isPc).toBe(false);
    });

    it('should handle very large screen widths', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(2560);
      });

      expect(result.current.screenWidth).toBe(2560);
      expect(result.current.isPc).toBe(true);
    });

    it('should handle zero width', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(0);
      });

      expect(result.current.screenWidth).toBe(0);
      expect(result.current.isPc).toBe(false);
    });

    it('should handle negative width', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(-100);
      });

      expect(result.current.screenWidth).toBe(-100);
      expect(result.current.isPc).toBe(false);
    });

    it('should update multiple times correctly', () => {
      const { result } = renderHook(() => useSystemStore());

      act(() => {
        result.current.setScreenWidth(800);
      });
      expect(result.current.screenWidth).toBe(800);
      expect(result.current.isPc).toBe(false);

      act(() => {
        result.current.setScreenWidth(1000);
      });
      expect(result.current.screenWidth).toBe(1000);
      expect(result.current.isPc).toBe(true);

      act(() => {
        result.current.setScreenWidth(600);
      });
      expect(result.current.screenWidth).toBe(600);
      expect(result.current.isPc).toBe(false);
    });
  });
});
