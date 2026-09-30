import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PreViewFile } from './Twins';

const mockHtmlRender = jest.fn();

jest.mock('@/components/AntdIcon', () => ({ onClick, type }: { onClick?: () => void; type: string }) => (
  <button data-testid={type} onClick={onClick} type="button" />
));
jest.mock('@/utils/copy', () => ({
  copyWithMessage: jest.fn(),
}));
jest.mock('@/components/Preview/Office', () => ({
  Office: () => null,
}));
jest.mock('@/components/Preview/Html', () => ({
  HtmlRender: (props: any) => {
    mockHtmlRender(props);
    return null;
  },
}));
jest.mock('@/components/Preview/TextHighlight', () => () => null);
jest.mock('@/components/Preview/Md', () => ({ content }: { content?: string }) => (
  <div data-testid="markdown-preview">{content}</div>
));
jest.mock('@/components/Preview/Image', () => () => null);

describe('PreViewFile binary and relative resource handling', () => {
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  let createElement: typeof document.createElement;

  beforeEach(() => {
    mockHtmlRender.mockClear();
    createObjectURL = jest.fn(() => 'blob:office-preview');
    revokeObjectURL = jest.fn();
    createElement = document.createElement.bind(document);

    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    jest.spyOn(document, 'createElement').mockImplementation((tagName: any, options?: any) => {
      const element = createElement(tagName, options);

      if (tagName === 'a') {
        element.click = jest.fn();
      }

      return element;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([true, false])('keeps PDF binary with a relative resource resolver: %s', async (withResolver) => {
    const pdf = new Blob(['%PDF-1.4\n'], { type: 'application/octet-stream' });
    const resolveResource = jest.fn();
    const { unmount } = render(
      <PreViewFile
        data={pdf}
        type="pdf"
        title="滴滴电子发票.pdf"
        resolveHtmlResource={withResolver ? resolveResource : undefined}
      />
    );

    await waitFor(() => {
      expect(mockHtmlRender).toHaveBeenLastCalledWith(expect.objectContaining({ href: 'blob:office-preview' }));
    });
    const renderProps = mockHtmlRender.mock.calls[mockHtmlRender.mock.calls.length - 1][0];
    expect(renderProps.data).toBeUndefined();
    expect(renderProps.resolveResource).toBeUndefined();
    expect(createObjectURL.mock.calls[0][0].type).toBe('application/pdf');
    expect(createObjectURL.mock.calls[0][0].size).toBe(pdf.size);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:office-preview');
  });

  it.each(['html', 'h5'])('preserves relative resource resolution for %s', async (type) => {
    const html = new Blob(['<img src="./cover.png">'], { type: 'text/html' });
    Object.defineProperty(html, 'text', { value: () => Promise.resolve('<img src="./cover.png">') });
    const resolveResource = jest.fn();
    render(<PreViewFile data={html} type={type} title="report.html" resolveHtmlResource={resolveResource} />);

    await waitFor(() => {
      expect(mockHtmlRender).toHaveBeenLastCalledWith(expect.objectContaining({ data: html, resolveResource }));
    });
    expect(mockHtmlRender.mock.calls[mockHtmlRender.mock.calls.length - 1][0].href).toBeUndefined();
  });

  it('previews a Markdown blob with the existing resource resolver after switching from PDF', async () => {
    const resolveResource = jest.fn();
    const { rerender } = render(
      <PreViewFile data={new Blob(['%PDF-1.4'])} type="pdf" title="invoice.pdf" resolveHtmlResource={resolveResource} />
    );
    const markdown = new Blob(['# Markdown content']);
    Object.defineProperty(markdown, 'text', { value: () => Promise.resolve('# Markdown content') });
    rerender(
      <PreViewFile
        data={markdown}
        type="md"
        title="联网搜索API(4).md"
        resolveHtmlResource={resolveResource}
        resolveMarkdownImage={resolveResource}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('markdown-preview')).toBeVisible();
      expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Markdown content');
      expect(mockHtmlRender).toHaveBeenLastCalledWith(expect.objectContaining({ data: markdown, resolveResource }));
    });
    expect(mockHtmlRender.mock.calls[mockHtmlRender.mock.calls.length - 1][0].href).toBeUndefined();
  });

  it('does not create an unused object URL for Office blob previews', async () => {
    render(<PreViewFile data={new Blob(['excel content'])} type="xlsx" title="report.xlsx" />);

    await waitFor(() => {
      expect(createObjectURL).not.toHaveBeenCalled();
    });
  });

  it('creates a downloadable object URL for Office blobs only when download is clicked', async () => {
    render(<PreViewFile data={new Blob(['excel content'])} type="xlsx" title="report.xlsx" />);

    expect(createObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('icon-a-Downloadxiazai'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(File);

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:office-preview');
    });
  });
});

describe('PreViewFile Markdown data handling', () => {
  it('shows the Markdown preview when data is a string', async () => {
    render(<PreViewFile data="# Markdown content" type="md" />);

    expect(await screen.findByTestId('markdown-preview')).toBeVisible();
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Markdown content');
  });
});
