import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PreViewFile } from './Twins';

const mockHtmlRender = jest.fn();
const mockOfficeRender = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/components/AntdIcon', () => ({ onClick, type }: { onClick?: () => void; type: string }) => (
  <button data-testid={type} onClick={onClick} type="button" />
));
jest.mock('@/utils/copy', () => ({
  copyWithMessage: jest.fn(),
}));
jest.mock('@/components/Preview/Office', () => ({
  Office: (props: any) => {
    mockOfficeRender(props);
    return <div data-testid="office-preview" />;
  },
}));
jest.mock('@/components/Preview/Html', () => ({
  HtmlRender: (props: any) => {
    mockHtmlRender(props);
    return null;
  },
}));
jest.mock('@/components/Preview/TextHighlight', () => ({ content }: { content?: string }) => (
  <div data-testid="source-preview">{content}</div>
));
jest.mock(
  '@/components/Preview/Md',
  () =>
    ({ content, resolveImage }: { content?: string; resolveImage?: unknown }) =>
      (
        <div data-testid="markdown-preview" data-resolver={!!resolveImage}>
          {content}
        </div>
      )
);
jest.mock('@/components/Preview/Image', () => ({ url, title }: { url?: string; title?: string }) => (
  <img data-testid="image-preview" src={url} alt={title} />
));
jest.mock('@/components/Preview/Media', () => ({ type }: { type: string }) => (
  <div data-testid="media-preview">{type}</div>
));

describe('PreViewFile binary and relative resource handling', () => {
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  let createElement: typeof document.createElement;

  beforeEach(() => {
    mockHtmlRender.mockClear();
    mockOfficeRender.mockClear();
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
      expect(screen.getByTestId('markdown-preview')).toHaveAttribute('data-resolver', 'true');
    });
    expect(mockHtmlRender.mock.calls.every(([props]) => props.data !== markdown)).toBe(true);
  });

  it.each(['svg', 'SVG', 'image', 'image/svg+xml'])('previews SVG as an image for type %s', async (type) => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const svg = new Blob([source], { type: 'application/octet-stream' });
    Object.defineProperty(svg, 'text', { value: () => Promise.resolve(source) });
    const resolveResource = jest.fn();
    const { unmount } = render(
      <PreViewFile data={svg} type={type} title="diagram.SVG" resolveHtmlResource={resolveResource} />
    );

    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeVisible());
    expect(createObjectURL.mock.calls[0][0].type).toBe('image/svg+xml');
    expect(createObjectURL.mock.calls[0][0].size).toBe(svg.size);
    expect(mockHtmlRender).not.toHaveBeenCalled();
    expect(resolveResource).not.toHaveBeenCalled();
    expect(screen.getByTestId('source-preview')).toHaveTextContent(source);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:office-preview');
  });

  it.each(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'ico', 'avif', 'apng', 'image'])(
    'shows the image branch for %s',
    async (type) => {
      render(<PreViewFile data={new Blob(['image content'])} type={type} />);
      await waitFor(() => expect(screen.getByTestId('image-preview')).toBeVisible());
      expect(mockHtmlRender).not.toHaveBeenCalled();
    }
  );

  it('repairs SVG MIME without a filename and supports SVG source strings', async () => {
    const { rerender } = render(<PreViewFile data="<svg />" type="svg" />);
    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeVisible());
    expect(createObjectURL.mock.calls[0][0].type).toBe('image/svg+xml');
    const svg = new Blob(['<svg />'], { type: 'image/svg+xml' });
    Object.defineProperty(svg, 'text', { value: () => Promise.resolve('<svg />') });
    rerender(<PreViewFile data={svg} />);
    await waitFor(() => expect(screen.getByTestId('source-preview')).toHaveTextContent('<svg />'));
    expect(createObjectURL.mock.calls[1][0].type).toBe('image/svg+xml');
  });

  it.each(['csv', 'tsv', 'jsonl', 'ndjson', 'xml', 'yaml', 'txt'])('shows text content for %s', async (type) => {
    const blob = new Blob(['first,second\n1,2']);
    Object.defineProperty(blob, 'text', { value: () => Promise.resolve('first,second\n1,2') });
    render(<PreViewFile data={blob} type={type} title={`data.${type}`} />);
    await waitFor(() => expect(screen.getByTestId('source-preview')).toBeVisible());
    expect(screen.getByTestId('source-preview')).toHaveTextContent('first,second');
    expect(mockHtmlRender).not.toHaveBeenCalled();
  });

  it.each([
    ['mp4', 'video'],
    ['webm', 'video'],
    ['mov', 'video'],
    ['mp3', 'audio'],
    ['m4a', 'audio'],
    ['flac', 'audio'],
  ])('uses the %s media branch', async (type, kind) => {
    render(<PreViewFile data={new Blob(['media content'])} type={type} title={`recording.${type}`} />);
    await waitFor(() => expect(screen.getByTestId('media-preview')).toBeVisible());
    expect(screen.getByTestId('media-preview')).toHaveTextContent(kind);
    expect(mockHtmlRender).not.toHaveBeenCalled();
  });

  it.each(['xls', 'xlsx', 'docx', 'pptx'])('passes the original %s binary to Office', async (type) => {
    const blob = new Blob(['office content']);
    render(<PreViewFile data={blob} type={type} title={`report.${type}`} />);
    await waitFor(() => expect(screen.getByTestId('office-preview')).toBeVisible());
    expect(mockOfficeRender).toHaveBeenLastCalledWith(expect.objectContaining({ data: blob, type }));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('ignores a stale text read when switching to an image', async () => {
    let resolveText!: (text: string) => void;
    const blob = new Blob(['old content']);
    Object.defineProperty(blob, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
    });
    const { rerender } = render(<PreViewFile data={blob} type="txt" />);
    rerender(<PreViewFile data={new Blob(['image content'])} type="png" />);
    await act(async () => resolveText('old content'));
    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeVisible());
    expect(screen.getByTestId('source-preview')).not.toHaveTextContent('old content');
  });

  it.each(['doc', 'ppt', 'tiff', 'heic'])('shows an explicit fallback for %s and preserves download', async (type) => {
    render(<PreViewFile data={new Blob(['binary content'])} type={type} title={`file.${type}`} />);
    expect(screen.getByText('fileRender.formatUnsupported')).toBeVisible();
    fireEvent.click(screen.getByTestId('icon-a-Downloadxiazai'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
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
