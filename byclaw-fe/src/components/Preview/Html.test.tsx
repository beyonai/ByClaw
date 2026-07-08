import React from 'react';
import { render } from '@testing-library/react';

import { HtmlRender } from './Html';

jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/utils/copy', () => ({
  copyWithMessage: jest.fn(),
}));
jest.mock('./TextHighlight', () => () => null);

describe('HtmlRender blob URL lifecycle', () => {
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:owned-html');
    revokeObjectURL = jest.fn();

    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  it('does not revoke href URLs owned by the caller', () => {
    const { rerender } = render(<HtmlRender href="blob:caller-owned" />);

    rerender(<HtmlRender href="blob:caller-owned-next" />);

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes object URLs created from safe html content', () => {
    const { rerender } = render(<HtmlRender content="<p>first</p>" />);

    rerender(<HtmlRender content="<p>second</p>" />);

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned-html');
  });
});
