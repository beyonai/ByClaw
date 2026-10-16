import { MAX_DELIMITED_COLUMNS, MAX_DELIMITED_ROWS, parseDelimited } from './parseDelimited';

describe('delimited file parsing', () => {
  it('preserves quoted commas, escaped quotes, empty cells, BOM and CRLF', () => {
    expect(parseDelimited('\uFEFFname,note,\r\n"a,b","say ""hello""",\r\n', ',')).toEqual({
      rows: [
        ['name', 'note', ''],
        ['a,b', 'say "hello"', ''],
      ],
      columnCount: 3,
      truncated: false,
      malformed: false,
    });
  });

  it('keeps multiline fields and tabs in quoted TSV cells', () => {
    expect(parseDelimited('first\t"line 1\nline 2\tend"\r\nlast\t', '\t').rows).toEqual([
      ['first', 'line 1\nline 2\tend'],
      ['last', ''],
    ]);
  });

  it.each(['"unfinished', '"closed"tail,1', 'un"quoted,2'])(
    'reports malformed quoting instead of displaying a misleading table: %s',
    (source) => expect(parseDelimited(source, ',').malformed).toBe(true)
  );

  it('handles empty input, empty fields and unequal row lengths without treating row one as a header', () => {
    expect(parseDelimited('', ',').rows).toEqual([]);
    expect(parseDelimited(',', ',').rows).toEqual([['', '']]);
    expect(parseDelimited('1,2\n3', ',').rows).toEqual([['1', '2'], ['3']]);
  });

  it('limits stored rows and columns without losing multiline field boundaries', () => {
    const columns = Array.from({ length: MAX_DELIMITED_COLUMNS + 1 }, () => '"two\nlines"').join(',');
    const result = parseDelimited(Array.from({ length: MAX_DELIMITED_ROWS + 1 }, () => columns).join('\n'), ',');
    expect(result.rows).toHaveLength(MAX_DELIMITED_ROWS);
    expect(result.rows.every((row) => row.length === MAX_DELIMITED_COLUMNS)).toBe(true);
    expect(result.rows[0][0]).toBe('two\nlines');
    expect(result.truncated).toBe(true);
    expect(result.malformed).toBe(false);
  });
});
