/** Bundle only pi-ai helper implementations, keeping DSH/Cordis and other peers external. */
import { build } from 'tsdown'
await build({
  config: false,
  entry: ['src/pi-ai-runtime.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  clean: false,
  dts: false,
  deps: { alwaysBundle: ['@earendil-works/pi-ai'], onlyBundle: ['@earendil-works/pi-ai'] },
  // Auth store/context retain their original implementation; unused Typebox
  // exports are eliminated, rather than merely deferred until Worker startup.
})
