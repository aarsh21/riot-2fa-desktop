import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type SavedAccount = { name: string; seed: string; puuid?: string; sso?: Record<string, string>; access_token?: string }
export function dataDirectory(platform = process.platform, env = process.env, home = homedir()) {
  if (env.RIOT2FA_DATA_DIR) return env.RIOT2FA_DATA_DIR
  const base = platform === 'win32' ? env.APPDATA || join(home, 'AppData', 'Roaming') : platform === 'darwin' ? join(home, 'Library', 'Application Support') : env.XDG_DATA_HOME || join(home, '.local', 'share')
  return join(base, 'Riot2FA')
}
export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
export function writeJson(path: string, value: unknown, directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.riot2fa-${randomUUID()}`)
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, path)
  } finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
export function loadAccounts(directory: string): SavedAccount[] {
  const data = readJson<unknown>(join(directory, 'accounts.json'), [])
  return validateAccounts(data)
}
export function validateAccounts(data: unknown): SavedAccount[] {
  if (!Array.isArray(data) || data.some(a => !a || typeof a.name !== 'string' || typeof a.seed !== 'string' || a.sso && (typeof a.sso !== 'object' || Object.values(a.sso).some(v => typeof v !== 'string')))) throw new Error('Account storage could not be read. Repair or restore accounts.json before adding accounts.')
  return data
}
