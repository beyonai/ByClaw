import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Mermaid from './Mermaid';
import { renderMermaid } from './renderMermaid';
import { copyWithMessage } from '@/utils/copy';

jest.mock('./renderMermaid', () => ({ renderMermaid: jest.fn() }));
jest.mock('@/utils/copy', () => ({ copyWithMessage: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
const renderDiagram = renderMermaid as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  renderDiagram.mockResolvedValue({ svg: '<svg aria-label="flowchart"><text>开始</text></svg>' });
});

it('waits for a closed streaming fence, then renders and preserves source/copy', async () => {
  const source = 'graph TD\nA[开始] --> B[结束]';
  const { rerender, container } = render(<Mermaid source={source} complete={false} />);
  expect(renderDiagram).not.toHaveBeenCalled();
  expect(container.querySelector('pre')?.textContent).toBe(source);
  rerender(<Mermaid source={source} complete />);
  await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());
  fireEvent.click(screen.getByText('preview.source'));
  expect(container.querySelector('pre')?.textContent).toBe(source);
  fireEvent.click(screen.getByText('common.copy'));
  expect(copyWithMessage).toHaveBeenCalledWith(source);
});

it('falls back to escaped source on syntax or runtime failure', async () => {
  renderDiagram.mockRejectedValue(new Error('invalid'));
  const { container } = render(<Mermaid source={'<script>alert(1)</script>'} />);
  expect(await screen.findByText('preview.mermaidFailed')).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('pre')?.textContent).toBe('<script>alert(1)</script>');
});

it('discards stale asynchronous diagrams when content changes', async () => {
  let finish: (result: { svg: string }) => void = () => {};
  renderDiagram.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { rerender, container } = render(<Mermaid source="graph TD; A --> B" />);
  rerender(<Mermaid source="graph TD; C --> D" />);
  await screen.findByText('开始');
  await act(async () => finish({ svg: '<svg><text>stale</text></svg>' }));
  expect(container.textContent).not.toContain('stale');
});

it('keeps only one copy of the SVG while opening and closing the enlarged view', async () => {
  render(<Mermaid source="graph TD; A --> B" />);
  await screen.findByText('开始');
  fireEvent.click(screen.getByText('preview.expand'));
  expect(document.querySelectorAll('svg[aria-label="flowchart"]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(document.querySelectorAll('svg[aria-label="flowchart"]')).toHaveLength(1);
});
