declare module 'sql.js/dist/sql-wasm-browser.js' {
  const initialize: (options: { locateFile: (file: string) => string }) => Promise<import('./sqliteTypes').SqlEngine>;
  export default initialize;
}
