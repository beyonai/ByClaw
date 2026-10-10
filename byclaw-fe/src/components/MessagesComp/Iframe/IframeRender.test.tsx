import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import IframeRender from './IframeRender';

jest.mock('antd', () => ({
  Spin: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }
}

function resize(...targets: Element[]) {
  act(() => {
    TestResizeObserver.instances.forEach((observer) => {
      const entries = targets
        .filter((target) => observer.targets.has(target))
        .map((target) => ({
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        }));

      if (entries.length) {
        observer.callback(entries, observer);
      }
    });
  });
}

function attachDocument(iframe: HTMLIFrameElement, rootHeight: number, bodyHeight: number, viewportMinimum = false) {
  const contentDocument = document.implementation.createHTMLDocument('preview');
  let width = 700;
  let heights = [rootHeight, bodyHeight];
  contentDocument.body.style.margin = '0';
  iframe.style.height = '150px';
  Object.defineProperty(iframe, 'contentDocument', { configurable: true, value: contentDocument });

  const frameHeight = () => parseFloat(iframe.style.height) || 0;
  const rect = (height: number) =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect);

  Object.defineProperty(iframe, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(iframe, 'clientHeight', { configurable: true, get: frameHeight });
  iframe.getBoundingClientRect = () => rect(frameHeight());

  [contentDocument.documentElement, contentDocument.body].forEach((element, index) => {
    const height = () => Math.max(heights[index], viewportMinimum ? frameHeight() : 0);

    ['scrollHeight', 'offsetHeight', 'clientHeight'].forEach((property) => {
      Object.defineProperty(element, property, { configurable: true, get: height });
    });
    element.getBoundingClientRect = () => rect(height());
  });

  return {
    contentDocument,
    setHeights: (root: number, body: number) => {
      heights = [root, body];
    },
    setWidth: (nextWidth: number) => {
      width = nextWidth;
    },
  };
}

async function settleMeasurements() {
  await act(async () => {
    await Promise.resolve();
    jest.advanceTimersByTime(64);
  });

  // jsdom can deliver its own about:blank load while the first act completes.
  await act(async () => {
    jest.advanceTimersByTime(64);
  });
}

describe('IframeRender height', () => {
  const originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');

  beforeEach(() => {
    jest.useFakeTimers();
    TestResizeObserver.instances = [];
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();

    if (originalResizeObserver) {
      Object.defineProperty(window, 'ResizeObserver', originalResizeObserver);
    } else {
      delete (window as any).ResizeObserver;
    }
  });

  it.each([
    [210, 260, '260px'],
    [360, 280, '360px'],
  ])('fits loaded content using root height %s and body height %s', async (root, body, expectedHeight) => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    attachDocument(iframe, root, body);

    expect(iframe.style.height).toBe('150px');
    fireEvent.load(iframe);
    await settleMeasurements();

    expect(iframe.style.height).toBe(expectedHeight);
  });

  it('follows content growth and shrinkage after load', async () => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    const layout = attachDocument(iframe, 260, 260);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('260px');

    layout.setHeights(540, 540);
    resize(layout.contentDocument.documentElement, layout.contentDocument.body);
    await settleMeasurements();
    expect(iframe.style.height).toBe('540px');

    layout.setHeights(180, 180);
    resize(layout.contentDocument.documentElement, layout.contentDocument.body);
    await settleMeasurements();
    expect(iframe.style.height).toBe('180px');
  });

  it('can shrink when document dimensions are floored by the current iframe viewport', async () => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    const layout = attachDocument(iframe, 260, 260, true);
    layout.contentDocument.body.style.minHeight = '100vh';
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('260px');

    layout.setHeights(120, 120);
    expect(layout.contentDocument.documentElement.scrollHeight).toBe(260);

    // A viewport floor prevents a resize notification when the content shrinks.
    layout.contentDocument.body.textContent = 'Shorter content';
    await settleMeasurements();

    expect(iframe.style.height).toBe('120px');
  });

  it('remeasures wrapping content when the iframe width changes', async () => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    const layout = attachDocument(iframe, 260, 260);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('260px');

    layout.setWidth(320);
    layout.setHeights(410, 410);
    resize(iframe, iframe.parentElement!);
    await settleMeasurements();

    expect(iframe.style.height).toBe('410px');
  });

  it('waits for a hidden iframe to become visible before measuring its height', async () => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    const layout = attachDocument(iframe, 260, 260);
    layout.setWidth(0);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).not.toBe('260px');
    expect(iframe.style.height).not.toBe('0px');

    layout.setWidth(700);
    resize(iframe, iframe.parentElement!);
    await settleMeasurements();

    expect(iframe.style.height).toBe('260px');
  });

  it('remeasures overflowing content after a resource loads without a resize notification', async () => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    const layout = attachDocument(iframe, 260, 260);
    const image = layout.contentDocument.createElement('img');
    layout.contentDocument.body.appendChild(image);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('260px');

    layout.setHeights(460, 460);
    fireEvent(image, new Event('load'));
    await settleMeasurements();

    expect(iframe.style.height).toBe('460px');
  });

  it('ignores callbacks from a replaced document before the next iframe load', async () => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    const oldLayout = attachDocument(iframe, 260, 260);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('260px');

    attachDocument(iframe, 240, 240);
    iframe.style.height = '260px';
    oldLayout.setHeights(700, 700);
    resize(oldLayout.contentDocument.documentElement, oldLayout.contentDocument.body);
    oldLayout.contentDocument.body.textContent = 'Changed before the next iframe load';
    await settleMeasurements();

    expect(iframe.style.height).toBe('260px');

    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('240px');
  });

  it.each([false, true])(
    'stops observing the previous document after another load (URL changed: %s)',
    async (changeUrl) => {
      const { container, rerender } = render(<IframeRender url="about:blank" autoHeight />);
      const iframe = container.querySelector('iframe')!;
      const oldLayout = attachDocument(iframe, 260, 260);
      fireEvent.load(iframe);
      await settleMeasurements();
      expect(iframe.style.height).toBe('260px');

      if (changeUrl) {
        Object.defineProperty(iframe, 'contentDocument', { configurable: true, value: null });
        rerender(<IframeRender url="about:blank#next" autoHeight />);
      }

      expect(
        TestResizeObserver.instances.some(
          (observer) =>
            observer.targets.has(oldLayout.contentDocument.documentElement) ||
            observer.targets.has(oldLayout.contentDocument.body)
        )
      ).toBe(!changeUrl);

      const nextLayout = attachDocument(iframe, 240, 240);
      fireEvent.load(iframe);
      await settleMeasurements();
      expect(iframe.style.height).toBe('240px');
      expect(
        TestResizeObserver.instances.some(
          (observer) =>
            observer.targets.has(oldLayout.contentDocument.documentElement) ||
            observer.targets.has(oldLayout.contentDocument.body)
        )
      ).toBe(false);

      oldLayout.setHeights(700, 700);
      nextLayout.setHeights(510, 510);
      resize(oldLayout.contentDocument.documentElement, oldLayout.contentDocument.body);
      oldLayout.contentDocument.body.textContent = 'Changed after navigation';
      fireEvent(oldLayout.contentDocument.body, new Event('load'));
      await settleMeasurements();
      expect(iframe.style.height).toBe('240px');

      resize(nextLayout.contentDocument.documentElement, nextLayout.contentDocument.body);
      await settleMeasurements();
      expect(iframe.style.height).toBe('510px');
    }
  );

  it('releases resize subscriptions when unmounted', async () => {
    const { container, unmount } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    attachDocument(iframe, 260, 260);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('260px');

    unmount();

    expect(TestResizeObserver.instances.every((observer) => observer.targets.size === 0)).toBe(true);
  });

  it('tolerates an inaccessible cross-origin document', async () => {
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;

    ['contentDocument', 'contentWindow'].forEach((property) => {
      Object.defineProperty(iframe, property, {
        configurable: true,
        get: () => {
          throw new DOMException('Cross-origin access denied', 'SecurityError');
        },
      });
    });

    expect(() => fireEvent.load(iframe)).not.toThrow();
    await settleMeasurements();
    expect(TestResizeObserver.instances.every((observer) => observer.targets.size === 0)).toBe(true);
  });

  it('keeps explicit iframe height messages in control until the next load', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    const layout = attachDocument(iframe, 260, 260);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('260px');

    layout.setHeights(510, 510);
    resize(layout.contentDocument.documentElement, layout.contentDocument.body);
    fireEvent(
      window,
      new MessageEvent('message', { data: { type: 'iframe-set-height', data: 384 }, source: iframe.contentWindow })
    );
    expect(iframe.style.height).toBe('384px');
    layout.contentDocument.body.textContent = 'Changed after explicit sizing';
    resize(layout.contentDocument.documentElement, layout.contentDocument.body);
    await settleMeasurements();
    expect(iframe.style.height).toBe('384px');

    fireEvent(
      window,
      new MessageEvent('message', { data: { type: 'iframe-set-height', data: '42vh' }, source: iframe.contentWindow })
    );
    layout.setHeights(600, 600);
    layout.contentDocument.body.textContent = 'Changed after CSS sizing';
    resize(layout.contentDocument.documentElement, layout.contentDocument.body);
    await settleMeasurements();
    expect(iframe.style.height).toBe('42vh');

    attachDocument(iframe, 240, 240);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('240px');
  });

  it('preserves explicit sizing received before the first load of the same document', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { container } = render(<IframeRender url="about:blank" autoHeight />);
    const iframe = container.querySelector('iframe')!;
    attachDocument(iframe, 260, 260);
    fireEvent(
      window,
      new MessageEvent('message', { data: { type: 'iframe-set-height', data: 384 }, source: iframe.contentWindow })
    );
    expect(iframe.style.height).toBe('384px');

    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('384px');

    attachDocument(iframe, 240, 240);
    fireEvent.load(iframe);
    await settleMeasurements();
    expect(iframe.style.height).toBe('240px');
  });

  it('keeps the default percentage height and accepts iframe-set-height messages', async () => {
    const { container } = render(<IframeRender url="about:blank" />);
    const iframe = container.querySelector('iframe')!;
    fireEvent.load(iframe);
    await settleMeasurements();

    expect(iframe.getAttribute('height')).toBe('100%');
    expect(iframe.style.height).not.toMatch(/px$/);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    fireEvent(
      window,
      new MessageEvent('message', { data: { type: 'iframe-set-height', data: 384 }, source: iframe.contentWindow })
    );

    expect(iframe.style.height).toBe('384px');
    consoleLog.mockRestore();
  });
});
