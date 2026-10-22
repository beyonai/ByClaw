import { access, constants } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

/**
 * Resolve a command the way the helper would on B, but on this host. A and B
 * are one image build with the same tool paths, so the answer is valid for B,
 * and a turn can prepare its shell without starting B. Returns `undefined`
 * when the command is not found here; the caller then asks B after all.
 */
export async function resolveLocalExecutable(command: string, env?: Readonly<Record<string, string | null>>, processEnv: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (command === '' || command.includes('\0')) return undefined
  const executable = async (path: string): Promise<boolean> => {
    try { await access(path, constants.X_OK); return true } catch { return false }
  }
  if (command.includes('/')) return isAbsolute(command) && await executable(command) ? command : undefined
  const searchPath = env?.['PATH'] ?? processEnv['PATH'] ?? ''
  for (const directory of searchPath.split(delimiter)) {
    if (directory === '' || !isAbsolute(directory)) continue
    const candidate = join(directory, command)
    if (await executable(candidate)) return candidate
  }
  return undefined
}
