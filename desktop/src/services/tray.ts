import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
export async function startTray(onShow: () => void, onQuit: () => void, onLost: () => void) {
  if (process.platform === 'linux') {
    const { sessionBus } = await import('dbus-next')
    const bus = sessionBus()
    bus.on('error', () => {})
    try { await bus.getProxyObject('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher') }
    finally { bus.disconnect() }
  }
  const packaged = join(dirname(process.execPath), 'runtime', 'package.json')
  const require = createRequire(existsSync(packaged) ? packaged : import.meta.url)
  const pkg = require.resolve(`@trayjs/${process.platform}-${process.arch}/package.json`)
  const binary = join(dirname(pkg), 'bin', process.platform === 'win32' ? 'tray.exe' : 'tray')
  const assets = existsSync(packaged) ? join(dirname(process.execPath), 'assets') : join(import.meta.dir, '../../assets')
  const icon = readFileSync(join(assets, process.platform === 'win32' ? 'tray.ico' : 'tray.png')).toString('base64')
  const child = Bun.spawn([binary, '--tooltip', 'Riot 2FA'], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', windowsHide: true })
  const send = (message: unknown) => { try { child.stdin.write(JSON.stringify(message) + '\n') } catch {} }
  let stopped = false, ready = false
  const close = () => { stopped = true; child.stdin.end(); child.kill() }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { close(); reject(new Error('Tray unavailable')) }, 5000)
    void (async () => {
      let buffer = ''
      try {
        for await (const chunk of child.stdout) {
          buffer += new TextDecoder().decode(chunk)
          if (buffer.length > 65536) throw new Error('Invalid tray response')
          let index
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
            const event = JSON.parse(line)
            if (event.method === 'ready') { send({ method: 'setIcon', params: { base64: icon } }); ready = true; clearTimeout(timeout); resolve() }
            if (event.method === 'menuRequested') send({ method: 'setMenu', params: { items: [{ id: 'show', title: 'Open Riot 2FA' }, { id: 'quit', title: 'Quit Riot 2FA' }] } })
            if (event.method === 'clicked' && event.params?.id === 'show') onShow()
            if (event.method === 'clicked' && event.params?.id === 'quit') onQuit()
          }
        }
      } catch { /* Child failure is handled below. */ }
      finally { clearTimeout(timeout); if (!stopped) { if (ready) onLost(); else reject(new Error('Tray unavailable')) } }
    })()
  })
  return close
}
