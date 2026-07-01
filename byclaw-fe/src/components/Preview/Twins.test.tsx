import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PreViewFile } from './Twins';

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
  HtmlRender: () => null,
}));
jest.mock('@/components/Preview/TextHighlight', () => () => null);
jest.mock('@/components/Preview/Md', () => () => null);
jest.mock('@/components/Preview/Image', () => () => null);

describe('PreViewFile Office data handling', () => {
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  let createElement: typeof document.createElement;

  beforeEach(() => {
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
