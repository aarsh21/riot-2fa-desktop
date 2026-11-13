/** Explicit live integration check; never run by normal CI or unit tests. */
import { readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { PushClient, pushConfiguration } from '../src/services/push'
import { Vault } from '../src/services/vault'
import { registerPush } from '../src/services/riot'
import type { Credentials } from '@eneris/push-receiver/dist/types'
const source = process.env.RIOT2FA_LIVE_AUTH_FILE, credentialsFile = process.env.RIOT2FA_LIVE_PUSH_CREDENTIALS_FILE
if (!source || !credentialsFile || !process.argv.includes('--register-this-test-device')) throw new Error('Live push test requires private authorization and existing test-device credential files, plus --register-this-test-device')
for (const file of [source, credentialsFile]) if (process.platform !== 'win32' && (statSync(file).mode & 0o077)) throw new Error('Live credential files must be private (chmod 600)')
const auth = JSON.parse(readFileSync(source, 'utf8')) as { token: string }
const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8')) as Credentials
const originalKeys = { ...credentials.keys }
credentials.fcm.installation.createdAt = Date.now() - 8 * 86400000
const directory = mkdtempSync(join(tmpdir(), 'riot2fa-live-push-'))
const vault = new Vault(directory, randomBytes(32))
vault.write('fcm_credentials-js', { credentials, ids: [] })
const statuses: string[] = [], requests: { host: string; path: string; status: number }[] = []
const transport = globalThis.fetch
let deliveryToken = ''
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const response = await transport(input, init)
  const url = new URL(String(input))
  requests.push({ host: url.hostname, path: url.pathname.replace(/\/installations\/[^/]+\/authTokens:generate$/, '/installations/:fid/authTokens:generate').replace(/\/registrations\/.+$/, '/registrations/:token'), status: response.status })
  return response
}) as typeof fetch
const client = new PushClient(vault, () => {}, status => statuses.push(status), token => { deliveryToken = token })
try {
  await client.start()
  assert.ok(deliveryToken, 'Google must authenticate the live delivery connection')
  const renewed = vault.read<{ credentials: Credentials }>('fcm_credentials-js', null as never).credentials
  assert.ok(renewed.fcm.installation.createdAt > credentials.fcm.installation.createdAt, 'Expired local installation metadata must be renewed')
  assert.deepEqual(renewed.keys, originalKeys, 'Renewal must preserve delivery decryption keys')
  await registerPush(auth.token, deliveryToken)
  assert.ok(requests.some(r => r.path.endsWith('/authTokens:generate') && r.status === 200))
  assert.ok(requests.some(r => r.host === 'fcmregistrations.googleapis.com' && r.status === 200))
  assert.ok(requests.some(r => r.host === 'riot-geo.mps.si.riotgames.com' && r.status === 204))
  let testRegistrationDeleted = false
  if (process.argv.includes('--delete-test-registration')) {
    const removed = await fetch(`https://fcmregistrations.googleapis.com/v1/projects/${pushConfiguration.firebase.projectId}/registrations/${encodeURIComponent(deliveryToken)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': pushConfiguration.firebase.apiKey, 'x-goog-firebase-installations-auth': renewed.fcm.installation.token, 'X-Android-Package': pushConfiguration.firebase.androidPackage, 'X-Android-Cert': pushConfiguration.firebase.androidCert }, signal: AbortSignal.timeout(20000) })
    testRegistrationDeleted = removed.ok
    assert.ok(testRegistrationDeleted, 'The disposable test delivery registration must be removed')
  }
  const root = resolve(import.meta.dir, '..')
  const sources = ['src/services/push.ts', 'src/services/riot.ts', 'src/services/vault.ts', 'patches/@eneris%2Fpush-receiver@4.3.1.patch', 'scripts/verify-live-push.ts'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }))
  const report = { passed: true, recordedAt: new Date().toISOString(), environment: process.platform, network: 'Live Google Firebase and Riot device endpoints; unmocked PushClient', googleListenerConnected: true, tlsCertificateVerificationEnabled: true, riotDeviceRegistrationAccepted: true, installationRenewedAfterEightDayLocalExpiry: true, deliveryDecryptionKeysPreserved: true, testRegistrationDeleted, statuses, requests, sources, liveNotificationDelivery: 'Not tested: this test did not generate an MFA notification', credentialsRecordedInEvidence: false }
  mkdirSync(join(root, 'test-results'), { recursive: true })
  writeFileSync(join(root, 'test-results/live-push.json'), JSON.stringify(report, null, 2))
  console.log('LIVE push passed: expired installation renewed → authenticated Google delivery connection → Riot accepts device registration. Notification delivery remains untested.')
} finally { client.close(); globalThis.fetch = transport; rmSync(directory, { recursive: true, force: true }) }
