export const MAX_DATABASE_BYTES = 50 * 1024 * 1024;
export const MAX_DATABASE_TABLES = 200;
export const MAX_DATABASE_COLUMNS = 100;
export const MAX_DATABASE_ROWS = 1000;
export const DATABASE_PAGE_SIZE = 50;
export const DATABASE_CELL_LENGTH = 512;

export interface DatabaseColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}
export interface DatabaseTable {
  name: string;
  columns: DatabaseColumn[];
  columnsLimited: boolean;
}
export interface DatabaseInfo {
  tables: DatabaseTable[];
  skippedTables: boolean;
}
export type DatabaseCell =
  | { kind: 'null' }
  | { kind: 'blob'; bytes: number }
  | { kind: 'value'; text: string; truncated: boolean };
export interface DatabasePage {
  rows: DatabaseCell[][];
  hasMore: boolean;
}

// 只声明预览所用的 SQL.js 接口；不向界面暴露执行任意 SQL 或写回数据库的能力。
export type SqlValue = string | number | null | Uint8Array;
export interface SqlStatement {
  bind(values: SqlValue[]): boolean;
  step(): boolean;
  get(): SqlValue[];
  free(): boolean;
}
export interface SqlDatabase {
  run(sql: string): SqlDatabase;
  prepare(sql: string): SqlStatement;
  close(): void;
}
export interface SqlEngine {
  Database: new (data?: Uint8Array) => SqlDatabase;
}
