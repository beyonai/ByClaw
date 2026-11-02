import { LibRaw } from '@colorhythm/libraw-wasm';

export async function loadRaw() {
  // 由打包器输出同源 WASM 资源，避免运行时访问第三方 CDN。
  const response = await fetch(new URL('@colorhythm/libraw-wasm/libraw.wasm', import.meta.url));
  if (!response.ok) throw new Error('RAW decoder unavailable');
  await LibRaw.initialize(await response.arrayBuffer());
  const decoder = new LibRaw();
  await decoder.waitUntilReady();
  return decoder;
}
