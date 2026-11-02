# Vendored runtime modules

`tldts-7.4.11.mjs` is the unmodified ESM distribution from `tldts@7.4.11`.
It is bundled with this Skill so URL redirect authorization works without a
runtime `npm install`. See `LICENSE.tldts` for its MIT license.

`screenshot-deps.cjs` bundles `pngjs@7.0.0` (full PNG pixel/filter/CRC decoding)
and `fflate@0.8.3` (ZIP write/read) for the isolated screenshot workflow. It requires
only Node builtins at runtime, and is resolved relative to the helper, not the
current directory. Include this file and `LICENSE.pngjs` / `LICENSE.fflate` in skill
archives; do not package `node_modules`. Both dependencies and the build tool are
exactly pinned in `../package.json` and `../package-lock.json`.

To reproduce from the scripts directory with network access:

```bash
npm ci --ignore-scripts --omit=optional
node build-screenshot-deps.mjs
node --test screenshot-collection.test.mjs
```

The build script runs the pinned `esbuild@0.25.0` through npx in the OS temporary
directory so a local installation with omitted platform packages does not affect
the build. npx may fetch its build-only platform binary. It copies the original
MIT licenses from the locked packages. Neither npx nor npm runs during collection.
The helper additionally consumes the complete PNG zlib stream to validate its
final checksum, and verifies ZIP member CRCs and hashes after reading the archive.
