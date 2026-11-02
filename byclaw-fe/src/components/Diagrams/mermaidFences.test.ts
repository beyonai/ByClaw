import { mermaidFences } from './mermaidFences';

it('tracks multiple complete diagrams and a partial stream without changing diagram source', () => {
  const input = '```mermaid\ngraph TD\nA["\\n"] --> B\n```\n\n```mmd\nsequenceDiagram\nA->>B: hi';
  expect(mermaidFences(input)).toEqual([
    { source: 'graph TD\nA["\\n"] --> B', complete: true },
    { source: 'sequenceDiagram\nA->>B: hi', complete: false },
  ]);
});

it('does not mistake a Mermaid example inside an ordinary fenced block for a diagram', () => {
  expect(mermaidFences('````text\n```mermaid\nA-->B\n```\n````')).toEqual([]);
  expect(mermaidFences('~~~MERMAID\ngraph LR\nA-->B\n~~~')).toEqual([{ source: 'graph LR\nA-->B', complete: true }]);
});
