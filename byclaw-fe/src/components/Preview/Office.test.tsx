import React from 'react';
import { render, waitFor } from '@testing-library/react';

import { Office } from './Office';

const mockPreview = jest.fn();
const mockDestroy = jest.fn();
const mockInit = jest.fn(() => ({ preview: mockPreview, destroy: mockDestroy }));

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('pptx-preview', () => ({
  init: (...args: unknown[]) => mockInit(...args),
}));

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {
    this.callback([{ contentRect: { width: 960, height: 540 } } as ResizeObserverEntry], this as any);
  }

  disconnect() {}

  unobserve() {}
}

describe('Office PPTX preview', () => {
  beforeAll(() => {
    Object.defineProperty(global, 'ResizeObserver', {
      configurable: true,
      value: MockResizeObserver,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPreview.mockResolvedValue(undefined);
  });

  it('renders the source PPTX ArrayBuffer in the browser after the panel has a non-zero size', async () => {
    const source = new ArrayBuffer(16);

    render(<Office data={source} type="pptx" />);

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalledWith(expect.any(HTMLElement), {
        width: 960,
        height: 540,
      });
      expect(mockPreview).toHaveBeenCalledWith(source);
    });
  });
});
