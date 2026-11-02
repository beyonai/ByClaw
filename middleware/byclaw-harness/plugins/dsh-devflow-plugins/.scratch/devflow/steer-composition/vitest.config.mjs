// Scratch-only vitest config: the repo root config's `include` is limited to
// packages/*/tests and tests/, so this experiment carries its own. Run with:
//   pnpm vitest run --config .scratch/devflow/steer-composition/vitest.config.mjs
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    dir: '.scratch/devflow/steer-composition',
    include: ['**/*.spec.mjs'],
    environment: 'node',
  },
})
