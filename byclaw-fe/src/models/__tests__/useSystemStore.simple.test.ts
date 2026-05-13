import { useSystemStore } from '../common/useSystemStore';

// Mock zustand persist
jest.mock('zustand/middleware', () => ({
  devtools: (fn: any) => fn,
  persist: (fn: any) => fn,
}));

describe('useSystemStore (Simple)', () => {
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
      const state = useSystemStore.getState();

      expect(state.screenWidth).toBe(600);
      expect(state.isPc).toBeUndefined();
    });
  });

  describe('setScreenWidth', () => {
    it('should update screenWidth and set isPc to true for large screens', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(1200);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(1200);
      expect(state.isPc).toBe(true);
    });

    it('should update screenWidth and set isPc to false for small screens', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(800);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(800);
      expect(state.isPc).toBe(false);
    });

    it('should handle boundary case at 900px', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(900);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(900);
      expect(state.isPc).toBe(true);
    });

    it('should handle boundary case just below 900px', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(899);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(899);
      expect(state.isPc).toBe(false);
    });

    it('should handle very small screen widths', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(320);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(320);
      expect(state.isPc).toBe(false);
    });

    it('should handle very large screen widths', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(2560);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(2560);
      expect(state.isPc).toBe(true);
    });

    it('should handle zero width', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(0);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(0);
      expect(state.isPc).toBe(false);
    });

    it('should handle negative width', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(-100);
      const state = useSystemStore.getState();
      expect(state.screenWidth).toBe(-100);
      expect(state.isPc).toBe(false);
    });

    it('should update multiple times correctly', () => {
      const { setScreenWidth } = useSystemStore.getState();

      setScreenWidth(800);
      expect(useSystemStore.getState().screenWidth).toBe(800);
      expect(useSystemStore.getState().isPc).toBe(false);

      setScreenWidth(1200);
      expect(useSystemStore.getState().screenWidth).toBe(1200);
      expect(useSystemStore.getState().isPc).toBe(true);

      setScreenWidth(500);
      expect(useSystemStore.getState().screenWidth).toBe(500);
      expect(useSystemStore.getState().isPc).toBe(false);
    });
  });
});
