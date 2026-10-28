import { renderMermaid } from './renderMermaid';
import mermaid from 'mermaid';

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize: jest.fn(), render: jest.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })) },
}));

it('initializes a strict local renderer once and gives each diagram its own SVG IDs', async () => {
  const first = await renderMermaid('graph TD; A --> B');
  const second = await renderMermaid('sequenceDiagram\nA->>B: hi');
  expect(first.svg).not.toBe(second.svg);
  expect(mermaid.initialize).toHaveBeenCalledTimes(1);
  expect(mermaid.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true })
  );
});

it('rejects excessive graph input before rendering', async () => {
  const count = (mermaid.render as jest.Mock).mock.calls.length;
  await expect(renderMermaid('a'.repeat(50_001))).rejects.toThrow('preview limit');
  expect(mermaid.render).toHaveBeenCalledTimes(count);
});
