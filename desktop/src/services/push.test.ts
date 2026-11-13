import { afterEach, expect, spyOn, test } from 'bun:test'
import { PushReceiver } from '@eneris/push-receiver'
import { installFCM, refreshFCMInstallationToken } from '@eneris/push-receiver/dist/fcm'
import protos from '@eneris/push-receiver/dist/protos'
import type { ClientConfig, Credentials } from '@eneris/push-receiver/dist/types'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vault } from './vault'
import { PushClient, pushConfiguration } from './push'
const spies: { mockRestore(): void }[] = [], receivers: PushReceiver[] = [], dirs: string[] = [], clients: PushClient[] = []
const checkin = () => {
  const message = protos.checkin_proto.AndroidCheckinResponse.fromObject({ androidId: '12345', securityToken: '67890' })
  return new Response(protos.checkin_proto.AndroidCheckinResponse.encode(message).finish())
}
function saved(expired = true): Credentials {
  return { keys: { privateKey: 'private-key', publicKey: 'public-key', authSecret: 'auth-secret' }, gcm: { androidId: '12345', securityToken: '11111', appId: 'old-app', token: 'gcm-token' }, fcm: { token: 'old-push', installation: { fid: 'test-fid', token: 'old-installation', refreshToken: 'refresh-secret', createdAt: Date.now() - (expired ? 8 * 86400000 : 1000), expiresIn: 7 * 86400000 } }, config: { projectId: pushConfiguration.firebase.projectId, bundleId: pushConfiguration.bundleId, vapidKey: '' } }
}
function network(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = []
  spies.push(spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init: RequestInit = {}) => { const url = new URL(String(input)); calls.push({ url, init }); return handler(url, init) }) as typeof fetch))
  return calls
}
afterEach(() => { for (const c of clients.splice(0)) c.close(); for (const r of receivers.splice(0)) r.destroy(); for (const s of spies.splice(0)) s.mockRestore(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

test('Firebase installation sends the Android restriction metadata without leaking it to other APIs', async () => {
  const calls = network(() => Response.json({ authToken: { token: 'fresh', expiresIn: '604800s' }, refreshToken: 'refresh', fid: 'fid' }))
  await installFCM(pushConfiguration)
  const headers = new Headers(calls[0]!.init.headers)
  expect(headers.get('X-Android-Package')).toBe(pushConfiguration.firebase.androidPackage)
  expect(headers.get('X-Android-Cert')).toBe(pushConfiguration.firebase.androidCert)
  expect(calls[0]!.url.hostname).toBe('firebaseinstallations.googleapis.com')
})

test('installation refresh uses the documented installations path and preserves the refresh identity', async () => {
  const old = saved().fcm.installation
  const calls = network(() => Response.json({ token: 'renewed', expiresIn: '604800s' }))
  const next = await refreshFCMInstallationToken(old, pushConfiguration)
  expect(calls[0]!.url.pathname).toBe('/v1/projects/leagueconnect-1f13a/installations/test-fid/authTokens:generate')
  expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('FIS_v2 refresh-secret')
  expect(next.fid).toBe(old.fid); expect(next.refreshToken).toBe(old.refreshToken)
  expect(next.token).toBe('renewed'); expect(next.expiresIn).toBe(604800000)
})

test('eight-day-old credentials renew installation and FCM registration while retaining delivery keys', async () => {
  const old = saved()
  const calls = network(url => url.pathname === '/checkin' ? checkin() : url.pathname.endsWith('authTokens:generate') ? Response.json({ token: 'renewed-installation', expiresIn: '604800s' }) : Response.json({ token: 'renewed-push' }))
  const receiver = new PushReceiver({ ...pushConfiguration, credentials: old }); receivers.push(receiver)
  let updated: Credentials | undefined
  receiver.onCredentialsChanged(event => { updated = event.newCredentials })
  const next = await receiver.registerIfNeeded()
  expect(next.keys).toEqual(old.keys)
  expect(next.fcm.token).toBe('renewed-push')
  expect(next.gcm.securityToken).toBe('67890')
  expect(updated).toEqual(next)
  expect(calls.map(c => c.url.pathname)).toEqual(['/checkin', '/v1/projects/leagueconnect-1f13a/installations/test-fid/authTokens:generate', '/v1/projects/leagueconnect-1f13a/registrations'])
  expect(new Headers(calls[0]!.init.headers).has('X-Android-Cert')).toBe(false)
})

test('fresh cached credentials survive reordered metadata without a new installation', async () => {
  const old = saved(false), calls = network(() => checkin())
  const receiver = new PushReceiver({ ...pushConfiguration, credentials: old }); receivers.push(receiver)
  const next = await receiver.registerIfNeeded()
  expect(next.fcm).toEqual(old.fcm); expect(calls).toHaveLength(1)
})

test('deleted installations are replaced while permission refusals preserve existing credentials', async () => {
  const old = saved()
  let refused = false
  const calls = network(url => {
    if (url.pathname === '/checkin') return checkin()
    if (url.pathname.endsWith('authTokens:generate')) return Response.json({ error: {} }, { status: refused ? 403 : 404 })
    if (url.pathname.endsWith('/installations')) return Response.json({ fid: 'replacement', authToken: { token: 'new', expiresIn: '604800s' }, refreshToken: 'new-refresh' })
    return Response.json({ token: 'new-push' })
  })
  const first = new PushReceiver({ ...pushConfiguration, credentials: old }); receivers.push(first)
  expect((await first.registerIfNeeded()).fcm.installation.fid).toBe('replacement')
  refused = true
  const second = new PushReceiver({ ...pushConfiguration, credentials: old }); receivers.push(second)
  await expect(second.registerIfNeeded()).rejects.toMatchObject({ status: 403 })
  expect(second.fcmToken).toBe('old-push')
  expect(calls.filter(c => c.url.pathname.endsWith('/installations'))).toHaveLength(1)
})

test('closing the listener during registration settles startup and prevents a late socket connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riot2fa-push-')); dirs.push(directory)
  const vault = new Vault(directory, Buffer.alloc(32, 19))
  let resolve!: () => void, destroyed = false
  const wait = new Promise<void>(r => { resolve = r })
  const states: string[] = []
  const receiver = { persistentIds: [], fcmToken: '', onCredentialsChanged: () => () => {}, onNotification: () => () => {}, on: () => () => {}, onReady: () => () => {}, connect: () => wait, destroy: () => { destroyed = true } }
  const client = new PushClient(vault, () => {}, status => states.push(status), () => {}, () => receiver); clients.push(client)
  const starting = client.start()
  client.close()
  await starting
  resolve()
  expect(destroyed).toBe(true); expect(states).toEqual([])
})

test('destroying the real receiver during registration prevents a late TLS connection', async () => {
  const tls = await import('node:tls')
  const socket = spyOn(tls.default, 'connect'); spies.push(socket)
  const receiver = new PushReceiver(pushConfiguration); receivers.push(receiver)
  let finish!: (credentials: Credentials) => void
  const gate = new Promise<Credentials>(resolve => { finish = resolve })
  spies.push(spyOn(receiver, 'registerIfNeeded').mockImplementation(() => gate))
  const connecting = receiver.connect()
  receiver.destroy()
  finish(saved(false))
  await connecting
  expect(socket).not.toHaveBeenCalled()
})
