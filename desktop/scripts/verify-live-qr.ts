/**
 * Explicit live test against challenges this script creates itself.
 * Requires a private JSON file { token, puuid } from the account owner's login.
 * Never run in ordinary CI. Does not enroll, disable or replace an MFA factor.
 * Target-side QR handshake cross-checked against @windowsedd/valorant-api 1.2.0
 * (MIT), src/core/qr-auth.ts in its published distribution.
 */
import { connectStdio, type App } from '@gpuix/react/automation'
import { spawn } from 'node:child_process'
import { readFileSync, statSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { realpathSync } from 'node:fs'
import { Vault } from '../src/services/vault'
import { tokenValid } from '../src/services/riot'
import { pushConfiguration } from '../src/services/push'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { request, cookieHeader, SSO_COOKIE_NAMES } from '../src/services/riot'
type Authorization = { token: string; puuid: string; sso?: Record<string, string> }
type RecordedRequest = { host: string; path: string; method: string; status: number }
const source = process.env.RIOT2FA_LIVE_AUTH_FILE
if (!source || !process.argv.includes('--approve-own-challenge')) throw new Error('Live test requires RIOT2FA_LIVE_AUTH_FILE and --approve-own-challenge')
if (process.platform !== 'win32' && (statSync(source).mode & 0o077)) throw new Error('Live authorization file must be private (chmod 600)')
const auth = JSON.parse(readFileSync(source, 'utf8')) as Authorization
if (!auth.token || !auth.puuid) throw new Error('Missing account authorization')
const output = resolve(import.meta.dir, '../test-results')
mkdirSync(output, { recursive: true })
const targetAgent = 'RiotGamesApi/24.9.1.4445 rso-authenticator (Windows;10;;Professional, x64) riot_client/0'
function parseCookies(headers: Headers) {
  return Object.fromEntries(headers.getSetCookie().map(value => { const pair = value.split(';', 1)[0]!, i = pair.indexOf('='); return [pair.slice(0, i), pair.slice(i + 1)] }))
}
async function nativeQrFlow(authorization: Authorization, expectRenewal: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'riot2fa-live-qr-'))
  writeFileSync(join(directory, 'authorization.json'), JSON.stringify(authorization), { mode: 0o600 })
  const sdkSid = randomUUID()
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': targetAgent, baggage: `sdksid=${sdkSid}` }
  let app: App | undefined
  const binary = expectRenewal ? process.env.RIOT2FA_VERIFY_BINARY : undefined
  let vault: Vault | undefined, testKey: { service: string; name: string } | undefined
  if (binary) {
    vault = await Vault.open(directory)
    testKey = { service: 'dev.riot2fa.desktop', name: createHash('sha256').update(realpathSync(directory)).digest('hex') }
    vault.write('accounts', [{ name: 'Live QR validation', seed: '', puuid: authorization.puuid, access_token: authorization.token, sso: authorization.sso }])
  }
  try {
    const created = await request('https://authenticate.riotgames.com/api/v1/login', { method: 'POST', headers, body: JSON.stringify({ client_id: 'riot-client', language: 'en', platform: 'windows', remember: false, type: 'auth', qrcode: {} }) })
    const challenge = await created.json() as { suuid?: string; cluster?: string; timestamp?: number }
    assert.ok(challenge.suuid && challenge.cluster && challenge.timestamp, 'Riot must return fresh QR identifiers')
    const cookies = parseCookies(created.headers)
    const poll = async () => {
      const response = await request('https://authenticate.riotgames.com/api/v1/login', { headers: { ...headers, Cookie: cookieHeader(cookies) } })
      return await response.json() as any
    }
    assert.notEqual((await poll()).type, 'success', 'The target must be signed out before approval')
    const child = spawn(binary || 'bun', binary ? ['--no-tray'] : ['scripts/live-qr-ui.tsx', '--live-qr-test'], { cwd: binary ? dirname(binary) : resolve(import.meta.dir, '..'), env: { ...process.env, RIOT2FA_LIVE_TEST_DIRECTORY: directory, RIOT2FA_DATA_DIR: directory, GPUIX_BACKGROUND: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    app = await connectStdio({ write: chunk => { child.stdin.write(chunk) }, feed: listener => { child.stdout.on('data', chunk => listener(chunk.toString())) }, close: async () => { child.kill(); await new Promise<void>(resolve => child.once('exit', () => resolve())) } })
    await app.getByText('Live QR validation').waitFor({ timeoutMs: 20000 })
    await app.getByTestId('nav-qr').press('enter')
    const url = `https://qrlogin.riotgames.com/riotmobile?${new URLSearchParams({ suuid: challenge.suuid!, cluster: challenge.cluster!, timestamp: String(challenge.timestamp) })}`
    await app.getByTestId('qr-url').fill(url)
    await app.getByTestId('review-qr').press('enter')
    await app.getByText('Approve this sign-in?').waitFor({ timeoutMs: 20000 })
    assert.notEqual((await poll()).type, 'success', 'Reviewing must not approve the target session')
    await app.getByTestId('confirm-action').press('enter')
    await app.getByText('QR sign-in approved').waitFor({ timeoutMs: 20000 })
    const after = await poll()
    assert.equal(after.type, 'success', 'The independent target must confirm successful authentication')
    assert.ok(after.success?.login_token, 'Riot must issue a login token to the target')
    let requests: RecordedRequest[] = []
    let cachedTokenPersisted = false
    if (vault) {
      const saved = vault.read<{ access_token?: string; sso?: Record<string, string> }[]>('accounts', [])[0]!
      assert.ok(tokenValid(saved.access_token), 'The compiled app must save its renewed bearer')
      assert.ok(saved.sso?.ssid, 'The compiled app must preserve the renewable session')
      const current = await request('https://auth.riotgames.com/userinfo', { headers: { Authorization: `Bearer ${saved.access_token}` } })
      assert.equal((await current.json() as any).sub, authorization.puuid, 'The bearer minted by the compiled app must belong to the authorized account')
      cachedTokenPersisted = true
      await app.getByTestId('nav-requests').press('enter')
      await app.getByText('Listening').waitFor({ timeoutMs: 30000 })
      // Shut down before revoking this test-only delivery registration.
      await app.close(); app = undefined
      const delivery = vault.read<any>('fcm_credentials-js', {}).credentials
      assert.ok(delivery?.fcm?.token, 'The compiled listener must persist delivery credentials')
      const firebase = pushConfiguration.firebase
      const removed = await fetch(`https://fcmregistrations.googleapis.com/v1/projects/${firebase.projectId}/registrations/${encodeURIComponent(delivery.fcm.token)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': firebase.apiKey, 'x-goog-firebase-installations-auth': delivery.fcm.installation.token, 'X-Android-Package': firebase.androidPackage, 'X-Android-Cert': firebase.androidCert }, signal: AbortSignal.timeout(20000) })
      assert.ok(removed.ok, 'The disposable compiled-test delivery registration must be removed')
    } else {
      requests = JSON.parse(readFileSync(join(directory, 'app-requests.json'), 'utf8')) as RecordedRequest[]
      const expected: [string, string, number][] = [...(expectRenewal ? [['/api/v1/authorization', 'POST', 200] as [string, string, number]] : []), ['/api/v1/session/info', 'GET', 200], ['/api/v1/session/authentication', 'POST', 200]]
      assert.deepEqual(requests.map(r => [r.path, r.method, r.status]), expected)
      const saved = JSON.parse(readFileSync(join(directory, 'vault-state.json'), 'utf8'))
      assert.equal(saved.hasValidCachedToken, true)
      if (expectRenewal) { assert.equal(saved.hasSso, true); assert.equal(saved.session, 'connected') }
      cachedTokenPersisted = expectRenewal
    }
    return { loginToken: String(after.success.login_token), evidence: { cachedTokenExpiredAtStart: expectRenewal, explicitNativeReview: true, reviewDoesNotApprove: true, explicitNativeApproval: true, independentTargetLoginSucceeded: true, serverIssuedLoginToken: true, renewedCredentialsPersistedInEncryptedVault: cachedTokenPersisted, packagedExecutable: binary ? { path: binary, sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), osCredentialStoreUsed: true, mintedBearerIdentityMatched: true, googleListenerReady: true, testDeliveryRegistrationRemoved: true } : undefined, appRequests: requests } }
  } finally { await app?.close(); if (testKey) await Bun.secrets.delete(testKey); rmSync(directory, { recursive: true, force: true }) }
}
const identityResponse = await request('https://auth.riotgames.com/userinfo', { headers: { Authorization: `Bearer ${auth.token}` } })
const identity = await identityResponse.json() as { sub?: string }
assert.equal(identity.sub, auth.puuid, 'The token must belong to the supplied account identity')
const initial = await nativeQrFlow(auth, false)
console.log('PASS live native QR approval and independent target authentication')
// Complete the target login using Riot's returned login token, then prove that
// the app itself renews a deliberately expired local cache from the real session.
const exchanged = await request('https://auth.riotgames.com/api/v1/login-token', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'RiotGamesApi/24.10.1.4471 rso-auth (Windows;10;;Professional, x64) riot_client/0' }, body: JSON.stringify({ authentication_type: null, code_verifier: '', login_token: initial.loginToken, persist_login: false }) })
assert.equal(exchanged.status, 204, 'Riot must accept the target login token')
const returned = parseCookies(exchanged.headers)
const sso = Object.fromEntries(SSO_COOKIE_NAMES.filter(name => returned[name]).map(name => [name, returned[name]!]))
assert.ok(sso.ssid, 'The completed target login must provide a renewable session')
const expired = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.expired-cache`
const renewal = await nativeQrFlow({ puuid: auth.puuid, token: expired, sso }, true)
console.log('PASS live renewal from an expired cached bearer, native QR approval, and encrypted persistence')
const root = resolve(import.meta.dir, '..')
const sources = ['src/service.ts', 'src/ui.tsx', 'src/services/riot.ts', 'src/services/browser.ts', 'src/services/storage.ts', 'src/services/vault.ts', 'src/services/totp.ts', 'scripts/live-qr-ui.tsx', 'scripts/verify-live-qr.ts'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }))
const report = { passed: true, sources, recordedAt: new Date().toISOString(), environment: process.platform, network: 'Live Riot endpoints; unmocked AccountService and native interface', liveIdentityMatches: true, challengesCreatedByThisTest: true, initial: initial.evidence, afterCachedTokenExpiry: renewal.evidence, otpAcceptance: 'Not tested: existing authenticator secret not available', credentialsRecordedInEvidence: false, screenshots: 'Omitted to avoid capturing real account data or request location' }
writeFileSync(join(output, 'live-qr.json'), JSON.stringify(report, null, 2))
