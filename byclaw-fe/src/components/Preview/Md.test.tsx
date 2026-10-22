import React from 'react';
import { render, screen } from '@testing-library/react';
import MdPreview from './Md';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="rendered-markdown">{children}</div>,
  defaultUrlTransform: (url: string) => url,
}));
jest.mock('remark-gfm', () => jest.fn());

test('hides YAML front matter in the rendered Markdown preview', () => {
  render(<MdPreview content={'---\nuserCode: 0027010369\ndocumentKind: original\n---\n# Markdown content'} />);

  expect(screen.getByTestId('rendered-markdown')).toHaveTextContent('# Markdown content');
  expect(screen.getByTestId('rendered-markdown')).not.toHaveTextContent('userCode');
  expect(screen.getByTestId('rendered-markdown')).not.toHaveTextContent('documentKind');
});
