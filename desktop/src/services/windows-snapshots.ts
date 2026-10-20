import script from '../native/windows-snapshot.ps1' with { type: 'text' }
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeQrImage } from './qr-image'
import { ServiceError } from './riot'
export type SnapshotEvent = { url?: string; error?: string; status?: string }
export class WindowsSnapshots {
  private stopCurrent: (() => void) | null = null
  start(onEvent: (event: SnapshotEvent) => void) { return this.run('watch', onEvent) }
  capture(mode: 'region' | 'selftest' = 'region', signal?: AbortSignal, fixture?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new ServiceError('Capture cancelled.')); return }
      const abort = () => { this.close(); reject(new ServiceError('Capture cancelled.')) }
      signal?.addEventListener('abort', abort, { once: true })
      this.run(mode, event => {
        if (event.url || event.error) {
          signal?.removeEventListener('abort', abort)
          this.close()
          if (event.url) resolve(event.url)
          else reject(new ServiceError(event.error || 'Screen capture failed.'))
        }
      }, fixture)
    })
  }
  private run(mode: string, onEvent: (event: SnapshotEvent) => void, fixture?: string) {
    this.close()
    const directory = mkdtempSync(join(tmpdir(), 'riot2fa-snapshot-'))
    let stopped = false, buffer = '', heartbeat = Date.now()
    let child: ReturnType<typeof Bun.spawn>
    try {
      child = Bun.spawn(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        env: { ...process.env, RIOT2FA_SNAPSHOT_MODE: mode, RIOT2FA_SNAPSHOT_DIR: directory, RIOT2FA_SNAPSHOT_FIXTURE: fixture || '', RIOT2FA_PARENT_PID: String(process.pid) },
        stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', windowsHide: true,
      })
    } catch {
      rmSync(directory, { recursive: true, force: true })
      onEvent({ error: 'Windows screen capture could not start.', status: 'Unavailable' }); return
    }
    const finish = () => {
      if (stopped) return
      stopped = true; clearInterval(timer); child.kill()
      // Wait for Windows to release file handles before removing temporary pixels.
      void child.exited.finally(() => { try { rmSync(directory, { recursive: true, force: true }) } catch {} })
    }
    this.stopCurrent = finish
    const timer = setInterval(() => {
      if (Date.now() - heartbeat > (mode === 'watch' ? 15000 : 70000)) { onEvent({ error: 'Screen capture timed out. Try again.', status: 'Unavailable' }); finish() }
    }, 1000)
    const handle = (line: string) => {
      if (stopped) return
      let event: { type?: string; file?: string }
      try { event = JSON.parse(line) } catch { return }
      heartbeat = Date.now()
      if (event.type === 'ready') onEvent({ status: 'Both Shift keys' })
      if (event.type === 'error' || event.type === 'cancelled') onEvent({ error: event.type === 'cancelled' ? 'Capture cancelled.' : 'The window could not be captured. Try selecting a region.' })
      if (event.type !== 'capture') return
      if (!event.file || !/^[0-9a-f-]{36}\.png$/i.test(event.file)) { onEvent({ error: 'Invalid capture response.' }); return }
      const path = join(directory, event.file)
      try { onEvent({ url: decodeQrImage(readFileSync(path)) }) }
      catch (error) { onEvent({ error: error instanceof ServiceError ? error.message : 'The captured image could not be read.' }) }
      finally { try { unlinkSync(path) } catch {} }
    }
    void (async () => {
      const stream = child.stdout as ReadableStream<Uint8Array>
      const reader = stream.getReader(), decoder = new TextDecoder()
      try {
        while (!stopped) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          if (buffer.length > 65536) { onEvent({ error: 'Invalid capture response.' }); finish(); break }
          let newline: number
          while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); handle(line) }
        }
      } catch { if (!stopped) onEvent({ error: 'Screen capture stopped unexpectedly.', status: 'Unavailable' }) }
      finally {
        reader.releaseLock()
        if (!stopped) { onEvent({ error: 'Screen capture stopped. Enable it again to retry.', status: 'Unavailable' }); finish() }
      }
    })()
  }
  close() { this.stopCurrent?.(); this.stopCurrent = null }
}
