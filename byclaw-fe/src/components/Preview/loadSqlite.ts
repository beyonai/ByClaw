import initialize from 'sql.js/dist/sql-wasm-browser.js';

export function loadSqlite() {
  // 使用不含 Node 内置模块的浏览器构建，WASM 资源随 webpack 的部署路径发布。
  return initialize({ locateFile: () => new URL('sql.js/dist/sql-wasm-browser.wasm', import.meta.url).href });
}
