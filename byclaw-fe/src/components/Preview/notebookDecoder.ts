import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import {
  MAX_NOTEBOOK_CELLS,
  MAX_NOTEBOOK_CELL_TEXT,
  MAX_NOTEBOOK_TEXT,
  MAX_NOTEBOOK_OUTPUTS,
  MAX_NOTEBOOK_IMAGE_TEXT,
  type NotebookCell,
  type NotebookContent,
  type NotebookOutput,
} from './notebookTypes';

const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BinaryPreviewError('invalid');
  return value;
};

/** nbformat 4 只读取已保存的单元格与输出；不启动内核，不信任 HTML/JS、widget 或附件中的活动内容。 */
export function decodeNotebook(buffer: ArrayBuffer): NotebookContent {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const root = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
  if (root.nbformat !== 4) throw new BinaryPreviewError('unsupported');
  if (!Array.isArray(root.cells)) throw new BinaryPreviewError('invalid');
  if (root.cells.length > MAX_NOTEBOOK_CELLS) throw new BinaryPreviewError('limit');
  let textLength = 0;
  let imageLength = 0;
  let outputCount = 0;
  let omitted = false;
  const join = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.every((line) => typeof line === 'string')) return value.join('');
    throw new BinaryPreviewError('invalid');
  };
  const text = (value: unknown): string => {
    const full = join(value);
    if (full.length > MAX_NOTEBOOK_CELL_TEXT) omitted = true;
    const displayed = full.slice(0, MAX_NOTEBOOK_CELL_TEXT);
    textLength += displayed.length;
    if (textLength > MAX_NOTEBOOK_TEXT) throw new BinaryPreviewError('limit');
    return displayed;
  };
  const cells: NotebookCell[] = root.cells.map((raw: unknown) => {
    const cell = object(raw);
    if (!['markdown', 'code', 'raw'].includes(cell.cell_type)) throw new BinaryPreviewError('unsupported');
    const source = text(cell.source);
    if (cell.attachments && Object.keys(object(cell.attachments)).length) omitted = true;
    const outputs: NotebookOutput[] = [];
    if (cell.cell_type === 'code') {
      if (!Array.isArray(cell.outputs)) throw new BinaryPreviewError('invalid');
      outputCount += cell.outputs.length;
      if (outputCount > MAX_NOTEBOOK_OUTPUTS) throw new BinaryPreviewError('limit');
      for (const rawOutput of cell.outputs) {
        const output = object(rawOutput);
        if (output.output_type === 'stream') outputs.push({ text: text(output.text) });
        else if (output.output_type === 'error') {
          if (!Array.isArray(output.traceback) || !output.traceback.every((line: unknown) => typeof line === 'string'))
            throw new BinaryPreviewError('invalid');
          // 终端颜色控制符无需在静态预览中保留。
          outputs.push({
            text: text(
              output.traceback.length ? output.traceback.join('\n') : `${output.ename || ''}: ${output.evalue || ''}`
            ).replace(/\x1b\[[0-9;]*m/g, ''),
          });
        } else if (['display_data', 'execute_result'].includes(output.output_type)) {
          const data = object(output.data);
          const mime = ['image/png', 'image/jpeg'].find((key) => data[key] !== undefined);
          if (mime) {
            const encoded = join(data[mime]);
            if (encoded.length > MAX_NOTEBOOK_IMAGE_TEXT) throw new BinaryPreviewError('limit');
            const base64 = encoded.replace(/\s/g, '');
            imageLength += base64.length;
            if (imageLength > 8 * 1024 * 1024) throw new BinaryPreviewError('limit');
            if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0)
              throw new BinaryPreviewError('invalid');
            outputs.push({ image: `data:${mime};base64,${base64}` });
          } else if (data['text/plain'] !== undefined) outputs.push({ text: text(data['text/plain']) });
          else omitted = true;
        } else omitted = true;
      }
    }
    return {
      type: cell.cell_type,
      source,
      outputs,
      executionCount: Number.isSafeInteger(cell.execution_count) ? cell.execution_count : undefined,
    };
  });
  return { cells, omitted };
}
