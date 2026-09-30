import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { DetailPanelContent, useDetailPanelLifecycle, useDetailPanelState } from '../useDetailPanelState';

describe('temporary resource details', () => {
  it('keeps the original instance, filters, loaded content and scroll position when closing a detail', () => {
    const mounted = jest.fn();
    const unmounted = jest.fn();
    const ResourcePanel = () => {
      const [keyword, setKeyword] = useState('');
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return (
        <div data-testid="resource-list" style={{ overflow: 'auto', height: 100 }}>
          <input aria-label="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <span>employee-1 / skills / loaded row</span>
        </div>
      );
    };
    let panels!: ReturnType<typeof useDetailPanelState>;
    const Host = () => {
      panels = useDetailPanelState();
      return <DetailPanelContent {...panels} />;
    };
    render(<Host />);
    act(() => panels.openDetailPanel(<ResourcePanel />, { width: 288 }));
    const list = screen.getByTestId('resource-list');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'saved keyword' } });
    list.scrollTop = 120;

    act(() => {
      panels.openTemporaryDetailPanel((close) => <button onClick={close}>close detail</button>, { width: 350 });
    });
    expect(list).not.toBeVisible();
    expect(panels.activePanel?.options.width).toBe(350);
    fireEvent.click(screen.getByRole('button', { name: 'close detail' }));

    expect(screen.getByTestId('resource-list')).toBe(list);
    expect(list).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('saved keyword');
    expect(list.scrollTop).toBe(120);
    expect(screen.getByText('employee-1 / skills / loaded row')).toBeVisible();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(panels.activePanel?.options.width).toBe(288);
  });

  it('returns to the original panel after rapid replacements and ignores stale close callbacks', () => {
    const { result } = renderHook(useDetailPanelState);
    let closeFirst!: () => void;
    let closeLast!: () => void;
    act(() => result.current.openDetailPanel('workspace'));
    act(() => {
      result.current.openTemporaryDetailPanel((close) => {
        closeFirst = close;
        return 'first';
      });
      result.current.openTemporaryDetailPanel((close) => {
        closeLast = close;
        return 'last';
      });
    });
    act(() => closeFirst());
    expect(result.current.activePanel?.content).toBe('last');
    act(() => closeLast());
    expect(result.current.activePanel?.content).toBe('workspace');
  });

  it.each(['clear', 'replace'])('does not restore an invalidated base after %s', (action) => {
    const { result } = renderHook(useDetailPanelState);
    let close!: () => void;
    act(() => {
      result.current.openDetailPanel('old workspace');
      result.current.openTemporaryDetailPanel((onClose) => {
        close = onClose;
        return 'detail';
      });
    });
    act(() => {
      if (action === 'clear') result.current.clearDetailPanel();
      else result.current.openDetailPanel('new workspace');
    });
    act(() => close());
    expect(result.current.activePanel?.content).toBe(action === 'clear' ? undefined : 'new workspace');
    expect(result.current.temporaryPanel).toBeNull();
  });

  it('closes a failed detail even when no source panel exists', () => {
    const { result } = renderHook(useDetailPanelState);
    let close!: () => void;
    act(() => {
      result.current.openTemporaryDetailPanel((onClose) => {
        close = onClose;
        return 'load failed';
      });
    });
    act(() => close());
    expect(result.current.activePanel).toBeNull();
  });
});

describe('resource panel lifecycle', () => {
  const initialProps = { scope: 'session-1:employee-1', pathname: '/chat', preserveDetailPanel: false };
  const setup = () => {
    const hook = renderHook(
      (props) => {
        const panels = useDetailPanelState();
        useDetailPanelLifecycle({ ...props, ...panels });
        return panels;
      },
      { initialProps }
    );
    act(() => hook.result.current.openDetailPanel('workspace'));
    return hook;
  };

  it('retains the source when entering the skill center and when closing its detail', () => {
    const { result, rerender } = setup();
    rerender({ ...initialProps, pathname: '/skillCenter', preserveDetailPanel: true });
    expect(result.current.basePanel?.content).toBe('workspace');
    act(() => result.current.openTemporaryDetailPanel(() => 'detail'));
    rerender({ ...initialProps, preserveDetailPanel: true });
    expect(result.current.activePanel?.content).toBe('workspace');
    expect(result.current.temporaryPanel).toBeNull();
  });

  it.each(['session-2:employee-1', 'session-1:employee-2'])('invalidates the old scope on %s', (scope) => {
    const { result, rerender } = setup();
    act(() => result.current.openTemporaryDetailPanel(() => 'detail'));
    rerender({ ...initialProps, scope });
    expect(result.current.basePanel).toBeNull();
    expect(result.current.temporaryPanel).toBeNull();
  });

  it('clears both panels on ordinary navigation and browser history traversal', () => {
    const { result, rerender } = setup();
    rerender({ ...initialProps, pathname: '/settings' });
    expect(result.current.activePanel).toBeNull();
    rerender({ ...initialProps, pathname: '/skillCenter', preserveDetailPanel: true });
    act(() => {
      result.current.openDetailPanel('workspace');
      result.current.openTemporaryDetailPanel(() => 'detail');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { preserveDetailPanel: true } }));
    });
    expect(result.current.basePanel).toBeNull();
    expect(result.current.temporaryPanel).toBeNull();
  });
});
