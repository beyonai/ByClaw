import useAppStore from '../common/useAppStore';
import { getContentFeedbackType } from '@/service/message';

// Mock the service
jest.mock('@/service/message', () => ({
  getContentFeedbackType: jest.fn(),
}));

jest.mock('@/service/system', () => ({
  bathQryPropertyKey: jest.fn(),
}));

// Mock zustand persist
jest.mock('zustand/middleware', () => ({
  devtools: (fn: any) => fn,
  persist: (fn: any) => fn,
}));

describe('useAppStore (Simple)', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      isSiderCollapsed: false,
      feedbackType: {
        FEEDBACK: [],
      },
      isUserCollectModalOpen: false,
      isLoginModalOpen: false,
      ENV: [],
    });
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAppStore.getState();

      expect(state.isSiderCollapsed).toBe(false);
      expect(state.feedbackType).toEqual({
        FEEDBACK: [],
      });
      expect(state.isUserCollectModalOpen).toBe(false);
      expect(state.isLoginModalOpen).toBe(false);
      expect(state.ENV).toEqual([]);
    });
  });

  describe('setSiderCollapsed', () => {
    it('should update isSiderCollapsed state', () => {
      const { setSiderCollapsed } = useAppStore.getState();

      setSiderCollapsed(true);
      expect(useAppStore.getState().isSiderCollapsed).toBe(true);

      setSiderCollapsed(false);
      expect(useAppStore.getState().isSiderCollapsed).toBe(false);
    });
  });

  describe('setUserCollectModalOpen', () => {
    it('should update isUserCollectModalOpen state', () => {
      const { setUserCollectModalOpen } = useAppStore.getState();

      setUserCollectModalOpen(true);
      expect(useAppStore.getState().isUserCollectModalOpen).toBe(true);

      setUserCollectModalOpen(false);
      expect(useAppStore.getState().isUserCollectModalOpen).toBe(false);
    });
  });

  describe('setLoginModalOpen', () => {
    it('should update isLoginModalOpen state', () => {
      const { setLoginModalOpen } = useAppStore.getState();

      setLoginModalOpen(true);
      expect(useAppStore.getState().isLoginModalOpen).toBe(true);

      setLoginModalOpen(false);
      expect(useAppStore.getState().isLoginModalOpen).toBe(false);
    });
  });

  describe('setENV', () => {
    it('should update ENV state', () => {
      const { setENV } = useAppStore.getState();
      const newEnv = ['production', 'staging'];

      setENV(newEnv);
      expect(useAppStore.getState().ENV).toEqual(newEnv);
    });

    it('should replace existing ENV state', () => {
      const { setENV } = useAppStore.getState();
      const initialEnv = ['development'];
      const newEnv = ['production', 'staging'];

      setENV(initialEnv);
      expect(useAppStore.getState().ENV).toEqual(initialEnv);

      setENV(newEnv);
      expect(useAppStore.getState().ENV).toEqual(newEnv);
    });
  });

  describe('getFeedbackType', () => {
    it('should fetch and update feedback type data', async () => {
      const mockFeedbackData = {
        FEEDBACK: [{ paramName: 'effect1', paramValue: 'value1', paramCode: 'code1' }],
      };

      (getContentFeedbackType as jest.Mock).mockResolvedValue(mockFeedbackData);

      const { getFeedbackType } = useAppStore.getState();

      await getFeedbackType();

      expect(getContentFeedbackType).toHaveBeenCalled();
      expect(useAppStore.getState().feedbackType).toEqual(mockFeedbackData);
    });

    it('should handle empty response', async () => {
      (getContentFeedbackType as jest.Mock).mockResolvedValue(null);

      const { getFeedbackType } = useAppStore.getState();

      await getFeedbackType();

      expect(getContentFeedbackType).toHaveBeenCalled();
      expect(useAppStore.getState().feedbackType).toEqual({
        FEEDBACK: [],
      });
    });

    it('should handle partial response', async () => {
      const mockFeedbackData = {
        FEEDBACK: [{ paramName: 'effect1', paramValue: 'value1', paramCode: 'code1' }],
      };

      (getContentFeedbackType as jest.Mock).mockResolvedValue(mockFeedbackData);

      const { getFeedbackType } = useAppStore.getState();

      await getFeedbackType();

      expect(getContentFeedbackType).toHaveBeenCalled();
      expect(useAppStore.getState().feedbackType).toEqual({
        FEEDBACK: mockFeedbackData.FEEDBACK,
      });
    });

    it('should handle API error', async () => {
      (getContentFeedbackType as jest.Mock).mockRejectedValue(new Error('API Error'));

      const { getFeedbackType } = useAppStore.getState();

      await getFeedbackType();
      expect(getContentFeedbackType).toHaveBeenCalled();
      expect(useAppStore.getState().feedbackType).toEqual({
        FEEDBACK: [],
      });
    });
  });
});
