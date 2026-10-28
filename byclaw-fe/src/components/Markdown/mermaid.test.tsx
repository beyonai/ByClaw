import { render, screen } from '@testing-library/react';
import Markdown from './index';

jest.mock('@/components/Diagrams/Mermaid', () => ({ source, complete }: { source: string; complete: boolean }) => (
  <div data-testid="diagram" data-complete={String(complete)}>
    {source}
  </div>
));
jest.mock('./hooks/useActions', () => () => {});
jest.mock('./jsonRenderer', () => () => null);
jest.mock('./aTag', () => () => null);
jest.mock('./tableExtension', () => () => ({ type: 'html', filter: (value: string) => value }));
jest.mock('@/hooks/useGlobal', () => () => ({ layoutMode: 'common' }));
jest.mock('@/utils/file', () => ({ getFileUrl: (value: string) => value }));

it('renders diagrams from real Showdown blocks, keeps streaming blocks incomplete and retains surrounding text', async () => {
  const { rerender } = render(<Markdown text={'前文\n\n```mermaid\ngraph TD\nA --> B'} />);
  expect(await screen.findByTestId('diagram')).toHaveAttribute('data-complete', 'false');
  rerender(
    <Markdown text={'前文\n\n```mermaid\ngraph TD\nA --> B\n```\n\n后文\n\n```mmd\nsequenceDiagram\nA->>B: hi\n```'} />
  );
  const diagrams = await screen.findAllByTestId('diagram');
  expect(diagrams).toHaveLength(2);
  expect(diagrams.every((node) => node.getAttribute('data-complete') === 'true')).toBe(true);
  expect(screen.getByText('前文')).toBeInTheDocument();
  expect(screen.getByText('后文')).toBeInTheDocument();
});
