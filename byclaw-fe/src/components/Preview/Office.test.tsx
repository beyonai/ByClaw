import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { Office } from './Office';

const mockPreview = jest.fn();
const mockDestroy = jest.fn();
const mockInit = jest.fn();
const mockPrepare = jest.fn();

jest.mock('./preparePptxPreview', () => ({
  preparePptxPreview: (source: ArrayBuffer) => mockPrepare(source),
}));

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
    mockInit.mockReturnValue({ preview: mockPreview, destroy: mockDestroy, slideCount: 2 });
    mockPrepare.mockImplementation(async (source: ArrayBuffer) => source);
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

  it('renders the prepared PPTX copy without changing the source buffer', async () => {
    const source = new ArrayBuffer(16);
    const prepared = new ArrayBuffer(24);
    mockPrepare.mockResolvedValue(prepared);

    render(<Office data={source} type="pptx" />);

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith(prepared));
    expect(mockPrepare).toHaveBeenCalledWith(source);
    expect(source.byteLength).toBe(16);
  });

  it('shows the translated error when the library silently returns zero slides', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockInit.mockReturnValue({ preview: mockPreview, destroy: mockDestroy, slideCount: 0 });
    try {
      render(<Office data={new ArrayBuffer(16)} type="pptx" />);
      expect(await screen.findByText('fileBrowser.preview.failed')).toBeInTheDocument();
    } finally {
      warning.mockRestore();
    }
  });

  it('does not initialize a viewer when PPTX preparation fails', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPrepare.mockRejectedValue(new Error('Missing referenced PPTX slide master'));
    try {
      render(<Office data={new ArrayBuffer(16)} type="pptx" />);
      expect(await screen.findByText('fileBrowser.preview.failed')).toBeInTheDocument();
      expect(mockInit).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it.each(['pdf', 'docx', 'xlsx'] as const)('keeps %s on its existing viewer without PPTX preparation', (type) => {
    const component = { pdf: 'Pdf', docx: 'Docx', xlsx: 'Excel' }[type] as 'Pdf' | 'Docx' | 'Excel';
    const viewer = jest.spyOn(Office, component).mockImplementation(() => <div>{type}</div>);
    try {
      render(<Office data={new ArrayBuffer(16)} type={type} />);
      expect(screen.getByText(type)).toBeInTheDocument();
      expect(mockPrepare).not.toHaveBeenCalled();
      expect(mockInit).not.toHaveBeenCalled();
    } finally {
      viewer.mockRestore();
    }
  });
});
