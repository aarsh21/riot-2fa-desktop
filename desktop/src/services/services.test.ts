import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountService } from '../service'
import { accountId, decodeBase32, extractSecret, totp } from './totp'
import { dataDirectory, writeJson } from './storage'
import { Vault } from './vault'
import { cookiesForHost } from './browser'
import { cookieHeader, parseQr, tokenValid } from './riot'

const dirs: string[] = [], services: AccountService[] = []
function directory() { const path = mkdtempSync(join(tmpdir(), 'riot2fa-test-')); dirs.push(path); return path }
function service(demo = true, path = directory()) { const s = new AccountService(demo, path, false, new Vault(path, Buffer.alloc(32, 7))); services.push(s); return s }
afterEach(() => { for (const s of services.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

test('SHA256 matches RFC 6238 at multiple timestamps', () => {
  const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA===='
  expect(totp(seed, 59000, 8)).toBe('46119246')
  expect(totp(seed, 1111111109000, 8)).toBe('68084774')
  expect(totp(seed, 2000000000000, 8)).toBe('90698825')
  expect(totp(seed, 59000)).toBe('119246')
})
test('secrets normalize URLs and reject malformed Base32', () => {
  expect(extractSecret('otpauth://totp/test?secret=gez dgnbvgy3tqojq')).toBe('GEZDGNBVGY3TQOJQ')
  expect(() => decodeBase32('not-valid!')).toThrow()
  expect(() => decodeBase32('A')).toThrow()
  expect(() => extractSecret('AAAA')).toThrow()
})
test('data paths preserve the original Windows directory and use native paths elsewhere', () => {
  expect(dataDirectory('win32', { APPDATA: '/data/appdata' }, '/home')).toBe(join('/data/appdata', 'Riot2FA'))
  expect(dataDirectory('darwin', {}, '/home')).toBe(join('/home', 'Library', 'Application Support', 'Riot2FA'))
  expect(dataDirectory('linux', { XDG_DATA_HOME: '/data' }, '/home')).toBe(join('/data', 'Riot2FA'))
  expect(dataDirectory('linux', { RIOT2FA_DATA_DIR: '/test' }, '/home')).toBe('/test')
})
test('atomic saves retain the last good file when serialization fails and clean temporary files', () => {
  const dir = directory(), path = join(dir, 'accounts.json')
  writeJson(path, [{ name: 'before' }], dir)
  const invalid: any = {}; invalid.self = invalid
  expect(() => writeJson(path, invalid, dir)).toThrow()
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([{ name: 'before' }])
  expect(readdirSync(dir)).toEqual(['accounts.json'])
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
})
test('corrupt account storage is not silently replaced', async () => {
  const dir = directory(); writeFileSync(join(dir, 'accounts.vault'), '{invalid')
  const s = service(false, dir)
  expect(s.error).toContain('could not be read')
  await expect(s.call('add', { name: 'test', secret: 'GEZDGNBVGY3TQOJQ' })).rejects.toThrow()
  expect(readFileSync(join(dir, 'accounts.vault'), 'utf8')).toBe('{invalid')
})
test('UI state contains codes and labels but no secrets or raw request payloads', () => {
  const s = service()
  expect(s.state.accounts).toHaveLength(3)
  expect(Object.keys(s.state.accounts[0]!).sort()).toEqual(['code', 'id', 'name', 'qrEnabled', 'session', 'verification', 'verifiedAt'])
  expect(JSON.stringify(s.state)).not.toContain('synthetic-expired')
  expect(JSON.stringify(s.state)).not.toContain('JBSWY3DPEHPK3PXP')
  expect(s.state.requests[0]).not.toHaveProperty('raw')
})
test('invalid manual entry leaves all accounts intact', async () => {
  const s = service(), before = s.state.accounts.map(a => a.id)
  await expect(s.call('add', { name: 'test', secret: 'invalid!' })).rejects.toThrow('Base32')
  expect(s.state.accounts.map(a => a.id)).toEqual(before)
})
test('manual add, duplicate detection and removal work without touching disk in demo', async () => {
  const dir = directory(), s = service(true, dir)
  await s.call('add', { name: 'local', secret: 'GEZDGNBVGY3TQOJQ' })
  await expect(s.call('add', { name: 'duplicate', secret: 'gez dgnbvgy3tqojq' })).rejects.toThrow('already')
  const added = s.state.accounts.find(a => a.name === 'local')!
  await s.call('remove', { accountId: added.id })
  expect(s.state.accounts).toHaveLength(3)
  expect(readdirSync(dir)).toEqual([])
})
test('local persistence encrypts secrets and reopens without a service process', async () => {
  const dir = directory(), s = service(false, dir)
  await s.call('add', { name: 'local', secret: 'GEZDGNBVGY3TQOJQ' })
  expect(new Vault(dir, Buffer.alloc(32, 7)).read<unknown>('accounts', [])).toEqual([{ name: 'local', seed: 'GEZDGNBVGY3TQOJQ' }])
  const reopened = service(false, dir)
  expect(reopened.state.accounts[0]!.name).toBe('local')
})
test('requests remain pending until explicit approval or denial', async () => {
  const s = service()
  expect(s.state.requests).toHaveLength(1)
  const result = await s.call('respond', { requestId: 'demo-request', approve: false })
  expect(result.message).toBe('Sign-in denied')
  expect(s.state.requests).toHaveLength(0)
  await expect(s.call('respond', { requestId: 'demo-request', approve: true })).rejects.toThrow('already handled')
})
test('QR identifiers are encoded safely and require both fields', () => {
  expect(parseQr('https://example.com/?suuid=12345678-abcd&cluster=eu1')).toEqual({ suuid: '12345678-abcd', cluster: 'eu1' })
  expect(() => parseQr('https://example.com/?suuid=12345678-abcd&cluster=eu1%26injected=true')).toThrow()
  expect(() => parseQr('https://example.com/?suuid=12345678-abcd')).toThrow()
})
test('browser cookies cannot cross unrelated domains', () => {
  const cookies = [{ name: 'ssid', value: 'right', domain: '.riotgames.com' }, { name: 'ssid', value: 'wrong', domain: '.notriotgames.com' }] as any
  expect(cookiesForHost(cookies, 'auth.riotgames.com')).toEqual({ ssid: 'right' })
  expect(cookieHeader({ ssid: 'safe', bad: 'bad\r\nvalue' })).toBe('ssid=safe')
  expect(cookieHeader({ 'authenticator.sid': 'session', 'bad=name': 'rejected', 'bad value': 'rejected', 'bad-control': 'bad\0value' })).toBe('authenticator.sid=session')
})
test('cached access tokens need a future expiry', () => {
  const token = (payload: object) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
  expect(tokenValid(token({ exp: Date.now() / 1000 + 60 }))).toBe(true)
  expect(tokenValid(token({ exp: 1 }))).toBe(false)
  expect(tokenValid(token({}))).toBe(false)
})
