import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_BYTES = 32 * 1024 * 1024
const MAX_FILES = 2048

/** Build-time only: trusted, validated unpacked extension gets a new Chrome/SW identity per build. */
export async function installVersionedExtension(packageDirectory, outputDirectory) {
  const packageRoot = await realpath(packageDirectory)
  const source = join(packageRoot, 'extension')
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isDirectory() || sourceInfo.uid !== process.getuid() || (sourceInfo.mode & 0o022)) {
    throw new Error('extension-source-directory')
  }
  const files = []; const directories = []; let bytes = 0
  async function inspect(directory) {
    directories.push(directory)
    if (directories.length > MAX_FILES) throw new Error('extension-size-limit')
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry); const info = await lstat(path)
      if (info.uid !== process.getuid() || (info.mode & 0o022)) throw new Error('extension-untrusted-file')
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('extension-unsupported-file')
      if (info.isDirectory()) await inspect(path)
      else {
        files.push(path); bytes += info.size
        if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new Error('extension-size-limit')
      }
    }
  }
  await inspect(source)
  const metadata = JSON.parse(await readFile(join(source, 'dist/build-info.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'))
  if (!/^[a-f0-9]{64}$/.test(metadata.buildId) || !/^[a-f0-9]{64}$/.test(metadata.scriptSha256)) {
    throw new Error('extension-invalid-build-metadata')
  }
  if (manifest.manifest_version !== 3 || manifest.version !== metadata.version || manifest.key) {
    throw new Error('extension-manifest-identity')
  }
  const worker = manifest.background?.service_worker
  if (typeof worker !== 'string' || worker.startsWith('/') || worker.includes('\\')
    || worker.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('extension-worker-path')
  }
  const script = await readFile(join(source, worker))
  if (createHash('sha256').update(script).digest('hex') !== metadata.scriptSha256
    || !script.includes(Buffer.from(metadata.buildId))) throw new Error('extension-script-build-mismatch')
  const output = resolve(outputDirectory)
  try { await mkdir(output, { mode: 0o755 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const outputInfo = await lstat(output)
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink() || outputInfo.uid !== process.getuid()
    || (outputInfo.mode & 0o022)) throw new Error('extension-output-directory')
  const target = join(output, metadata.buildId)
  await mkdir(target, { mode: 0o755 }) // Never overwrite an existing identity with different bytes.
  for (const directory of directories.slice(1)) await mkdir(join(target, relative(source, directory)), { mode: 0o755 })
  for (const file of files) {
    const destination = join(target, relative(source, file))
    if (!destination.startsWith(target + sep)) throw new Error('extension-copy-path')
    await copyFile(file, destination)
    await chmod(destination, 0o644)
  }
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.getuid() !== 0) throw new Error('extension-build-requires-root')
  const target = await installVersionedExtension(process.argv[2], process.argv[3])
  process.stdout.write(target + '\n')
}
