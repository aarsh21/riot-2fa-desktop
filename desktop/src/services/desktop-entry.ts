import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
export function ensureDesktopEntry() {
  if (process.platform !== 'linux') return
  const directory = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'applications')
  const args = [process.execPath, ...(import.meta.url.includes('$bunfs') ? [] : [fileURLToPath(new URL('../main.tsx', import.meta.url))])]
  const quote = (s: string) => '"' + s.replaceAll('\\', '\\\\\\\\').replaceAll('"', '\\\\"').replaceAll('`', '\\\\`').replaceAll('$', '\\\\$').replaceAll('%', '%%').replaceAll('\n', '') + '"'
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'dev.riot2fa.desktop.desktop'), `[Desktop Entry]\nType=Application\nName=Riot 2FA\nExec=${args.map(quote).join(' ')}\nTerminal=false\nCategories=Utility;Security;\nStartupWMClass=Riot 2FA\n`, { mode: 0o600 })
}
