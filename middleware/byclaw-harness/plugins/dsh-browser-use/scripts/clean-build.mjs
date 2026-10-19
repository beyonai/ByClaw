import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = resolve(packageRoot, 'lib')

if (dirname(buildDirectory) !== packageRoot || basename(buildDirectory) !== 'lib') {
  throw new Error('refusing to clean an unexpected build directory')
}

await rm(buildDirectory, { recursive: true, force: true, maxRetries: 3 })
