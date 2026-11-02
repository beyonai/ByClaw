import { libarchiveWasm } from 'libarchive-wasm';

export function loadArchive() {
  // 解码器和 WASM 随站点发布，不在预览用户文件时访问第三方 CDN。
  return libarchiveWasm({
    locateFile: () => new URL('libarchive-wasm/dist/libarchive.wasm', import.meta.url).href,
  });
}
