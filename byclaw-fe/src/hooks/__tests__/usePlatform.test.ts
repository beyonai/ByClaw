jest.mock('lodash', () => ({
  ...jest.requireActual('lodash'),
  debounce: (fn: any) => fn,
}));

import { renderHook, act } from '@testing-library/react';
import usePlatform, { platformhandler } from '../usePlatform';
import { IPlatform } from '@/typescript/platform';

describe('hooks/usePlatform', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
      configurable: true,
    });
    Object.defineProperty(document.body, 'clientWidth', {
      value: 1024,
      configurable: true,
    });
  });

  it('platformhandler returns phone for android or narrow width', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13)',
      configurable: true,
    });
    expect(platformhandler(1024)).toBe(IPlatform.phone);
    expect(platformhandler(320)).toBe(IPlatform.phone);
  });

  it('platformhandler returns pc for desktop widths', () => {
    expect(platformhandler(1024)).toBe(IPlatform.pc);
  });

  it('usePlatform updates value on resize', () => {
    const { result } = renderHook(() => usePlatform());

    expect(result.current[0]).toBe(IPlatform.pc);

    Object.defineProperty(document.body, 'clientWidth', {
      value: 320,
      configurable: true,
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current[0]).toBe(IPlatform.phone);
  });
});
