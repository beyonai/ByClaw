/** Staging and backups stay on the target filesystem, inside one denyable private directory. */
import { dirname, join, resolve } from 'node:path'

export function privateGenerationRoot(target: string): string {
  return join(dirname(resolve(target)), '.byclaw-private-generations')
}
