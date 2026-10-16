import { openSqlite, validateSqlite } from './sqliteDecoder';
import { DATABASE_CELL_LENGTH, MAX_DATABASE_BYTES } from './sqliteTypes';

// 使用真实 SQLite 的 asm 构建构造/读取文件，避免测试环境依赖 worker 和 WASM 资源 URL。
const initialize = jest.requireActual('sql.js/dist/sql-asm.js');
let engine: any;
beforeAll(async () => {
  engine = await initialize();
});
const fixture = (sql: string) => {
  const db = new engine.Database();
  try {
    db.run(sql);
    return new Uint8Array(db.export()).buffer;
  } finally {
    db.close();
  }
};

describe('read-only SQLite file preview', () => {
  it('reads Chinese names, quoted identifiers, NULL, blobs and exact 64-bit integers without modifying input', () => {
    const buffer =
      fixture(`CREATE TABLE "数据""表" ("编号" INTEGER PRIMARY KEY, "文""字" TEXT NOT NULL, payload BLOB, missing TEXT);
      INSERT INTO "数据""表" VALUES (9223372036854775807, '<script>正文</script>', x'0001ff', NULL);`);
    const original = new Uint8Array(buffer).slice();
    const preview = openSqlite(buffer, engine);
    expect(preview.info.tables[0].name).toBe('数据"表');
    expect(preview.info.tables[0].columns[0]).toMatchObject({ name: '编号', primaryKey: true });
    expect(preview.info.tables[0].columns[1]).toMatchObject({ name: '文"字', notNull: true });
    expect(preview.readPage(0, 0)).toEqual({
      hasMore: false,
      rows: [
        [
          { kind: 'value', text: '9223372036854775807', truncated: false },
          { kind: 'value', text: '<script>正文</script>', truncated: false },
          { kind: 'blob', bytes: 3 },
          { kind: 'null' },
        ],
      ],
    });
    preview.dispose();
    preview.dispose();
    expect(new Uint8Array(buffer)).toEqual(original);
    expect(() => preview.readPage(0, 0)).toThrow('closed');
  });

  it('paginates and truncates in SQLite, and excludes views/generated columns', () => {
    const buffer = fixture(`CREATE TABLE data (n INTEGER, text TEXT, generated TEXT AS (text || text));
      WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<1001)
      INSERT INTO data(n,text) SELECT x, '${'汉'.repeat(600)}' FROM seq;
      CREATE VIEW skipped AS SELECT * FROM data;`);
    const preview = openSqlite(buffer, engine);
    expect(preview.info.skippedTables).toBe(true);
    expect(preview.info.tables).toHaveLength(1);
    expect(preview.info.tables[0].columns).toHaveLength(2);
    expect(preview.info.tables[0].columnsLimited).toBe(true);
    const first = preview.readPage(0, 0);
    expect(first.rows).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.rows[0][1]).toEqual({ kind: 'value', text: '汉'.repeat(DATABASE_CELL_LENGTH), truncated: true });
    expect(preview.readPage(0, 50).rows[0][0]).toMatchObject({ text: '51' });
    expect(preview.readPage(0, 950).hasMore).toBe(true);
    for (const offset of [-1, 1, 1000, NaN]) expect(() => preview.readPage(0, offset)).toThrow('invalid');
    expect(() => preview.readPage(999, 0)).toThrow('invalid');
    preview.dispose();
  });

  it('handles empty tables and caps columns and table count', () => {
    const preview = openSqlite(
      fixture(`CREATE TABLE wide (${Array.from({ length: 101 }, (_, i) => `c${i} TEXT`).join(',')});`),
      engine
    );
    expect(preview.info.tables[0].columns).toHaveLength(100);
    expect(preview.info.tables[0].columnsLimited).toBe(true);
    expect(preview.readPage(0, 0)).toEqual({ rows: [], hasMore: false });
    preview.dispose();
    const many = fixture(Array.from({ length: 201 }, (_, i) => `CREATE TABLE t${i} (n);`).join(''));
    expect(() => openSqlite(many, engine)).toThrow('limit');
  });

  it('rejects non-SQLite .db files, oversized inputs and damaged files', () => {
    expect(() => validateSqlite(new ArrayBuffer(100))).toThrow('invalid');
    expect(() => validateSqlite({ byteLength: MAX_DATABASE_BYTES + 1 } as ArrayBuffer)).toThrow('limit');
    const bad = new TextEncoder().encode('SQLite format 3\0' + '\0'.repeat(100)).buffer;
    expect(() => openSqlite(bad, engine)).toThrow();
  });
});
