# anchor-multilang PoC (task 09-13-spec-anchor-multilang, step 0)

Selection evidence for multi-language `symbol` / `content-hash` anchor
evaluation over web-tree-sitter wasm. Findings and the recommendation live in
`/workspace/.trellis/tasks/09-13-spec-anchor-multilang/research/parser-selection.md`;
this directory is the runnable device behind them.

- `poc.mjs` — ABI compatibility of three wasm channels, top-level symbol
  enumeration and comment stripping against real sample sources under
  `/e2e-test-samples/repos/` (read in place, never modified).
- `normalize-sketch.mjs` — the proposed leaf-token normalization: black/gofmt
  reformat invariance, Python indent sensitivity, trailing-comma rules.
- `wasm-official/` — the `tree-sitter-<lang>.wasm` binaries as shipped inside
  the official npm tarballs (tree-sitter-python@0.25.0, tree-sitter-go@0.25.0,
  tree-sitter-rust@0.24.0, tree-sitter-java@0.23.5), archived because the PoC
  loads them directly.
- `out/` — machine-readable results (`report.json`, `normalize-sketch.json`)
  and the human summary (`summary.txt`).

Run: `npm install && node poc.mjs && node normalize-sketch.mjs`.

## Re-fetching the grammar wasm

`wasm-official/` is deliberately not committed (2.2 MB of binaries; the
steer-composition precedent commits sources only). To re-run the PoC,
restore it from the exact pinned tarballs:

```sh
npm pack web-tree-sitter@0.27.0 tree-sitter-python@0.25.0 tree-sitter-go@0.25.0 tree-sitter-rust@0.24.0 tree-sitter-java@0.23.5
# extract each package's *.wasm into wasm-official/<name>.wasm
```
