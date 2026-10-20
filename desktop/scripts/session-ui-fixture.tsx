// Launched only by verify-session-ui.ts. All data and network responses are synthetic.
import { render } from '@gpuix/react'
import { prepareFonts } from '../src/fonts'
import { App } from '../src/ui'
import { AccountService } from '../src/service'
import { Vault } from '../src/services/vault'
import { BrowserLogin } from '../src/services/browser'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const directory = process.env.RIOT2FA_TEST_DIRECTORY!
if (!directory || !process.argv.includes('--session-fixture')) throw new Error('Test fixture requires an isolated directory')
const vault = new Vault(directory, Buffer.alloc(32, 17))
const calls: string[] = []
BrowserLogin.prototype.login = async () => ({ cookies: { fixture: 'synthetic' }, sso: { ssid: 'reconnected' }, csrf: 'fixture' })
globalThis.fetch = (async (input: unknown) => {
  const url = new URL(String(input)); calls.push(url.pathname)
  let value: unknown
  if (url.pathname.endsWith('/user')) value = { puuid: 'primary', alias: { game_name: 'primary', tag_line: 'TEST' } }
  else if (url.hostname === 'auth.riotgames.com') value = { type: 'response', response: { parameters: { uri: `http://localhost/redirect#access_token=e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.fixture` } } }
  else if (url.pathname.endsWith('/verify')) value = {}
  else throw new Error('Unexpected network request in fixture')
  writeFileSync(join(directory, 'calls.json'), JSON.stringify(calls))
  return new Response(JSON.stringify(value), { headers: { 'set-cookie': 'ssid=rotated; Secure; Path=/' } })
}) as typeof fetch
const service = new AccountService(false, directory, false, vault)
process.on('SIGTERM', () => { service.close(); process.exit(0) })
await prepareFonts()
render(<App service={service} />, { title: 'Riot 2FA · Session test', width: 1080, height: 760, windowBackground: 'opaque', focus: false })
