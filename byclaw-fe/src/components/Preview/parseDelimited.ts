export const MAX_DELIMITED_ROWS = 1000;
export const MAX_DELIMITED_COLUMNS = 100;

/** 按分隔符解析带引号的字段；不把 CSV 单元格当成 HTML 或公式执行。 */
export function parseDelimited(content: string, delimiter: ',' | '\t') {
  const source = content.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let column = 0;
  let columnCount = 0;
  let quoted = false;
  let closedQuote = false;
  let fieldStarted = false;
  let truncated = false;
  let malformed = false;

  const finishField = () => {
    if (column < MAX_DELIMITED_COLUMNS) row.push(field);
    else truncated = true;
    column += 1;
    field = '';
    closedQuote = false;
    fieldStarted = false;
  };
  const finishRow = () => {
    finishField();
    columnCount = Math.max(columnCount, row.length);
    if (rows.length < MAX_DELIMITED_ROWS) rows.push(row);
    else truncated = true;
    row = [];
    column = 0;
  };
  const append = (value: string) => {
    fieldStarted = true;
    // 超出显示范围仍扫描引号和换行，避免带多行字段的文件被错误截断。
    if (rows.length < MAX_DELIMITED_ROWS && column < MAX_DELIMITED_COLUMNS) field += value;
  };

  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (quoted) {
      if (value === '"') {
        if (source[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        append(value);
      }
    } else if (value === delimiter) {
      finishField();
    } else if (value === '\r' || value === '\n') {
      finishRow();
      if (value === '\r' && source[index + 1] === '\n') index += 1;
    } else if (value === '"' && !fieldStarted && !closedQuote) {
      quoted = true;
    } else {
      if (closedQuote || value === '"') malformed = true;
      append(value);
    }
  }

  if (quoted) malformed = true;
  // 最后一个行结束符不创建额外空行，但保留以分隔符结尾的空单元格。
  if (source && (!/[\r\n]$/.test(source) || field || column || closedQuote || quoted)) finishRow();
  return { rows, columnCount, truncated, malformed };
}
