/** Collapse private OTel implementations without duplicating shared API/global state. */
import { build } from 'tsdown'
await build({
  config: false, format: 'esm', platform: 'node', target: 'node22',
  fixedExtension: false, dts: false,
  deps: {
    alwaysBundle: [/^@opentelemetry\/(?!api$|api-logs$)/],
    neverBundle: ['@opentelemetry/api', '@opentelemetry/api-logs'],
    onlyBundle: [/^@opentelemetry\//],
  },
  entry: ['src/index.js'], outDir: 'lib', clean: true,
})
