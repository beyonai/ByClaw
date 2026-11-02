export const MAX_ODS_ROWS = 1000;
export const MAX_ODS_COLUMNS = 100;
export const MAX_ODS_SHEETS = 50;
export const MAX_ODS_XML_BYTES = 8 * 1024 * 1024;
export const MAX_ODS_CELL_TEXT = 4096;
export const MAX_ODS_CELLS = 100_000;
export const MAX_ODS_TEXT = 2 * 1024 * 1024;

export interface OdsSheet {
  name: string;
  rows: string[][];
  columnCount: number;
  truncated: boolean;
}
