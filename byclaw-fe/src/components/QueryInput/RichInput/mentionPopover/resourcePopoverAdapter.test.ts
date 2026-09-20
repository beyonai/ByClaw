import { getResourcePopoverPanelHeight } from './resourcePopoverAdapter';

describe('resource popover overflow strategy', () => {
  it('fills the space below a new conversation without crossing the viewport edge', () => {
    const anchor = { top: 369, bottom: 370 };
    const height = getResourcePopoverPanelHeight(anchor, 'bottomLeft', 800);
    expect(height).toBe(402);
    expect(anchor.bottom + 12 + height).toBe(784);
  });

  it('uses the larger space above history conversations and fits all nine categories', () => {
    const height = getResourcePopoverPanelHeight({ top: 680, bottom: 681 }, 'topLeft', 800);
    expect(height).toBe(652);
    expect(height).toBeGreaterThan(9 * 42 + 16);
  });

  it('recalculates when the input grows or the viewport shrinks', () => {
    expect(getResourcePopoverPanelHeight({ top: 499, bottom: 500 }, 'bottomLeft', 800)).toBe(272);
    expect(getResourcePopoverPanelHeight({ top: 499, bottom: 500 }, 'bottomLeft', 600)).toBe(72);
  });

  it('accounts for a shifted visual viewport', () => {
    expect(getResourcePopoverPanelHeight({ top: 300, bottom: 301 }, 'topLeft', 500, 100)).toBe(172);
  });

  it('clamps unavailable space to zero instead of imposing an overflowing minimum', () => {
    expect(getResourcePopoverPanelHeight({ top: 599, bottom: 600 }, 'bottomLeft', 500, 100)).toBe(0);
  });
});
