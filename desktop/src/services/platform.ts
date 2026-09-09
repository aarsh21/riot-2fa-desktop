import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import jsQR from 'jsqr'
import { ServiceError, parseQr } from './riot'

function tool(name: string) { const bundled = join(dirname(process.execPath), 'tools', name); return existsSync(bundled) ? bundled : name }
async function run(args: string[], input?: string, env = process.env): Promise<string> {
  const child = Bun.spawn(args, { stdin: input === undefined ? 'ignore' : 'pipe', stdout: input === undefined ? 'pipe' : 'ignore', stderr: 'ignore', env, windowsHide: true })
  if (input !== undefined && child.stdin) { child.stdin.write(input); child.stdin.end() }
  const timer = setTimeout(() => child.kill(), 30000)
  try {
    const [text, code] = await Promise.all([child.stdout ? new Response(child.stdout).text() : Promise.resolve(''), child.exited])
    if (code !== 0) throw new Error('Platform command failed')
    return text.trimEnd()
  } finally { clearTimeout(timer) }
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
export async function captureQr(): Promise<string> {
  const temporary = mkdtempSync(join(tmpdir(), 'riot2fa-qr-'))
  const path = join(temporary, 'capture.png')
  try {
    if (process.platform === 'darwin') await run(['screencapture', '-x', '-i', path])
    else if (process.platform === 'win32') {
      await Bun.sleep(1500)
      await run(ps('Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $r=[System.Windows.Forms.SystemInformation]::VirtualScreen; $b=New-Object System.Drawing.Bitmap($r.Width,$r.Height); $g=[System.Drawing.Graphics]::FromImage($b); try { $g.CopyFromScreen($r.Location,[System.Drawing.Point]::Empty,$r.Size); $b.Save($env:RIOT2FA_CAPTURE,[System.Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose(); $b.Dispose() }'), undefined, { ...process.env, RIOT2FA_CAPTURE: path })
    } else if (process.env.WAYLAND_DISPLAY) {
      const region = await run([tool('slurp')])
      if (!/^-?\d+,-?\d+ \d+x\d+$/.test(region)) throw new Error('No selection')
      await run([tool('grim'), '-g', region, path])
    } else {
      await run([tool('import'), '-window', 'root', path])
    }
    const bytes = readFileSync(path)
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    if (width * height > 40000000) throw new ServiceError('The capture is too large. Select only the QR code.')
    const png = PNG.sync.read(bytes)
    const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    if (!result) throw new ServiceError('No QR code found. Make the code fully visible and try again, or paste its URL.')
    parseQr(result.data)
    return result.data
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
