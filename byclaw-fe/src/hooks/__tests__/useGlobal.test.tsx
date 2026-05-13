import React from 'react';
import { renderHook } from '@testing-library/react';
import useGlobal from '../useGlobal';
import GlobalContext, { Platform } from '@/layout/components/provider/global';

describe('hooks/useGlobal', () => {
  it('returns default global context when no provider is given', () => {
    const { result } = renderHook(() => useGlobal());

    expect(result.current.platform).toBe(Platform.pc);
    expect(result.current.sessionId).toBe('');
    expect(result.current.agentId).toBe('');
  });

  it('returns provider value when wrapped in GlobalContext provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalContext.Provider
        value={{
          platform: Platform.mobile,
          sessionId: 'session-1',
          agentId: 'agent-1',
          EventEmitter: {} as any,
        }}
      >
        {children}
      </GlobalContext.Provider>
    );

    const { result } = renderHook(() => useGlobal(), { wrapper });

    expect(result.current.platform).toBe(Platform.mobile);
    expect(result.current.sessionId).toBe('session-1');
    expect(result.current.agentId).toBe('agent-1');
  });
});
