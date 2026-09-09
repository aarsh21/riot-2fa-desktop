import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { decodeQrImage } from './qr-image'
import { WindowsSnapshots } from './windows-snapshots'
import { ServiceError } from './riot'

function tool(name: string) { const bundled = join(dirname(process.execPath), 'tools', name); return existsSync(bundled) ? bundled : name }
async function run(args: string[], input?: string, env = process.env, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new ServiceError('Capture cancelled.')
  const child = Bun.spawn(args, { stdin: input === undefined ? 'ignore' : 'pipe', stdout: input === undefined ? 'pipe' : 'ignore', stderr: 'ignore', env, windowsHide: true })
  if (input !== undefined && child.stdin) { child.stdin.write(input); child.stdin.end() }
  const abort = () => child.kill()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => child.kill(), 30000)
  try {
    const [text, code] = await Promise.all([child.stdout ? new Response(child.stdout).text() : Promise.resolve(''), child.exited])
    if (code !== 0) throw new Error('Platform command failed')
    return text.trimEnd()
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
const ps = (script: string) => ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script]
export async function readClipboard(): Promise<string> {
  if (process.platform === 'darwin') return run(['pbpaste'])
  if (process.platform === 'win32') return run(ps('Get-Clipboard -Raw'))
  return process.env.WAYLAND_DISPLAY ? run([tool('wl-paste'), '--no-newline']) : run([tool('xclip'), '-selection', 'clipboard', '-o'])
}
export async function writeClipboard(value: string): Promise<void> {
  try {
    if (process.platform === 'darwin') await run(['pbcopy'], value)
    else if (process.platform === 'win32') await run(ps('$value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value'), value)
    else if (process.env.WAYLAND_DISPLAY) await run([tool('wl-copy')], value)
    else await run([tool('xclip'), '-selection', 'clipboard'], value)
  } catch { throw new ServiceError('The clipboard is unavailable. Try again, or enter the visible code manually.') }
}
export async function systemDark(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') return (await run(['defaults', 'read', '-g', 'AppleInterfaceStyle'])).toLowerCase().includes('dark')
    if (process.platform === 'win32') return (await run(ps('(Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize).AppsUseLightTheme'))).trim() === '0'
    return !(await run(['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'])).includes('prefer-light')
  } catch { return process.platform !== 'darwin' }
}
export async function captureQr(signal?: AbortSignal): Promise<string> {
  if (process.platform === 'win32') return new WindowsSnapshots().capture('region', signal)
  const temporary = mkdtempSync(join(tmpdir(), 'riot2fa-qr-'))
  const path = join(temporary, 'capture.png')
  try {
    if (process.platform === 'darwin') await run(['screencapture', '-x', '-i', path], undefined, process.env, signal)
    else if (process.env.WAYLAND_DISPLAY) {
      const region = await run([tool('slurp')], undefined, process.env, signal)
      if (!/^-?\d+,-?\d+ \d+x\d+$/.test(region)) throw new Error('No selection')
      await run([tool('grim'), '-g', region, path], undefined, process.env, signal)
    } else {
      await run([tool('import'), path], undefined, process.env, signal)
    }
    return decodeQrImage(readFileSync(path))
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError('Screen capture was cancelled or is unavailable. Allow screen recording for this app, or paste the QR URL.')
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
export async function notifySignIn(name: string) {
  try {
    if (process.platform === 'linux') await run(['notify-send', '--app-name=Riot 2FA', 'Riot sign-in request', `Review the sign-in for ${name}.`])
    if (process.platform === 'darwin') await run(['osascript', '-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title "Riot 2FA"', '-e', 'end run', `Review the sign-in for ${name}.`])
    // Windows requests remain visible in the app. Toast registration belongs to the installer.
  } catch { /* Notifications are optional; requests remain in the app. */ }
}
