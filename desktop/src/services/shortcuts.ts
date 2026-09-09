import { ensureDesktopEntry } from './desktop-entry'
import { randomUUID } from 'node:crypto'
import { WindowsSnapshots, type SnapshotEvent } from './windows-snapshots'
import { captureQr } from './platform'

export class Snapshots {
  private stop: (() => void) | null = null
  private generation = 0
  private capture: AbortController | null = null
  start(onEvent: (event: SnapshotEvent) => void) {
    this.close()
    const generation = this.generation
    const emit = (event: SnapshotEvent) => { if (generation === this.generation) onEvent(event) }
    const trigger = async () => {
      if (generation !== this.generation || this.capture) return
      const controller = this.capture = new AbortController()
      try { emit({ url: await captureQr(controller.signal) }) }
      catch (e) { emit({ error: e instanceof Error ? e.message : 'Capture failed.' }) }
      finally { if (this.capture === controller) this.capture = null }
    }
    if (process.platform === 'win32') {
      const windows = new WindowsSnapshots(); this.stop = () => windows.close(); windows.start(emit); return
    }
    const started = process.platform === 'darwin' ? macShortcut(trigger, emit) : linuxShortcut(trigger, emit)
    void started.then(stop => { if (generation !== this.generation) stop(); else this.stop = stop }).catch(() => emit({ status: 'Shortcut unavailable. Check desktop permissions; Capture region remains available.' }))
  }
  close() { this.generation++; this.stop?.(); this.stop = null; this.capture?.abort(); this.capture = null }
}
async function macShortcut(trigger: () => Promise<void>, emit: (event: SnapshotEvent) => void) {
  // Physical left/right Shift flags, following T3's modifier-pair approach.
  const script = `ObjC.import('CoreGraphics'); ObjC.import('unistd');
function run() {
  if (!$.CGPreflightListenEventAccess() && !$.CGRequestListenEventAccess()) throw Error('Input Monitoring permission required');
  var previous = true; console.log('ready');
  while ($.getppid() !== 1) { var pressed = ($.CGEventSourceFlagsState(0) & 6) === 6;
    if (pressed && !previous) console.log('trigger'); previous = pressed; delay(0.05); }
}`
  const child = Bun.spawn(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
  let stopped = false
  void (async () => {
    let buffer = ''
    for await (const chunk of child.stderr) {
      buffer += new TextDecoder().decode(chunk)
      if (buffer.length > 8192) { child.kill(); break }
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1)
        if (stopped) return
        if (line === 'ready') emit({ status: 'Both Shift keys' })
        if (line === 'trigger') void trigger()
      }
    }
    if (!stopped) emit({ status: 'Allow Input Monitoring for Riot 2FA, then enable the shortcut again.' })
  })().catch(() => { if (!stopped) emit({ status: 'Shortcut unavailable' }) })
  return () => { stopped = true; child.kill() }
}
async function linuxShortcut(trigger: () => Promise<void>, emit: (event: SnapshotEvent) => void) {
  ensureDesktopEntry()
  const { sessionBus, Variant, Message } = await import('dbus-next')
  const bus = sessionBus()
  const destination = 'org.freedesktop.portal.Desktop', path = '/org/freedesktop/portal/desktop'
  let closed = false, session: string | undefined
  const close = () => {
    if (closed) return; closed = true
    if (session) void bus.call(new Message({ destination, path: session, interface: 'org.freedesktop.portal.Session', member: 'Close' })).catch(() => {}).finally(() => bus.disconnect())
    else bus.disconnect()
  }
  bus.on('error', () => { if (!closed) { emit({ status: 'Desktop shortcut connection lost. Enable it again to retry.' }); close() } })
  try {
    const desktop = await bus.getProxyObject(destination, path)
    // Identify this non-sandboxed app on portals that support Registry.
    try { await desktop.getInterface('org.freedesktop.host.portal.Registry').Register!('dev.riot2fa.desktop', {}) } catch {}
    const shortcuts = desktop.getInterface('org.freedesktop.portal.GlobalShortcuts')
    const request = async (invoke: (options: Record<string, InstanceType<typeof Variant>>) => Promise<string>) => {
      const token = 'riot_' + randomUUID().replaceAll('-', '')
      const sender = (bus as unknown as { name: string }).name.slice(1).replaceAll('.', '_')
      const requestPath = `/org/freedesktop/portal/desktop/request/${sender}/${token}`
      const match = `type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${requestPath}'`
      await bus.call(new Message({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'AddMatch', signature: 's', body: [match] }))
      return new Promise<Record<string, InstanceType<typeof Variant>>>((resolve, reject) => {
        const clean = () => { clearTimeout(timeout); bus.off('message', handler); void bus.call(new Message({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'RemoveMatch', signature: 's', body: [match] })).catch(() => {}) }
        const handler = (message: InstanceType<typeof Message>) => {
          if (message.path !== requestPath || message.member !== 'Response') return
          clean(); if (message.body[0] !== 0) reject(new Error('Shortcut permission was declined')); else resolve(message.body[1])
        }
        const timeout = setTimeout(() => { clean(); reject(new Error('Shortcut registration timed out')) }, 60000)
        bus.on('message', handler)
        void invoke({ handle_token: new Variant('s', token) }).catch(error => { clean(); reject(error) })
      })
    }
    const created = await request(options => shortcuts.CreateSession!({ ...options, session_handle_token: new Variant('s', 'riot_' + randomUUID().replaceAll('-', '')) }))
    session = typeof created.session_handle?.value === 'string' ? created.session_handle.value : undefined
    if (!session) throw new Error('No shortcut session')
    shortcuts.on('Activated', (handle: string, id: string) => { if (!closed && handle === session && id === 'capture') void trigger() })
    const bound = await request(options => shortcuts.BindShortcuts!(session, [['capture', { description: new Variant('s', 'Capture a Riot sign-in QR code'), preferred_trigger: new Variant('s', 'CTRL+ALT+s') }]], '', options))
    const bindings = bound.shortcuts?.value
    const binding = Array.isArray(bindings) ? bindings.find((entry: any[]) => entry[0] === 'capture') : undefined
    if (!binding) throw new Error('No shortcut was assigned')
    emit({ status: binding[1].trigger_description?.value || 'Assign dev.riot2fa.desktop:capture in your desktop shortcut settings' })
    return close
  } catch (error) { close(); throw error }
}

export { linuxShortcut }
