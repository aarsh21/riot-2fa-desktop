// Helper for verify-live-qr.ts. No credentials or identities are committed.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { render } from '@gpuix/react'
import { prepareFonts } from '../src/fonts'
import { App } from '../src/ui'
import { AccountService } from '../src/service'
import { Vault } from '../src/services/vault'
import { tokenValid } from '../src/services/riot'
const directory = process.env.RIOT2FA_LIVE_TEST_DIRECTORY
if (!directory || !process.argv.includes('--live-qr-test')) throw new Error('Start this helper through the explicit live QR verifier')
const auth = JSON.parse(readFileSync(join(directory, 'authorization.json'), 'utf8')) as { token: string; puuid: string; sso?: Record<string, string> }
const vaultPath = join(directory, 'vault')
mkdirSync(vaultPath, { mode: 0o700 })
const vault = new Vault(vaultPath, randomBytes(32))
// No existing TOTP secret is available in this test. The empty seed deliberately
// produces no code; live QR validation must not imply OTP validation.
vault.write('accounts', [{ name: 'Live QR validation', seed: '', puuid: auth.puuid, access_token: auth.token, sso: auth.sso }])
const transport = globalThis.fetch
const requests: { host: string; path: string; method: string; status: number }[] = []
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const response = await transport(input, init)
  const url = new URL(String(input))
  requests.push({ host: url.hostname, path: url.pathname, method: init?.method || 'GET', status: response.status })
  writeFileSync(join(directory, 'app-requests.json'), JSON.stringify(requests), { mode: 0o600 })
  return response
}) as typeof fetch
const service = new AccountService(false, vaultPath, false, vault)
service.subscribe(() => {
  const saved = vault.read<{ access_token?: string; sso?: Record<string, string> }[]>('accounts', [])[0]
  writeFileSync(join(directory, 'vault-state.json'), JSON.stringify({ hasValidCachedToken: tokenValid(saved?.access_token), hasSso: Boolean(saved?.sso?.ssid), session: service.state.accounts[0]?.session }), { mode: 0o600 })
})
process.on('SIGTERM', () => { service.close(); process.exit(0) })
await prepareFonts()
render(<App service={service} />, { title: 'Riot 2FA · Live QR test', width: 1080, height: 760, windowBackground: 'opaque', focus: false })
