import { act, renderHook } from '@testing-library/react';
import useAuditSearch from '../useAuditSearch';

describe('audit name search', () => {
  const rows = [{ resourceName: '财务助手 Alpha' }, { resourceName: '销售助手 Beta' }, { resourceName: null }];

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for 300ms after the last input and matches partial names ignoring case and surrounding spaces', () => {
    const { result } = renderHook(() => useAuditSearch(rows));
    act(() => result.current.setAuditKeyword('财务'));
    act(() => jest.advanceTimersByTime(200));
    expect(result.current.filteredRows).toEqual(rows);
    act(() => result.current.setAuditKeyword(' ALP '));
    act(() => jest.advanceTimersByTime(299));
    expect(result.current.filteredRows).toEqual(rows);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current.filteredRows).toEqual([rows[0]]);
  });

  it('supports Chinese partial names, empty results, and clearing the search', () => {
    const { result } = renderHook(() => useAuditSearch(rows));
    act(() => result.current.setAuditKeyword('助手'));
    act(() => jest.advanceTimersByTime(300));
    expect(result.current.filteredRows).toEqual(rows.slice(0, 2));
    act(() => result.current.setAuditKeyword('不存在'));
    act(() => jest.advanceTimersByTime(300));
    expect(result.current.filteredRows).toEqual([]);
    act(() => result.current.setAuditKeyword(''));
    act(() => jest.advanceTimersByTime(300));
    expect(result.current.filteredRows).toEqual(rows);
  });

  it('keeps the keyword when switching lists and reflects audit removals without changing the source', () => {
    const { result, rerender } = renderHook(({ items }) => useAuditSearch(items), {
      initialProps: { items: rows },
    });
    act(() => result.current.setAuditKeyword('助手'));
    act(() => jest.advanceTimersByTime(300));
    const history = [{ resourceName: '历史财务助手' }, { resourceName: '其他' }];
    rerender({ items: history });
    expect(result.current.filteredRows).toEqual([history[0]]);
    rerender({ items: [history[1]] });
    expect(result.current.filteredRows).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(history).toHaveLength(2);
  });

  it('cancels a pending search on unmount', () => {
    const { result, unmount } = renderHook(() => useAuditSearch(rows));
    act(() => result.current.setAuditKeyword('财务'));
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
