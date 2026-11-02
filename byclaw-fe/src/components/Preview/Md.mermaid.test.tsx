import { render, screen } from '@testing-library/react';
import Md from './Md';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ components }: any) => {
    const Pre = components.pre;
    return (
      <Pre>
        <code className="language-mermaid">{'flowchart LR\nA --> B\n'}</code>
      </Pre>
    );
  },
  defaultUrlTransform: (url: string) => url,
}));
jest.mock('remark-gfm', () => () => {});
jest.mock('@/components/Diagrams/Mermaid', () => ({ source }: { source: string }) => (
  <section aria-label="Mermaid">{source}</section>
));

it('uses the shared Mermaid renderer in Markdown attachments without requiring an image resolver', async () => {
  render(<Md content={'```mermaid\nflowchart LR\nA --> B\n```'} />);
  expect(await screen.findByRole('region', { name: 'Mermaid' })).toHaveTextContent('flowchart LR');
});
