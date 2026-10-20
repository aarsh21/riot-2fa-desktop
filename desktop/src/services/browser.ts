import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { BrowserContext, Cookie } from 'patchright'
import { ServiceError, SSO_COOKIE_NAMES } from './riot'
export { SSO_COOKIE_NAMES } from './riot'

export function cookiesForHost(cookies: Cookie[], host: string) {
  return Object.fromEntries(cookies.filter(c => host === c.domain.replace(/^\./, '') || host.endsWith('.' + c.domain.replace(/^\./, ''))).sort((a, b) => a.domain.length - b.domain.length).map(c => [c.name, c.value]))
}
export class BrowserLogin {
  private context: BrowserContext | null = null
  private cancelled = false
  private running = false
  cancel() { this.cancelled = true; void this.context?.close().catch(() => {}) }
  async login(): Promise<{ cookies: Record<string, string>; sso: Record<string, string>; csrf: string } | null> {
    if (this.running) throw new ServiceError('A browser login is already open.')
    this.running = true; this.cancelled = false
    const temporary = mkdtempSync(join(tmpdir(), 'riot2fa-login-'))
    try {
      // Patchright resolves its own runtime files. The app package carries them internally.
      const bundled = join(dirname(process.execPath), 'runtime', 'node_modules', 'patchright', 'package.json')
      const require = createRequire(existsSync(bundled) ? bundled : import.meta.url)
      const shippedBrowser = join(dirname(process.execPath), 'browsers')
      if (existsSync(shippedBrowser)) process.env.PLAYWRIGHT_BROWSERS_PATH = shippedBrowser
      const devBrowser = resolve(import.meta.dir, '../../.native-browsers')
      if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(devBrowser)) process.env.PLAYWRIGHT_BROWSERS_PATH = devBrowser
      const { chromium } = require('patchright') as typeof import('patchright')
      this.context = await chromium.launchPersistentContext(temporary, { headless: false, viewport: null })
      const page = this.context.pages()[0] || await this.context.newPage()
      try { await page.goto('https://account.riotgames.com/', { waitUntil: 'commit', timeout: 30000 }) } catch { /* The user may still complete the login in the open browser. */ }
      const deadline = Date.now() + 600000
      while (Date.now() < deadline && !this.cancelled) {
        if (!this.context.pages().length) return null
        let cookies: Cookie[]
        try { cookies = await this.context.cookies() } catch { return null }
        const account = cookiesForHost(cookies, 'account.riotgames.com'), auth = cookiesForHost(cookies, 'auth.riotgames.com')
        if (auth.ssid && account['a12l-csrf-prod']) {
          // Cookies can appear before the login redirect finishes. Wait for the
          // authenticated account document and take its token before closing it.
          for (const tab of this.context.pages()) {
            let csrf: string | null = null
            try {
              const url = new URL(tab.url())
              if (url.origin !== 'https://account.riotgames.com' || /\/(?:log-in|login|logout|authorize)(?:\/|$)/i.test(url.pathname)) continue
              await tab.waitForLoadState('domcontentloaded', { timeout: 1000 })
              csrf = await tab.locator('meta[name="csrf-token"]').getAttribute('content', { timeout: 1000 })
              if (tab.url() !== url.href) continue
            } catch { continue }
            if (csrf) {
              const latest = await this.context.cookies()
              const currentAuth = cookiesForHost(latest, 'auth.riotgames.com')
              return { cookies: cookiesForHost(latest, 'account.riotgames.com'), sso: Object.fromEntries(SSO_COOKIE_NAMES.filter(k => currentAuth[k]).map(k => [k, currentAuth[k]!])), csrf }
            }
          }
        }
        await Bun.sleep(500)
      }
      return null
    } catch {
      if (this.cancelled) return null
      throw new ServiceError('The sign-in browser could not start. Reinstall the app, or run bunx patchright install chromium when developing from source.')
    } finally {
      await this.context?.close().catch(() => {})
      this.context = null; this.running = false
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}
