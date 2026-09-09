import { fileURLToPath } from 'node:url'
import type { AccountService, State, Result } from './service'
import { startTray } from './services/tray'
export type ServiceView = Pick<AccountService, 'state' | 'subscribe' | 'call'>
type Message = { type: 'ready' | 'activate' } | { type: 'state'; state: State } | { type: 'call'; id: number; method: string; params: Record<string, unknown> } | { type: 'result'; id: number; result?: Result; error?: string }
export async function clientService(): Promise<ServiceView> {
  const listeners = new Set<() => void>(), pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>()
  let id = 0
  let first: () => void
  const initialized = new Promise<void>(resolve => { first = resolve })
  const service: ServiceView = {
    state: null as unknown as State,
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    call: (method, params = {}) => new Promise((resolve, reject) => { const current = ++id; pending.set(current, { resolve, reject }); process.send!({ type: 'call', id: current, method, params }) }),
  }
  process.on('message', (event: Message) => {
    if (event.type === 'state') { service.state = event.state; first(); for (const listener of listeners) listener() }
    if (event.type === 'result') { const call = pending.get(event.id); pending.delete(event.id); if (event.error) call?.reject(new Error(event.error)); else call?.resolve(event.result || {}) }
  })
  process.on('disconnect', () => process.exit(0))
  process.send!({ type: 'ready' })
  await initialized
  return service
}
export async function desktopHost(service: AccountService): Promise<boolean> {
  let child: ReturnType<typeof Bun.spawn> | null = null, quitting = false, trayAvailable = true
  let closeTray: (() => void) | undefined
  const quit = () => { if (quitting) return; quitting = true; child?.kill(); closeTray?.(); service.close(); process.exit(0) }
  const show = () => {
    if (quitting) return
    if (child) { try { child.send({ type: 'activate' }) } catch {} return }
    const compiled = import.meta.url.includes('$bunfs')
    const args = [process.execPath, ...(compiled ? [] : [fileURLToPath(new URL('./main.tsx', import.meta.url))]), '--ui']
    const window = child = Bun.spawn(args, {
      stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', windowsHide: true,
      ipc: async (event: Message) => {
        if (event.type === 'ready') { window.send({ type: 'state', state: service.state }); return }
        if (event.type !== 'call') return
        try { const result = await service.call(event.method, event.params); window.send({ type: 'result', id: event.id, result }) }
        catch (error) { try { window.send({ type: 'result', id: event.id, error: error instanceof Error ? error.message : 'Action failed.' }) } catch {} }
      },
    })
    void window.exited.then(() => { if (child === window) child = null; if (!trayAvailable) quit() })
  }
  try { closeTray = await startTray(show, quit, () => { trayAvailable = false; show() }) }
  catch { return false }
  let snapshotId: string | undefined
  service.subscribe(() => {
    if (service.state.snapshot?.id && service.state.snapshot.id !== snapshotId) { snapshotId = service.state.snapshot.id; show() }
    try { child?.send({ type: 'state', state: service.state }) } catch {}
  })
  process.once('SIGINT', quit); process.once('SIGTERM', quit); process.once('exit', () => { closeTray?.(); child?.kill(); service.close() })
  process.on('riot-show', show)
  show()
  return true
}
