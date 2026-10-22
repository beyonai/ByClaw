import { chmod, unlink } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'

/** Private same-user control socket. No commands, paths or credentials are accepted from callers. */
export async function startActivationServer(path: string, ensure: () => Promise<void>): Promise<{ close(): Promise<void> }> {
  const sockets = new Set<Socket>()
  let stopping = false
  const server = createServer(socket => {
    if (stopping || sockets.size >= 32) { socket.destroy(); return }
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    socket.setTimeout(1_000, () => socket.destroy())
    let input = ''
    socket.on('data', function read(chunk) {
      input += chunk.toString('utf8')
      if (input.length > 16) { socket.destroy(); return }
      if (!input.includes('\n')) return
      socket.removeListener('data', read)
      if (input !== 'bycli\n') { socket.end('error\n'); return }
      socket.setTimeout(0)
      void ensure().then(
        () => { if (!socket.destroyed) socket.end('ready\n') },
        () => { if (!socket.destroyed) socket.end('error\n') },
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => { server.removeListener('error', reject); resolve() })
  })
  try { await chmod(path, 0o600) }
  catch (error) { server.close(); await unlink(path).catch(() => undefined); throw error }
  return { async close() {
    stopping = true
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await unlink(path).catch(() => undefined)
  } }
}
