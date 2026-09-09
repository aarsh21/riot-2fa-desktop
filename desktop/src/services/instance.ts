import { createServer, createConnection, type Server } from 'node:net'
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
export async function claimInstance(directory: string, onShow: () => void): Promise<Server | null> {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\riot2fa-${createHash('sha256').update(resolve(directory)).digest('hex')}` : join(directory, 'control.sock')
  const listen = () => new Promise<Server>((resolve, reject) => {
    const server = createServer(socket => {
      socket.setTimeout(1000, () => socket.destroy())
      socket.once('data', data => { if (data.toString() === 'show') onShow(); socket.end() })
      socket.on('error', () => {})
    })
    server.once('error', reject)
    server.listen(path, () => { server.removeListener('error', reject); if (process.platform !== 'win32') chmodSync(path, 0o600); resolve(server) })
  })
  try { return await listen() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    const existing = await new Promise<boolean>((resolve, reject) => {
      const socket = createConnection(path)
      socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('The running app is not responding.')) })
      socket.once('connect', () => { socket.end('show'); resolve(true) })
      socket.once('error', error => { if (['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code || '')) resolve(false); else reject(error) })
    })
    if (existing) return null
    if (process.platform !== 'win32' && existsSync(path)) unlinkSync(path)
    return listen()
  }
}
