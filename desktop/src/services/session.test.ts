import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountService } from '../service'
import { Vault } from './vault'
import { BrowserLogin } from './browser'
import { mintToken } from './riot'
import { accountId, extractSecret, totp } from './totp'
import type { SavedAccount } from './storage'

const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA===='
const dirs: string[] = [], services: AccountService[] = []
const spies: { mockRestore(): void }[] = []
const jwt = (seconds = 3600) => `e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + seconds })).toString('base64url')}.synthetic`
const json = (body: unknown, status = 200, headers: Headers | Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })
function setup(accounts: SavedAccount[] = [{ name: 'primary#TEST', seed, puuid: 'primary', sso: { ssid: 'original' } }]) {
  const dir = mkdtempSync(join(tmpdir(), 'riot2fa-session-')); dirs.push(dir)
  const vault = new Vault(dir, Buffer.alloc(32, 9)); vault.write('accounts', accounts)
  const service = new AccountService(false, dir, false, vault); services.push(service)
  return { service, vault, dir, id: accounts[0] ? accountId(accounts[0]) : '', reopen() { const reopened = new AccountService(false, dir, false, vault); services.push(reopened); return reopened } }
}
function network(handler: (url: URL, options: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; options: RequestInit }[] = []
  spies.push(spyOn(globalThis, 'fetch').mockImplementation((async (input: any, options: RequestInit = {}) => {
    const url = new URL(String(input)); calls.push({ url, options }); return handler(url, options)
  }) as typeof fetch))
  return calls
}
function browser(puuid = 'primary') {
  spies.push(spyOn(BrowserLogin.prototype, 'login').mockResolvedValue({ cookies: { account: 'synthetic' }, sso: { ssid: 'reconnected' }, csrf: 'synthetic-csrf' }))
  return (url: URL) => url.pathname.endsWith('/user') ? json({ puuid, alias: { game_name: 'primary', tag_line: 'TEST' } }) : undefined
}
const qr = { url: 'https://authenticate.riotgames.com/?suuid=12345678-test&cluster=eu1' }
afterEach(() => { for (const s of services.splice(0)) s.close(); for (const s of spies.splice(0)) s.mockRestore(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

test('RSO cookie rotation is retained, deleted cookies removed and unrelated cookies excluded', async () => {
  const token = jwt()
  network(() => json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${token}` } } }, 200, new Headers([['set-cookie', 'ssid=renewed; Secure; HttpOnly; Path=/'], ['set-cookie', 'clid=; Max-Age=0'], ['set-cookie', 'unrelated=not-stored'] ])))
  expect(await mintToken({ ssid: 'old', clid: 'old', tdid: 'device' })).toEqual({ token, cookies: { ssid: 'renewed', tdid: 'device' } })
})

test('cached bearer is used first; expiry after three days renews and survives encrypted restart', async () => {
  let now = 1800000000000
  spies.push(spyOn(Date, 'now').mockImplementation(() => now))
  const s = setup([{ name: 'primary#TEST', seed, puuid: 'primary', sso: { ssid: 'original' }, access_token: jwt() }])
  const calls = network(url => url.hostname === 'auth.riotgames.com' ? json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt()}` } } }, 200, { 'set-cookie': 'ssid=rotated; Secure; Path=/' }) : json({}))
  await s.service.call('qr_prepare', { accountId: s.id, ...qr })
  expect(calls.filter(c => c.url.hostname === 'auth.riotgames.com')).toHaveLength(0)
  now += 3 * 24 * 3600 * 1000
  await s.service.call('qr_prepare', { accountId: s.id, ...qr })
  expect(calls.filter(c => c.url.hostname === 'auth.riotgames.com')).toHaveLength(1)
  expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.sso?.ssid).toBe('rotated')
  const reopened = s.reopen()
  await reopened.call('qr_prepare', { accountId: s.id, ...qr })
  expect(calls.filter(c => c.url.hostname === 'auth.riotgames.com')).toHaveLength(1)
  expect(reopened.state.accounts[0]!.session).toBe('connected')
  expect(reopened.state.accounts[0]!.code).toBe(totp(seed, now))
})

test('expired online session preserves offline codes, identity and secrets across a month and restart', async () => {
  let now = 1800000000000
  spies.push(spyOn(Date, 'now').mockImplementation(() => now))
  const s = setup()
  network(() => json({ type: 'auth' }))
  await expect(s.service.call('qr_prepare', { accountId: s.id, ...qr })).rejects.toThrow('Reconnect')
  expect(s.service.state.accounts[0]!.session).toBe('expired')
  now += 30 * 24 * 3600 * 1000
  const reopened = s.reopen()
  expect(reopened.state.accounts[0]!.code).toBe(totp(seed, now))
  expect(reopened.state.accounts[0]!.id).toBe(s.id)
  expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.seed).toBe(seed)
})

test('network outage and access refusal do not falsely mark the session expired', async () => {
  const s = setup()
  let status = 503
  network(() => json({}, status))
  await expect(s.service.call('qr_prepare', { accountId: s.id, ...qr })).rejects.toThrow('503')
  expect(s.service.state.accounts[0]!.session).toBe('saved')
  status = 403
  await expect(s.service.call('qr_prepare', { accountId: s.id, ...qr })).rejects.toThrow('refused')
  expect(s.service.state.accounts[0]!.session).toBe('saved')
})

test('QR 401 refreshes once; approval refreshes again if the bearer expires during review', async () => {
  let now = 1800000000000, infoCalls = 0, approvals = 0, mints = 0
  spies.push(spyOn(Date, 'now').mockImplementation(() => now))
  const s = setup([{ name: 'primary#TEST', seed, puuid: 'primary', sso: { ssid: 'original' }, access_token: jwt() }])
  network(url => {
    if (url.hostname === 'auth.riotgames.com') { mints++; return json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt(45)}` } } }) }
    if (url.pathname.endsWith('/info')) return ++infoCalls === 1 ? json({}, 401) : json({})
    approvals++; return json({ success: true })
  })
  const result = await s.service.call('qr_prepare', { accountId: s.id, ...qr })
  expect(infoCalls).toBe(2); expect(mints).toBe(1); expect(approvals).toBe(0)
  now += 50000
  await s.service.call('qr_approve', { confirmation: result.confirmation })
  expect(mints).toBe(2); expect(approvals).toBe(1)
  await expect(s.service.call('qr_approve', { confirmation: result.confirmation })).rejects.toThrow('expired')
  expect(approvals).toBe(1)
})

test('failed QR approval is not retried on network errors', async () => {
  const s = setup([{ name: 'primary#TEST', seed, puuid: 'primary', access_token: jwt() }])
  let approvals = 0
  network(url => { if (url.pathname.endsWith('/info')) return json({}); approvals++; return json({}, 503) })
  const result = await s.service.call('qr_prepare', { accountId: s.id, ...qr })
  await expect(s.service.call('qr_approve', { confirmation: result.confirmation })).rejects.toThrow('503')
  expect(approvals).toBe(1)
})

test('reconnect verifies the existing seed without enrolling again or changing other accounts', async () => {
  const other = { name: 'secondary#TEST', seed: 'JBSWY3DPEHPK3PXP', puuid: 'secondary', sso: { ssid: 'other' } }
  const s = setup([{ name: 'primary#TEST', seed, puuid: 'primary', sso: { ssid: 'old' }, sessionExpired: true }, other])
  const user = browser()
  const calls = network((url, options) => {
    const u = user(url); if (u) return u
    if (url.hostname === 'auth.riotgames.com') return json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt()}` } } }, 200, { 'set-cookie': 'ssid=fresh; Path=/' })
    expect(url.pathname).toEndWith('/verify')
    expect(JSON.parse(String(options.body)).otp).toBe(totp(seed)); return json({})
  })
  await s.service.call('reconnect', { accountId: s.id })
  const saved = s.vault.read<SavedAccount[]>('accounts', [])
  expect(saved[0]!.seed).toBe(seed); expect(saved[0]!.verification).toBe('verified'); expect(saved[0]!.sso?.ssid).toBe('fresh')
  expect(saved[1]).toEqual(other)
  expect(s.service.state.accounts[0]!.id).toBe(s.id)
  expect(calls.some(c => c.url.pathname.endsWith('/enable'))).toBe(false)
})

test('reconnect rejects the wrong Riot identity without altering any saved account', async () => {
  const s = setup(), before = s.vault.read('accounts', [])
  const user = browser('wrong-account'); const calls = network(url => user(url) || json({}, 500))
  await expect(s.service.call('reconnect', { accountId: s.id })).rejects.toThrow('different account')
  expect(s.vault.read('accounts', [])).toEqual(before); expect(calls).toHaveLength(1)
})

test('adding an existing identity reconnects without calling enrollment', async () => {
  const s = setup(), user = browser()
  const calls = network(url => user(url) || (url.hostname === 'auth.riotgames.com' ? json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt()}` } } }) : json({})))
  await s.service.call('login')
  expect(s.service.state.accounts).toHaveLength(1)
  expect(calls.some(c => c.url.pathname.endsWith('/enable'))).toBe(false)
})

test('new enrollment preserves unverified secret on failure and completes on retry', async () => {
  const s = setup([]), user = browser(); let verifyStatus = 503
  network(url => user(url) || (url.pathname.endsWith('/factors') ? json([{ factor: 'email', status: 'enabled' }]) : url.pathname.endsWith('/enable') ? json({ secret: seed }) : url.hostname === 'auth.riotgames.com' ? json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt()}` } } }) : json({}, verifyStatus)))
  await expect(s.service.call('login')).rejects.toThrow('not verified')
  expect(s.service.state.accounts[0]!.verification).toBe('pending')
  expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.seed).toBe(seed)
  verifyStatus = 200
  await s.service.call('verify', { accountId: s.service.state.accounts[0]!.id })
  expect(s.service.state.accounts[0]!.verification).toBe('verified')
})

test('already enabled MFA with no saved secret is not reset or re-enrolled', async () => {
  const s = setup([]), user = browser()
  const calls = network(url => user(url) || json([{ factor: 'email', status: 'enabled' }, { factor: 'riotmobile', status: 'enabled' }]))
  await expect(s.service.call('login')).rejects.toThrow('Import its existing secret')
  expect(s.service.state.accounts).toHaveLength(0)
  expect(calls.some(c => c.url.pathname.endsWith('/enable'))).toBe(false)
})

test('Riot rejection labels the code and never destroys the saved secret', async () => {
  const s = setup([{ name: 'primary#TEST', seed, puuid: 'primary', access_token: jwt() }])
  network(() => json({}, 400))
  await expect(s.service.call('verify', { accountId: s.id })).rejects.toThrow('Riot rejected this code')
  expect(s.service.state.accounts[0]!.verification).toBe('rejected')
  expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.seed).toBe(seed)
})

test('manual secret is bound to a Riot identity only after Riot accepts its code', async () => {
  const s = setup([{ name: 'manual', seed }]), user = browser(); let status = 400
  network(url => user(url) || (url.hostname === 'auth.riotgames.com' ? json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt()}` } } }) : json({}, status)))
  await expect(s.service.call('reconnect', { accountId: s.id })).rejects.toThrow()
  expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.puuid).toBeUndefined()
  status = 200
  await s.service.call('reconnect', { accountId: s.id })
  expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.puuid).toBe('primary')
  expect(s.service.state.accounts[0]!.id).toBe(s.id)
})

test('non-Riot authenticator settings are rejected instead of generating silently wrong codes', () => {
  expect(() => extractSecret(`otpauth://totp/test?secret=${seed}&algorithm=SHA1`)).toThrow('different settings')
  expect(() => extractSecret(`otpauth://hotp/test?secret=${seed}`)).toThrow('different settings')
  expect(() => extractSecret(`otpauth://totp/test?secret=${seed}&digits=8`)).toThrow('different settings')
})

// Independently generated by the original Python implementation linked by the user.
test('codes match the original Python implementation at rollover, three days, thirty days and a year', () => {
  for (const [timestamp, code] of [[1800000000000, '249947'], [1800000029000, '249947'], [1800000030000, '323407'], [1800259200000, '366281'], [1802592000000, '820869'], [1831536000000, '056770']] as const) expect(totp(seed, timestamp)).toBe(code)
})

test('a revoked cookie retains the account in QR recovery and keeps its offline code', async () => {
  const s = setup()
  network(() => json({ type: 'auth' }, 200, { 'set-cookie': 'ssid=; Max-Age=0; Path=/' }))
  await expect(s.service.call('qr_prepare', { accountId: s.id, ...qr })).rejects.toThrow('Reconnect')
  expect(s.service.state.accounts[0]!.session).toBe('expired')
  expect(s.service.state.accounts[0]!.qrEnabled).toBe(true)
  expect(s.service.state.accounts[0]!.code).toBe(totp(seed))
  expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.sso).toEqual({})
})

test('a stale scheduled renewal cannot overwrite a browser reconnection', async () => {
  const s = setup(), user = browser()
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { started = resolve })
  network(async (url, options) => {
    const u = user(url); if (u) { release(); return u }
    if (url.hostname === 'auth.riotgames.com') {
      if (new Headers(options.headers).get('cookie') === 'ssid=original') { started(); await gate; return json({ type: 'auth' }) }
      return json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt()}` } } }, 200, { 'set-cookie': 'ssid=latest; Path=/' })
    }
    return json({})
  })
  const renewal = (s.service as any).renewSessions()
  await ready
  await s.service.call('reconnect', { accountId: s.id })
  await renewal
  const saved = s.vault.read<SavedAccount[]>('accounts', [])[0]!
  expect(saved.sso?.ssid).toBe('latest')
  expect(saved.sessionExpired).toBe(false)
  expect(saved.verification).toBe('verified')
})

test('a failed old renewal does not fail a newly completed browser reconnection', async () => {
  const s = setup(), user = browser()
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { started = resolve })
  const unsubscribe = s.service.subscribe(() => { if (s.vault.read<SavedAccount[]>('accounts', [])[0]!.sso?.ssid === 'reconnected') release() })
  network(async (url, options) => {
    const u = user(url); if (u) return u
    if (url.hostname === 'auth.riotgames.com') {
      if (new Headers(options.headers).get('cookie') === 'ssid=original') { started(); await gate; throw new Error('Old request lost its connection') }
      return json({ type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=${jwt()}` } } }, 200, { 'set-cookie': 'ssid=newest; Path=/' })
    }
    return json({})
  })
  try {
    const renewal = (s.service as any).renewSessions()
    await ready
    await s.service.call('reconnect', { accountId: s.id })
    await renewal
    expect(s.vault.read<SavedAccount[]>('accounts', [])[0]!.sso?.ssid).toBe('newest')
    expect(s.service.state.accounts[0]!.verification).toBe('verified')
  } finally { unsubscribe() }
})

test('a transient account push registration failure is retried for the same delivery token', async () => {
  const s = setup([{ name: 'primary#TEST', seed, puuid: 'primary', sso: { ssid: 'original' }, access_token: jwt() }])
  let status = 503
  const calls = network(() => json({}, status))
  await (s.service as any).registerExisting('same-delivery-token')
  expect(s.service.state.pushStatus).toContain('will retry')
  status = 200
  await (s.service as any).registerExisting('same-delivery-token')
  expect(calls).toHaveLength(2)
  expect(s.service.state.pushStatus).toBe('Listening')
  await (s.service as any).registerExisting('same-delivery-token')
  expect(calls).toHaveLength(2)
})
