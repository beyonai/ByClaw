import { act, fireEvent, render, screen } from '@testing-library/react';
import FittingPreview from '../FittingPreview';

const items = ['First', 'Second', 'Third'].map((label) => ({ label, key: label, keypath: label }));

describe('complete filter previews', () => {
  let widths: Record<string, number>;
  let notifyResize: () => void;
  const originalObserver = global.ResizeObserver;
  const disconnect = jest.fn();

  beforeEach(() => {
    widths = { First: 100, Second: 120, Third: 160 };
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: widths[this.textContent || ''] || 0 } as DOMRect;
    });
    global.ResizeObserver = jest.fn((callback) => {
      notifyResize = () => callback([], {} as ResizeObserver);
      return { observe: jest.fn(), unobserve: jest.fn(), disconnect };
    }) as unknown as typeof ResizeObserver;
    disconnect.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.ResizeObserver = originalObserver;
  });

  const visibleItems = () =>
    screen.queryAllByText(/^(First|Second|Third)$/).filter((item) => !item.closest('[aria-hidden="true"]'));

  it('hides an overflowing third item and restores it when its full text fits', () => {
    const onSelect = jest.fn();
    const { unmount } = render(
      <FittingPreview items={items} maxWidth={420} itemMaxWidth={140} onSelect={onSelect} />
    );
    expect(visibleItems().map((item) => item.textContent)).toEqual(['First', 'Second']);
    fireEvent.click(visibleItems()[1]);
    expect(onSelect).toHaveBeenCalledWith(items[1]);

    widths.Third = 130;
    act(() => notifyResize());
    expect(visibleItems().map((item) => item.textContent)).toEqual(['First', 'Second', 'Third']);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('respects the total preview width and does not skip a truncated value', () => {
    widths.Third = 130;
    const { rerender } = render(
      <FittingPreview items={items} maxWidth={250} itemMaxWidth={140} onSelect={jest.fn()} />
    );
    expect(visibleItems().map((item) => item.textContent)).toEqual(['First', 'Second']);

    widths.Second = 160;
    act(() => notifyResize());
    expect(visibleItems().map((item) => item.textContent)).toEqual(['First']);

    widths.First = 180;
    rerender(<FittingPreview items={[...items]} maxWidth={250} itemMaxWidth={140} onSelect={jest.fn()} />);
    expect(visibleItems()).toHaveLength(0);
  });
});
