import { connectStdio, type App } from '@gpuix/react/automation'
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { Vault } from '../src/services/vault'
import { accountId } from '../src/services/totp'
import type { SavedAccount } from '../src/services/storage'
const directory = mkdtempSync(join(tmpdir(), 'riot2fa-native-session-'))
const vault = new Vault(directory, Buffer.alloc(32, 17))
const accounts: SavedAccount[] = [
  { name: 'primary#TEST', seed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', puuid: 'primary', sso: { ssid: 'expired' }, sessionExpired: true },
  { name: 'secondary#TEST', seed: 'JBSWY3DPEHPK3PXP' },
]
vault.write('accounts', accounts)
const id = accountId(accounts[0]!)
const start = () => {
  const child = spawn('bun', ['scripts/session-ui-fixture.tsx', '--session-fixture'], { cwd: resolve(import.meta.dir, '..'), env: { ...process.env, RIOT2FA_TEST_DIRECTORY: directory, GPUIX_BACKGROUND: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.on('data', chunk => process.stderr.write(chunk))
  return connectStdio({ write: chunk => { child.stdin.write(chunk) }, feed: listener => { child.stdout.on('data', chunk => listener(chunk.toString())) }, close: async () => { child.kill(); await new Promise<void>(resolve => child.once('exit', () => resolve())) } })
}
let app: App | undefined
try {
  app = await start()
  await app.getByText('QR access needs reconnection').waitFor({ timeoutMs: 20000 })
  await app.getByText('secondary#TEST').waitFor()
  await app.getByTestId(`reconnect-${id}`).press('enter')
  await app.getByText('QR session active').waitFor()
  const saved = vault.read<SavedAccount[]>('accounts', [])
  assert.equal(saved[0]!.seed, accounts[0]!.seed)
  assert.equal(saved[0]!.verification, 'verified')
  assert.equal(saved[0]!.sso?.ssid, 'rotated')
  assert.deepEqual(saved[1], accounts[1])
  assert.equal(await app.getByText('primary#TEST').count(), 1)
  const calls = JSON.parse(readFileSync(join(directory, 'calls.json'), 'utf8')) as string[]
  assert.deepEqual(calls, ['/api/account/v1/user', '/api/v1/authorization', '/mfa/v1/factor/riotmobile/verify'])
  await app.close(); app = await start()
  await app.getByText('QR session active').waitFor({ timeoutMs: 20000 })
  await app.getByTestId(`copy-${id}`).press('enter')
  await app.getByText('Copied').waitFor()
  assert.equal(await app.getByText('secondary#TEST').count(), 1)
  const output = resolve(import.meta.dir, '../test-results')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'session-ui.json'), JSON.stringify({ passed: true, recordedAt: new Date().toISOString(), environment: process.platform, network: 'Intercepted synthetic Riot responses; no live account credentials', checks: ['Native keyboard reconnection', 'Code accepted state', 'Same secret and stable account identity', 'Rotated session persisted in encrypted vault', 'Second account unchanged', 'No re-enrollment request', 'Restart retains QR session', 'Copy code after restart'], requests: calls }, null, 2))
  console.log('Native session E2E passed: expired session → reconnect → verify code → encrypted restart → copy. Second account unchanged; no re-enrollment.')
} finally { await app?.close(); rmSync(directory, { recursive: true, force: true }) }
