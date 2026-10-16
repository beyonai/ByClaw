import { BinaryPreviewError } from './binaryPreview';
import {
  DATABASE_CELL_LENGTH,
  DATABASE_PAGE_SIZE,
  MAX_DATABASE_BYTES,
  MAX_DATABASE_COLUMNS,
  MAX_DATABASE_ROWS,
  MAX_DATABASE_TABLES,
  type DatabaseCell,
  type DatabaseInfo,
  type DatabasePage,
  type SqlDatabase,
  type SqlEngine,
  type SqlValue,
} from './sqliteTypes';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const query = (db: SqlDatabase, sql: string, values: SqlValue[] = []): SqlValue[][] => {
  const statement = db.prepare(sql);
  try {
    statement.bind(values);
    const rows: SqlValue[][] = [];
    while (statement.step()) rows.push(statement.get());
    return rows;
  } finally {
    statement.free();
  }
};

export function validateSqlite(buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_DATABASE_BYTES) throw new BinaryPreviewError('limit');
  if (buffer.byteLength < 100 || String.fromCharCode(...new Uint8Array(buffer, 0, 16)) !== 'SQLite format 3\0') {
    throw new BinaryPreviewError('invalid');
  }
}

/** 读取独立 SQLite 文件副本，不连接服务端数据库，也不执行文件中的视图、触发器或虚拟表。 */
export function openSqlite(buffer: ArrayBuffer, engine: SqlEngine) {
  validateSqlite(buffer);
  const db = new engine.Database(new Uint8Array(buffer));
  let closed = false;
  try {
    db.run('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA cell_size_check=ON;');
    const catalog = query(
      db,
      "SELECT name, type FROM pragma_table_list WHERE schema='main' AND name NOT GLOB 'sqlite_*' ORDER BY name LIMIT ?",
      [MAX_DATABASE_TABLES + 1]
    );
    if (catalog.length > MAX_DATABASE_TABLES) throw new BinaryPreviewError('limit');
    const info: DatabaseInfo = { tables: [], skippedTables: false };
    for (const [name, type] of catalog) {
      if (type !== 'table') {
        info.skippedTables = true;
        continue;
      }
      if (typeof name !== 'string' || name.length > 1024) throw new BinaryPreviewError('invalid');
      // generated/hidden 列可能执行表达式，仅展示普通存储列。
      const columns = query(
        db,
        'SELECT name, type, "notnull", pk FROM pragma_table_xinfo(?) WHERE hidden=0 ORDER BY cid LIMIT ?',
        [name, MAX_DATABASE_COLUMNS + 1]
      );
      if (columns.some(([column, declaredType]) => String(column).length > 1024 || String(declaredType).length > 1024))
        throw new BinaryPreviewError('limit');
      const total = query(db, 'SELECT count(*) FROM pragma_table_xinfo(?)', [name])[0][0];
      info.tables.push({
        name,
        columnsLimited: Number(total) > Math.min(columns.length, MAX_DATABASE_COLUMNS),
        columns: columns.slice(0, MAX_DATABASE_COLUMNS).map(([column, declaredType, notNull, pk]) => ({
          name: String(column),
          type: String(declaredType || ''),
          notNull: !!notNull,
          primaryKey: !!pk,
        })),
      });
    }
    return {
      info,
      readPage(tableIndex: number, offset: number): DatabasePage {
        if (closed) throw new BinaryPreviewError('closed');
        const table = info.tables[tableIndex];
        if (
          !Number.isInteger(tableIndex) ||
          !table ||
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset >= MAX_DATABASE_ROWS ||
          offset % DATABASE_PAGE_SIZE
        )
          throw new BinaryPreviewError('invalid');
        if (!table.columns.length) return { rows: [], hasMore: false };
        // 在 SQLite 内截断 TEXT/BLOB，避免把巨大单元格复制到 JS；整数转为文字保留 64 位精度。
        const fields = table.columns
          .flatMap(({ name }) => {
            const column = quote(name);
            return [
              `typeof(${column})`,
              `CASE WHEN typeof(${column})='blob' THEN length(${column}) ELSE substr(CAST(${column} AS TEXT),1,${
                DATABASE_CELL_LENGTH + 1
              }) END`,
            ];
          })
          .join(',');
        const values = query(db, `SELECT ${fields} FROM main.${quote(table.name)} LIMIT ? OFFSET ?`, [
          DATABASE_PAGE_SIZE + 1,
          offset,
        ]);
        const rows = values.slice(0, DATABASE_PAGE_SIZE).map((row) =>
          table.columns.map((_, index): DatabaseCell => {
            const type = row[index * 2];
            const value = row[index * 2 + 1];
            if (type === 'null') return { kind: 'null' };
            if (type === 'blob') return { kind: 'blob', bytes: Number(value) };
            const text = String(value ?? '');
            return {
              kind: 'value',
              text: text.slice(0, DATABASE_CELL_LENGTH),
              truncated: text.length > DATABASE_CELL_LENGTH,
            };
          })
        );
        return { rows, hasMore: values.length > DATABASE_PAGE_SIZE };
      },
      dispose() {
        if (!closed) {
          closed = true;
          db.close();
        }
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
