import { createConnection } from 'node:net'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startActivationServer } from '../src/activation-server.js'

function request(path: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let response = ''
    socket.once('connect', () => socket.write(command))
    socket.on('data', chunk => { response += chunk })
    socket.once('end', () => resolve(response))
    socket.once('error', reject)
  })
}

describe('private byCLI activation', () => {
  it('is private and activates only for a valid explicit request, with retry after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bact-'))
    const path = join(root, 'activate')
    const ensure = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined)
    const server = await startActivationServer(path, ensure)
    try {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(ensure).not.toHaveBeenCalled()
      expect(await request(path, 'status\n')).toBe('error\n')
      expect(ensure).not.toHaveBeenCalled()
      expect(await request(path, 'bycli\n')).toBe('error\n')
      expect(await request(path, 'bycli\n')).toBe('ready\n')
      expect(ensure).toHaveBeenCalledTimes(2)
    } finally { await server.close(); await rm(root, { recursive: true, force: true }) }
  })
})
