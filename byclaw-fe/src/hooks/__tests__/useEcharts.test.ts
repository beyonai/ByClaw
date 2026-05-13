import { renderHook } from '@testing-library/react';
import useEcharts from '../useEcharts';

describe('hooks/useEcharts', () => {
  it('returns a chart ref container', () => {
    const { result } = renderHook(() => useEcharts());

    expect(result.current.echatsRef).toBeDefined();
    expect(result.current.echatsRef).toHaveProperty('current');
  });
});
