jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: jest.fn((node: any, root: any, key: any) => ({ node, root, key })),
}));

let mockId = 0;
jest.mock('@/utils/math', () => ({
  generateUniqueId: jest.fn(() => `id-${++mockId}`),
}));

jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => ({
  __esModule: true,
  default: (props: any) => ({ type: 'IframeRender', props }),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { createPortal } from 'react-dom';
import useGlobal from '../useGlobal';
import useRelativeDrawer from '../useRelativeDrawer';

const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;

describe('hooks/useRelativeDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockId = 0;
  });

  it('createDrawer adds a portal to compList when root and renderer exist', () => {
    const handlers: Record<string, Function> = {};
    mockUseGlobal.mockReturnValue({
      EventEmitter: {
        on: jest.fn((event: string, cb: Function) => {
          handlers[event] = cb;
        }),
        off: jest.fn(),
      },
    } as any);

    const root = document.createElement('div');
    jest.spyOn(document, 'getElementById').mockReturnValue(root);

    const { result } = renderHook(() => useRelativeDrawer({ rootId: 'root' }));

    act(() => {
      result.current.createDrawer('iframe', { url: 'https://example.com' }, { title: 'Drawer' });
    });

    expect(createPortal).toHaveBeenCalled();
    expect(result.current.compList).toHaveLength(1);
  });

  it('returns early when root or renderer is missing', () => {
    mockUseGlobal.mockReturnValue({
      EventEmitter: {
        on: jest.fn(),
        off: jest.fn(),
      },
    } as any);

    jest.spyOn(document, 'getElementById').mockReturnValue(null);
    const { result } = renderHook(() => useRelativeDrawer({ rootId: 'root' }));

    act(() => {
      result.current.createDrawer('iframe', { url: 'https://example.com' });
      result.current.createDrawer('unknown', {});
    });

    expect(createPortal).not.toHaveBeenCalled();
    expect(result.current.compList).toHaveLength(0);
  });

  it('registers event handlers and reacts to create/clean events', () => {
    const handlers: Record<string, Function> = {};
    mockUseGlobal.mockReturnValue({
      EventEmitter: {
        on: jest.fn((event: string, cb: Function) => {
          handlers[event] = cb;
        }),
        off: jest.fn(),
      },
    } as any);

    const root = document.createElement('div');
    jest.spyOn(document, 'getElementById').mockReturnValue(root);

    const { result } = renderHook(() => useRelativeDrawer({ rootId: 'root' }));

    act(() => {
      handlers['beyond-relative-driver-message']?.({
        compType: 'iframe',
        payload: { url: 'https://example.com' },
      });
    });

    expect(result.current.compList).toHaveLength(1);

    act(() => {
      handlers['beyond-relative-driver-clean']?.();
    });

    expect(result.current.compList).toHaveLength(0);
  });
});
