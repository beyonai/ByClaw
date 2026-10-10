const dangerousSql =
  /\b(delete|drop|truncate|update|insert|alter|create|merge|grant|revoke|call|do|vacuum|reindex|refresh|copy|execute|exec|replace|into)\b/i;

export function requiresSqlConfirmation(sql: string): boolean {
  let visible = '';
  let mode: 'sql' | 'string' | 'identifier' | 'line' | 'block' | 'dollar' = 'sql';
  let blockDepth = 0;
  let dollarTag = '';
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (mode === 'sql') {
      if (char === "'" || char === '"') {
        mode = char === "'" ? 'string' : 'identifier';
      } else if (char === '-' && next === '-') {
        mode = 'line';
        index += 1;
      } else if (char === '/' && next === '*') {
        mode = 'block';
        blockDepth = 1;
        index += 1;
      } else if (char === '$') {
        const end = sql.indexOf('$', index + 1);
        const tag = end < 0 ? '' : sql.slice(index + 1, end);
        if (end >= 0 && /^(?:[A-Za-z_][A-Za-z_0-9]*)?$/.test(tag)) {
          dollarTag = sql.slice(index, end + 1);
          mode = 'dollar';
          index = end;
        } else {
          visible += char;
          continue;
        }
      } else {
        visible += char;
        continue;
      }
    } else if (mode === 'string' || mode === 'identifier') {
      const delimiter = mode === 'string' ? "'" : '"';
      if (char === delimiter) {
        if (next === delimiter) index += 1;
        else mode = 'sql';
      }
    } else if (mode === 'line') {
      if (char === '\r' || char === '\n') mode = 'sql';
    } else if (mode === 'block') {
      if (char === '/' && next === '*') {
        blockDepth += 1;
        index += 1;
      } else if (char === '*' && next === '/') {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) mode = 'sql';
      }
    } else if (sql.startsWith(dollarTag, index)) {
      index += dollarTag.length - 1;
      mode = 'sql';
    }
    visible += ' ';
  }
  return dangerousSql.test(visible) || !/^(select|with|values|show|explain)\b/i.test(visible.trimStart());
}
