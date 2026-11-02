export const MAX_NOTEBOOK_CELLS = 1000;
export const MAX_NOTEBOOK_TEXT = 2 * 1024 * 1024;
export const MAX_NOTEBOOK_CELL_TEXT = 100000;
export const MAX_NOTEBOOK_OUTPUTS = 1000;
export const MAX_NOTEBOOK_IMAGE_TEXT = 2 * 1024 * 1024;
export interface NotebookOutput {
  text?: string;
  image?: string;
}
export interface NotebookCell {
  type: 'markdown' | 'code' | 'raw';
  source: string;
  executionCount?: number;
  outputs: NotebookOutput[];
}
export interface NotebookContent {
  cells: NotebookCell[];
  omitted: boolean;
}
