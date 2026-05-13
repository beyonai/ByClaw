import { renderHook, act } from '@testing-library/react';
import useAppStore from '../common/useAppStore';
import { getContentFeedbackType } from '@/service/message';
import { bathQryPropertyKey } from '@/service/system';

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

describe('useAppStore', () => {
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
      STTOpts: {},
      cloudSettings: {},
      devConfig: {},
      suggestQuestions: [],
    });
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useAppStore());

      expect(result.current.isSiderCollapsed).toBe(false);
      expect(result.current.feedbackType).toEqual({
        FEEDBACK: [],
      });
      expect(result.current.isUserCollectModalOpen).toBe(false);
      expect(result.current.isLoginModalOpen).toBe(false);
      expect(result.current.ENV).toEqual([]);
    });
  });

  describe('setSiderCollapsed', () => {
    it('should update isSiderCollapsed state', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setSiderCollapsed(true);
      });

      expect(result.current.isSiderCollapsed).toBe(true);
    });

    it('should toggle sider collapsed state', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setSiderCollapsed(true);
      });
      expect(result.current.isSiderCollapsed).toBe(true);

      act(() => {
        result.current.setSiderCollapsed(false);
      });
      expect(result.current.isSiderCollapsed).toBe(false);
    });
  });

  describe('setUserCollectModalOpen', () => {
    it('should update isUserCollectModalOpen state', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setUserCollectModalOpen(true);
      });

      expect(result.current.isUserCollectModalOpen).toBe(true);
    });

    it('should toggle user collect modal state', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setUserCollectModalOpen(true);
      });
      expect(result.current.isUserCollectModalOpen).toBe(true);

      act(() => {
        result.current.setUserCollectModalOpen(false);
      });
      expect(result.current.isUserCollectModalOpen).toBe(false);
    });
  });

  describe('setLoginModalOpen', () => {
    it('should update isLoginModalOpen state', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setLoginModalOpen(true);
      });

      expect(result.current.isLoginModalOpen).toBe(true);
    });

    it('should toggle login modal state', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setLoginModalOpen(true);
      });
      expect(result.current.isLoginModalOpen).toBe(true);

      act(() => {
        result.current.setLoginModalOpen(false);
      });
      expect(result.current.isLoginModalOpen).toBe(false);
    });
  });

  describe('setENV', () => {
    it('should update ENV state', () => {
      const { result } = renderHook(() => useAppStore());
      const newEnv = ['production', 'staging'];

      act(() => {
        result.current.setENV(newEnv);
      });

      expect(result.current.ENV).toEqual(newEnv);
    });

    it('should replace existing ENV state', () => {
      const { result } = renderHook(() => useAppStore());
      const initialEnv = ['development'];
      const newEnv = ['production', 'staging'];

      act(() => {
        result.current.setENV(initialEnv);
      });
      expect(result.current.ENV).toEqual(initialEnv);

      act(() => {
        result.current.setENV(newEnv);
      });
      expect(result.current.ENV).toEqual(newEnv);
    });
  });

  describe('getFeedbackType', () => {
    it('should fetch and update feedback type data', async () => {
      const mockFeedbackData = {
        FEEDBACK: [
          { paramName: 'Good', paramValue: 'good', paramCode: 'GOOD' },
          { paramName: 'Bad', paramValue: 'bad', paramCode: 'BAD' },
        ],
      };

      (getContentFeedbackType as jest.Mock).mockResolvedValue(mockFeedbackData);

      const { result } = renderHook(() => useAppStore());

      await act(async () => {
        await result.current.getFeedbackType();
      });

      expect(getContentFeedbackType).toHaveBeenCalledTimes(1);
      expect(result.current.feedbackType).toEqual(mockFeedbackData);
    });

    it('should handle empty response', async () => {
      (getContentFeedbackType as jest.Mock).mockResolvedValue(null);

      const { result } = renderHook(() => useAppStore());

      await act(async () => {
        await result.current.getFeedbackType();
      });

      expect(result.current.feedbackType).toEqual({
        FEEDBACK: [],
      });
    });

    it('should handle partial response', async () => {
      const mockFeedbackData = {
        FEEDBACK: [{ paramName: 'Good', paramValue: 'good', paramCode: 'GOOD' }],
      };

      (getContentFeedbackType as jest.Mock).mockResolvedValue(mockFeedbackData);

      const { result } = renderHook(() => useAppStore());

      await act(async () => {
        await result.current.getFeedbackType();
      });

      expect(result.current.feedbackType).toEqual({
        FEEDBACK: mockFeedbackData.FEEDBACK,
      });
    });

    it('should handle API error', async () => {
      (getContentFeedbackType as jest.Mock).mockRejectedValue(new Error('API Error'));

      const { result } = renderHook(() => useAppStore());

      await act(async () => {
        await result.current.getFeedbackType();
      });

      expect(result.current.feedbackType).toEqual({
        FEEDBACK: [],
      });
    });
  });

  describe('getSTTOpts', () => {
    it('returns cached STT options without calling service', async () => {
      useAppStore.setState({
        STTOpts: {
          type: 'xf',
          options: { id: '1' },
        },
      });
      const { result } = renderHook(() => useAppStore());

      await expect(result.current.getSTTOpts()).resolves.toEqual({
        type: 'xf',
        options: { id: '1' },
      });
      expect(bathQryPropertyKey).not.toHaveBeenCalled();
    });

    it('fetches and stores STT options when cache is empty', async () => {
      (bathQryPropertyKey as jest.Mock).mockResolvedValue({
        data: {
          'env.voice.type': 'xf',
          'env.voice.options.id': 'id-1',
          'env.voice.options.secret': 'secret-1',
          'env.voice.options.key': 'key-1',
        },
      });

      const { result } = renderHook(() => useAppStore());

      await act(async () => {
        await result.current.getSTTOpts();
      });

      expect(result.current.STTOpts).toEqual({
        type: 'xf',
        options: {
          id: 'id-1',
          secret: 'secret-1',
          key: 'key-1',
        },
      });
    });
  });

  describe('cloud settings and dev config', () => {
    it('setCloudSettings parses settings into transformed arrays and cleanCloudSettings resets them', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setCloudSettings(
          JSON.stringify({
            dataCloud: {
              A: { defaultValue: '1' },
            },
            functionCloud: {},
            memory: {},
          })
        );
      });

      expect(result.current.cloudSettings).toEqual({
        dataCloud: [{ defaultValue: '1', key: 'A', choiceValue: '1' }],
        functionCloud: [],
        memory: [],
      });

      act(() => {
        result.current.cleanCloudSettings();
      });

      expect(result.current.cloudSettings).toEqual({});
    });

    it('setDevConfig parses valid json and ignores invalid json', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setDevConfig(JSON.stringify({ devPortalUrl: 'https://dev.portal' }));
      });
      expect(result.current.devConfig).toEqual({ devPortalUrl: 'https://dev.portal' });

      act(() => {
        result.current.setDevConfig('{invalid');
      });
      expect(result.current.devConfig).toEqual({ devPortalUrl: 'https://dev.portal' });
      expect(errorSpy).toHaveBeenCalled();
    });

    it('setSuggestQuestions updates suggest question list', () => {
      const { result } = renderHook(() => useAppStore());

      act(() => {
        result.current.setSuggestQuestions([{ content: 'Q1' }]);
      });

      expect(result.current.suggestQuestions).toEqual([{ content: 'Q1' }]);
    });
  });
});
