import flexible from '../flexible';

describe('utils/flexible', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('injects style, sets body font size and registers resize/pageshow listeners', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const docAddEventListenerSpy = jest.spyOn(document, 'addEventListener');
    jest.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue({
      width: 500,
    } as DOMRect);

    flexible(750, 750, 320);

    expect(document.getElementById('flexibleStyle')).toBeTruthy();
    expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function), false);
    expect(addEventListenerSpy).toHaveBeenCalledWith('pageshow', expect.any(Function), false);

    if (document.readyState === 'complete') {
      expect(document.body.style.fontSize).toBe('16px');
    } else {
      expect(docAddEventListenerSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), false);
    }
  });
});
