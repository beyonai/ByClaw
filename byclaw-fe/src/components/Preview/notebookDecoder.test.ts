import { decodeNotebook } from './notebookDecoder';
import { MAX_NOTEBOOK_CELLS, MAX_NOTEBOOK_CELL_TEXT, MAX_NOTEBOOK_OUTPUTS } from './notebookTypes';
import { MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

const buffer = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
const code = (outputs: unknown[] = [], source: unknown = ['print(', '1)']) => ({
  cell_type: 'code',
  source,
  execution_count: 3,
  outputs,
});
const notebook = (cells: unknown[]) => ({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells });

describe('Jupyter saved-content decoder', () => {
  it('joins source lines, preserves cell types and reads saved stream, result and error outputs', () => {
    const result = decodeNotebook(
      buffer(
        notebook([
          { cell_type: 'markdown', source: ['# Title\n', '中文'], metadata: {} },
          code([
            { output_type: 'stream', name: 'stdout', text: ['1', '\n'] },
            { output_type: 'execute_result', data: { 'text/plain': ['42'], 'text/html': '<script>evil()</script>' } },
            { output_type: 'error', traceback: ['\u001b[31mError\u001b[0m', 'detail'] },
          ]),
          { cell_type: 'raw', source: '<script>literal</script>' },
        ])
      )
    );
    expect(result.cells[0].source).toBe('# Title\n中文');
    expect(result.cells[1]).toEqual({
      type: 'code',
      source: 'print(1)',
      executionCount: 3,
      outputs: [{ text: '1\n' }, { text: '42' }, { text: 'Error\ndetail' }],
    });
    expect(result.cells[2].type).toBe('raw');
    expect(JSON.stringify(result)).not.toContain('evil()');
  });

  it('selects a saved raster output and never returns executable HTML, widgets or SVG', () => {
    const result = decodeNotebook(
      buffer(
        notebook([
          code([
            { output_type: 'display_data', data: { 'image/png': ['iVBORw0KGgo=', '\n'], 'text/plain': 'plot' } },
            { output_type: 'display_data', data: { 'text/html': '<script>run()</script>' } },
            { output_type: 'display_data', data: { 'image/svg+xml': '<svg onload="run()"/>' } },
          ]),
        ])
      )
    );
    expect(result.cells[0].outputs).toEqual([{ image: 'data:image/png;base64,iVBORw0KGgo=' }]);
    expect(result.omitted).toBe(true);
  });

  it('marks truncated source and unsupported markdown attachments', () => {
    const result = decodeNotebook(
      buffer(
        notebook([
          { cell_type: 'markdown', source: 'a'.repeat(MAX_NOTEBOOK_CELL_TEXT + 1), attachments: { 'a.png': {} } },
        ])
      )
    );
    expect(result.cells[0].source).toHaveLength(MAX_NOTEBOOK_CELL_TEXT);
    expect(result.omitted).toBe(true);
  });

  it.each([
    { nbformat: 3, worksheets: [] },
    { nbformat: 4, cells: null },
    notebook([{ cell_type: 'markdown', source: [123] }]),
    notebook([code([{ output_type: 'display_data', data: { 'image/png': 'javascript:bad' } }])]),
    notebook([code([{ output_type: 'error', traceback: [123] }])]),
  ])('rejects malformed or unsupported notebooks', (value) => {
    expect(() => decodeNotebook(buffer(value))).toThrow();
  });

  it('bounds input size, cell count, total text and output count', () => {
    expect(() => decodeNotebook(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1))).toThrow('limit');
    expect(() =>
      decodeNotebook(buffer(notebook(Array.from({ length: MAX_NOTEBOOK_CELLS + 1 }, () => code()))))
    ).toThrow('limit');
    expect(() =>
      decodeNotebook(buffer(notebook(Array.from({ length: 22 }, () => code([], 'x'.repeat(MAX_NOTEBOOK_CELL_TEXT))))))
    ).toThrow('limit');
    expect(() =>
      decodeNotebook(
        buffer(
          notebook([
            code(Array.from({ length: MAX_NOTEBOOK_OUTPUTS + 1 }, () => ({ output_type: 'stream', text: 'x' }))),
          ])
        )
      )
    ).toThrow('limit');
  });
});
