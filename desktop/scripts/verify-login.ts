// Offline browser integration check. Every browser request is intercepted.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { BrowserLogin } from '../src/services/browser'
const browserPath = resolve(import.meta.dir, '../.native-browsers')
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(browserPath)) process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath
const require = createRequire(import.meta.url)
const { chromium } = require('patchright') as typeof import('patchright')
const original = chromium.launchPersistentContext.bind(chromium)
let context: Awaited<ReturnType<typeof original>> | undefined
let onLogin!: () => void
const loginPage = new Promise<void>(resolve => { onLogin = resolve })
let authenticated = false
chromium.launchPersistentContext = async (...args) => {
  context = await original(...args)
  await context.addCookies([
    { name: 'ssid', value: 'synthetic-session', domain: '.riotgames.com', path: '/', secure: true },
    { name: 'a12l-csrf-prod', value: 'synthetic-cookie', domain: 'account.riotgames.com', path: '/', secure: true },
  ])
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!authenticated && url.pathname === '/') return route.fulfill({ status: 302, headers: { location: '/log-in' } })
    await route.fulfill({ contentType: 'text/html', body: `<html><head><meta name="csrf-token" content="${authenticated ? 'completed-token' : 'login-token'}"></head><body>Synthetic sign-in test</body></html>` })
    if (!authenticated) onLogin()
  })
  return context
}
const login = new BrowserLogin()
const timeout = setTimeout(() => login.cancel(), 10000)
try {
  let settled = false
  const result = login.login().then(value => { settled = true; return value })
  await Promise.race([loginPage, Bun.sleep(5000).then(() => { throw new Error('Login fixture did not load') })])
  await Bun.sleep(700)
  assert.equal(settled, false, 'Cookies on the login page must not finish the handoff')
  authenticated = true
  await context!.pages()[0]!.goto('https://account.riotgames.com/')
  const session = await result
  assert.equal(session?.csrf, 'completed-token')
  assert.equal(session?.sso.ssid, 'synthetic-session')
  console.log('Browser handoff passed: waits for account document and returns its CSRF token.')
} finally {
  clearTimeout(timeout)
  login.cancel()
  await context?.close().catch(() => {})
  chromium.launchPersistentContext = original
}
