jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('../useFocusIndicator', () => ({
  __esModule: true,
  default: jest.fn(),
}), { virtual: true });

import { renderHook, act } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';
import useFocusIndicator from '../useFocusIndicator';
import useKnowledge from '../useKnowledge';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseFocusIndicator = useFocusIndicator as jest.Mock;

describe('hooks/useKnowledge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads knowledge base list on mount and selects default item', async () => {
    const dispatch = jest.fn().mockResolvedValue([{ knowledgeBaseId: 'kb1', name: 'KB1' }]);
    const getFocusIndicator = jest.fn();
    mockUseDispatch.mockReturnValue(dispatch);
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        chatBI: {
          selectedKnowledgeInfo: null,
          knowledgeBaseList: null,
          useGptSemanticResults: false,
        },
      })
    );
    mockUseFocusIndicator.mockReturnValue({ getFocusIndicator });

    await act(async () => {
      renderHook(() => useKnowledge());
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'chatBI/getKnowledgeBaseByUser',
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'chatBI/setState',
      payload: {
        selectedKnowledgeInfo: { knowledgeBaseId: 'kb1', name: 'KB1' },
      },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'chatBI/getAllIndicator',
      payload: { knowledgeBaseId: 'kb1' },
    });
    expect(getFocusIndicator).toHaveBeenCalledWith({ knowledgeBaseId: 'kb1' });
  });

  it('setSelectedKnowledgeInfo skips duplicate knowledge base selection', () => {
    const dispatch = jest.fn();
    mockUseDispatch.mockReturnValue(dispatch);
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        chatBI: {
          selectedKnowledgeInfo: { knowledgeBaseId: 'kb1' },
          knowledgeBaseList: [{ knowledgeBaseId: 'kb1' }],
          useGptSemanticResults: false,
        },
      })
    );
    mockUseFocusIndicator.mockReturnValue({ getFocusIndicator: jest.fn() });

    const { result } = renderHook(() => useKnowledge());

    act(() => {
      result.current.setSelectedKnowledgeInfo({ knowledgeBaseId: 'kb1' } as any);
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chatBI/setState',
      })
    );
  });

  it('setDvaState dispatches save action', () => {
    const dispatch = jest.fn();
    mockUseDispatch.mockReturnValue(dispatch);
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        chatBI: {
          selectedKnowledgeInfo: null,
          knowledgeBaseList: [],
          useGptSemanticResults: false,
        },
      })
    );
    mockUseFocusIndicator.mockReturnValue({ getFocusIndicator: jest.fn() });

    const { result } = renderHook(() => useKnowledge({ setDefaultSelected: false }));

    act(() => {
      result.current.setDvaState({ foo: 'bar' });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'chatBI/save',
      payload: { foo: 'bar' },
    });
  });
});
