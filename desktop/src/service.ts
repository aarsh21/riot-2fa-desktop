import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { accountId, extractSecret, totp } from './services/totp'
import { dataDirectory, validateAccounts, readJson, writeJson, type SavedAccount } from './services/storage'
import { Vault } from './services/vault'
import * as riot from './services/riot'
import { BrowserLogin } from './services/browser'
import { captureQr, notifySignIn, readClipboard, systemDark, writeClipboard } from './services/platform'
import { PushClient } from './services/push'
import type { SnapshotEvent } from './services/windows-snapshots'
import { Snapshots } from './services/shortcuts'

export type Account = { id: string; name: string; code: string | null; qrEnabled: boolean; session: 'local' | 'saved' | 'connected' | 'expired'; verification: 'unknown' | 'pending' | 'verified' | 'rejected'; verifiedAt?: number }
export type LoginRequest = { id: string; accountId: string; name: string; time: number | string | null; location: string; demo?: boolean }
export type State = { accounts: Account[]; requests: LoginRequest[]; remaining: number; pushStatus: string; demo: boolean; dark: boolean; storagePath: string; error: string | null; snapshotsEnabled: boolean; snapshotStatus: string; snapshot: (SnapshotEvent & { id: string }) | null }
export type Result = { message?: string; url?: string; confirmation?: string; name?: string; location?: string }
type PendingRequest = LoginRequest & { raw?: Record<string, unknown>; busy?: boolean }
type QrConfirmation = { accountId: string; suuid: string; cluster: string; expires: number }

async function loginStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  try { return await action() }
  catch (error) {
    throw new riot.ServiceError(`${label}: ${error instanceof riot.ServiceError ? error.message : 'The response could not be read. Try again.'}`)
  }
}

export class AccountService {
  state: State
  error: string | null = null
  private accounts: SavedAccount[] = []
  private requests = new Map<string, PendingRequest>()
  private confirmations = new Map<string, QrConfirmation>()
  private listeners = new Set<() => void>()
  private browser = new BrowserLogin()
  private push: PushClient | null = null
  private timer: ReturnType<typeof setInterval>
  private renewalTimer: ReturnType<typeof setInterval> | null = null
  private renewing = false
  private tokenRequests = new Map<string, Promise<string>>()
  private appearanceTimer: ReturnType<typeof setInterval> | null = null
  private clipboardTimers = new Set<ReturnType<typeof setTimeout>>()
  private stopped = false
  private busy = false
  private lastRegisteredToken = ''
  private themeDark = true
  private pushStatus = 'Starting listener'
  private snapshots = new Snapshots()
  private snapshotsEnabled = false
  private snapshotStatus = 'Off'
  private latestSnapshot: State['snapshot'] = null
  private captureController: AbortController | null = null

  constructor(private demo: boolean, private directory = dataDirectory(), live = true, private vault?: Vault, startupError?: string) {
    try {
      if (!demo && !vault) throw new Error(startupError || 'The encrypted vault is unavailable. Reopen the app after unlocking your OS credential store.')
      this.accounts = demo ? [
        { name: 'alex#EUW', seed: 'JBSWY3DPEHPK3PXP', sso: { ssid: 'synthetic' }, verification: 'verified', access_token: `e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.demo` },
        { name: 'alex#NA1', seed: 'KRUGS4ZANFZSAYJA' },
        { name: 'weekend#EUW', seed: 'MFRGGZDFMZTWQ2LK', sso: { ssid: 'synthetic-expired' }, sessionExpired: true },
      ] : validateAccounts(vault!.read('accounts', []))
    } catch (error) { this.error = error instanceof Error ? error.message : 'Account storage could not be read.' }
    if (demo) {
      this.pushStatus = 'Demo session'
      this.requests.set('demo-request', { id: 'demo-request', accountId: accountId(this.accounts[0]!), name: 'alex#EUW', time: Date.now(), location: 'Demo request', demo: true })
    }
    this.state = this.snapshot()
    this.timer = setInterval(() => this.emit(), 1000)
    if (!demo && live) {
      try {
        this.snapshotsEnabled = readJson<{ snapshotsEnabled?: boolean }>(join(directory, 'preferences.json'), {}).snapshotsEnabled === true
        if (this.snapshotsEnabled) this.startSnapshots()
      } catch { this.snapshotStatus = 'Could not read shortcut preference' }
      const appearance = async () => { this.themeDark = await systemDark(); if (!this.stopped) this.emit() }
      void appearance(); this.appearanceTimer = setInterval(() => void appearance(), 30000)
      if (!this.error) {
        this.push = new PushClient(this.vault!, data => this.onPush(data), status => { this.pushStatus = status; this.emit() }, token => { void this.registerExisting(token) })
        void this.push.start()
        void this.renewSessions()
        this.renewalTimer = setInterval(() => void this.renewSessions(), 15 * 60 * 1000)
      }
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private snapshot(): State {
    return {
      accounts: this.accounts.map(account => { let code: string | null = null; try { code = totp(account.seed) } catch {} return { id: accountId(account), name: account.name, code, qrEnabled: Boolean(account.puuid || account.sso?.ssid || account.access_token), session: account.sessionExpired ? 'expired' : !account.sso?.ssid && !account.access_token ? 'local' : riot.tokenValid(account.access_token) ? 'connected' : 'saved', verification: account.verification || 'unknown', verifiedAt: account.verifiedAt } }),
      requests: [...this.requests.values()].map(({ raw, busy, ...request }) => request), remaining: 30 - Math.floor(Date.now() / 1000) % 30,
      pushStatus: this.pushStatus, demo: this.demo, dark: this.themeDark, storagePath: this.demo ? 'In-memory demo' : this.directory, error: this.error,
      snapshotsEnabled: this.snapshotsEnabled, snapshotStatus: this.snapshotStatus, snapshot: this.latestSnapshot,
    }
  }
  private emit() { if (this.stopped) return; this.state = this.snapshot(); for (const listener of this.listeners) listener() }
  private account(id: unknown) { const account = this.accounts.find(a => accountId(a) === id); if (!account) throw new riot.ServiceError('This account no longer exists. Select another account.'); return account }
  private commit(next: SavedAccount[]) {
    if (this.error) throw new riot.ServiceError(this.error)
    if (!this.demo) {
      try { this.vault!.write('accounts', next) }
      catch { throw new riot.ServiceError('Could not save account data. Check free disk space and folder permissions. The previous account file has been preserved.') }
    }
    this.accounts = next
  }
  private store(account: SavedAccount) {
    const index = this.accounts.findIndex(a => a.puuid && a.puuid === account.puuid)
    if (index >= 0) { this.commit(this.accounts.map((a, i) => i === index ? account : a)); return }
    if (this.accounts.some(a => a.seed.toUpperCase().replace(/=+$/, '') === account.seed.toUpperCase().replace(/=+$/, ''))) throw new riot.ServiceError('This account secret has already been added.')
    this.commit([...this.accounts, account])
  }
  async call(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    if (method === 'cancel_scan') { this.captureController?.abort(); return {} }
    if (method === 'cancel_login') { this.browser.cancel(); return { message: 'Cancelling browser login' } }
    if (this.busy) throw new riot.ServiceError('Another action is still running. Wait for it to finish.')
    if (this.error) throw new riot.ServiceError(this.error)
    this.busy = true
    try {
      switch (method) {
        case 'add': {
          const name = String(params.name || '').trim()
          if (!name || name.length > 120) throw new riot.ServiceError('Enter an account name of 1 to 120 characters.')
          let seed: string
          try { seed = extractSecret(String(params.secret || '')) } catch (error) { throw new riot.ServiceError(error instanceof Error ? error.message : 'Invalid secret.') }
          this.store({ name, seed }); return { message: 'Account added' }
        }
        case 'remove': {
          const account = this.account(params.accountId)
          this.commit(this.accounts.filter(a => a !== account))
          for (const [id, request] of this.requests) if (request.accountId === params.accountId) this.requests.delete(id)
          return { message: 'Account removed from this device' }
        }
        case 'copy': {
          const account = this.account(params.accountId)
          const code = totp(account.seed)
          await writeClipboard(code)
          const timer = setTimeout(async () => {
            this.clipboardTimers.delete(timer)
            try { if (await readClipboard() === code) await writeClipboard('') } catch {}
          }, 30000)
          this.clipboardTimers.add(timer)
          return { message: 'Code copied. Clipboard clears after 30 seconds while the app is open.' }
        }
        case 'login': return await this.login()
        case 'reconnect': return await this.login(this.account(params.accountId))
        case 'verify': return await this.checkCode(this.account(params.accountId))
        case 'respond': return await this.respond(String(params.requestId), params.approve === true)
        case 'scan': {
          if (this.demo) throw new riot.ServiceError('Screen scanning is disabled in the demo.')
          this.captureController = new AbortController()
          try { return { url: await captureQr(this.captureController.signal) } }
          finally { this.captureController = null }
        }
        case 'snapshots': {
          const enabled = params.enabled === true
          if (!this.demo) writeJson(join(this.directory, 'preferences.json'), { snapshotsEnabled: enabled }, this.directory)
          this.snapshotsEnabled = enabled
          this.snapshots.close()
          this.snapshotStatus = enabled ? 'Starting shortcut' : 'Off'
          if (enabled && !this.demo) this.startSnapshots()
          return {}
        }
        case 'qr_prepare': return await this.prepareQr(String(params.accountId), String(params.url || ''))
        case 'qr_approve': return await this.approveQr(String(params.confirmation))
        case 'check_update': return await this.checkUpdate()
        default: throw new riot.ServiceError('Unknown action.')
      }
    } catch (error) {
      if (error instanceof riot.ServiceError) throw error
      throw new riot.ServiceError('The action failed. Check your connection and try again. Your saved accounts have not been cleared.')
    } finally { this.busy = false; this.emit() }
  }
  private async login(target?: SavedAccount): Promise<Result> {
    if (this.demo) throw new riot.ServiceError('Browser login is disabled in the demo. Launch normally to connect your account.')
    const session = await this.browser.login()
    if (!session) return { message: 'Browser login cancelled' }
    const user = await loginStep('Reading your Riot account', () => riot.fetchUser(session.cookies, session.csrf))
    const puuid = user.puuid || user.sub
    if (typeof puuid !== 'string' || !puuid) throw new riot.ServiceError('Riot did not return an account identity. Nothing was changed.')
    if (target?.puuid && target.puuid !== puuid) throw new riot.ServiceError(`Sign in to ${target.name} to reconnect it. You signed in to a different account; nothing was changed.`)
    if (target && !target.puuid) {
      if (this.accounts.some(a => a !== target && a.puuid === puuid)) throw new riot.ServiceError('That Riot account is already connected here. Nothing was changed.')
      // A manual secret must prove it belongs to the signed-in identity before
      // attaching that identity or enabling QR access for it.
      const sessionToken = await riot.mintToken(session.sso)
      if (!sessionToken.token) throw new riot.ServiceError('Riot needs another browser sign-in. Nothing was changed.')
      await riot.verifyMfa(sessionToken.token, target.seed)
      this.update(target, { puuid, sso: sessionToken.cookies, access_token: sessionToken.token, sessionExpired: false, verification: 'verified', verifiedAt: Date.now() })
      if (this.push?.token) {
        try { await this.authorized(target, token => riot.registerPush(token, this.push!.token)) }
        catch { this.lastRegisteredToken = ''; return { message: 'Riot accepted your code. QR access is connected; push registration will retry automatically.' } }
      }
      return { message: 'Riot accepted your code. Account connected for QR sign-in.' }
    }
    const existing = target || this.accounts.find(a => a.puuid === puuid)
    if (existing) {
      this.update(existing, { sso: session.sso, access_token: undefined, sessionExpired: false })
      const result = await this.checkCode(this.account(accountId(existing)))
      return { message: `Account reconnected. ${result.message}` }
    }
    const response = await loginStep('Checking two-factor authentication', () => riot.fetchFactors(session.cookies, session.csrf))
    const factors = Array.isArray(response) ? response : response.factors
    if (!Array.isArray(factors) || !factors.some(f => f.factor === 'email' && f.status === 'enabled')) throw new riot.ServiceError('Enable email two-factor authentication at account.riotgames.com, then try again.')
    if (factors.some(f => f.factor === 'riotmobile' && f.status === 'enabled')) throw new riot.ServiceError('Riot Mobile is already enabled. Import its existing secret, or reconnect the account on the device where you added it. This app cannot retrieve an existing secret, and will not reset it.')
    const seed = extractSecret(await loginStep('Connecting the authenticator', () => riot.enableMfa(session.cookies, session.csrf)))
    const account: SavedAccount = { name: riot.userName(user), seed, puuid, sso: session.sso, verification: 'pending' }
    // Preserve a newly issued secret even if verification is interrupted. Never
    // present it as verified until Riot has accepted an OTP made from this seed.
    this.store(account)
    try {
      const result = await this.checkCode(account)
      return { message: `Account added. ${result.message}` }
    } catch (error) {
      throw new riot.ServiceError(`Account saved, but setup is not verified. ${error instanceof riot.ServiceError ? error.message : 'Check your connection and try Check code.'}`)
    }
  }
  private update(account: SavedAccount, change: Partial<SavedAccount>) {
    this.commit(this.accounts.map(a => accountId(a) === accountId(account) ? { ...a, ...change } : a))
    this.emit()
  }
  private async checkCode(account: SavedAccount): Promise<Result> {
    if (this.demo) return { message: 'Demo code check. No request was sent to Riot.' }
    try {
      await this.authorized(account, token => riot.verifyMfa(token, account.seed))
      this.update(account, { verification: 'verified', verifiedAt: Date.now() })
    } catch (error) {
      if (error instanceof riot.ServiceError && error.status === 400) {
        this.update(account, { verification: 'rejected' })
        throw new riot.ServiceError('Riot rejected this code. Check that your computer sets time automatically. If Riot Mobile was set up again elsewhere, this saved secret may have been replaced. Reconnecting preserves your secret; it cannot repair a replaced secret.')
      }
      throw error
    }
    // Push registration is separate from code verification. Its failure must
    // neither mark valid codes broken nor claim that notifications are ready.
    if (this.push?.token) {
      try { await this.authorized(account, token => riot.registerPush(token, this.push!.token)) }
      catch { this.lastRegisteredToken = ''; return { message: 'Riot accepted your code. Push registration will retry automatically; use codes or QR sign-in.' } }
    }
    return { message: 'Riot accepted your code. Codes work offline; QR sign-in uses your online session.' }
  }
  private startSnapshots() {
    this.snapshots.start(event => {
      if (this.stopped) return
      if (event.status) this.snapshotStatus = event.status
      if (!this.busy && (event.url || event.error)) this.latestSnapshot = { ...event, id: randomUUID() }
      this.emit()
    })
  }
  private async validToken(account: SavedAccount, force = false): Promise<string> {
    account = this.account(accountId(account))
    if (!force && riot.tokenValid(account.access_token)) return account.access_token!
    const id = accountId(account)
    const pending = this.tokenRequests.get(id)
    if (pending) return pending
    const refresh = this.refreshToken(account)
    this.tokenRequests.set(id, refresh)
    try { return await refresh } finally { if (this.tokenRequests.get(id) === refresh) this.tokenRequests.delete(id) }
  }
  private async refreshToken(account: SavedAccount): Promise<string> {
    let session: riot.TokenSession
    try { session = await riot.mintToken(account.sso) }
    catch (error) {
      if (this.stopped) throw error
      const latest = this.account(accountId(account))
      if (latest.sso?.ssid !== account.sso?.ssid) return this.refreshToken(latest)
      if (error instanceof riot.ServiceError && error.kind === 'session') this.update(account, { sessionExpired: true, access_token: undefined })
      throw error
    }
    if (this.stopped) throw new riot.ServiceError('The app is closing. Your accounts are saved.')
    const latest = this.account(accountId(account))
    // A browser reconnection can finish while a scheduled refresh is in flight.
    // Never let an older response overwrite the newly connected session.
    if (latest.sso?.ssid !== account.sso?.ssid) {
      if (riot.tokenValid(latest.access_token)) return latest.access_token!
      return this.refreshToken(latest)
    }
    this.update(account, { sso: session.cookies, access_token: session.token || undefined, sessionExpired: !session.token })
    if (!session.token) throw new riot.ServiceError('Riot requires you to sign in again for QR access. Choose Reconnect on this account. Your saved secret and offline codes are unchanged.', 'session')
    return session.token
  }
  private async authorized<T>(account: SavedAccount, action: (token: string) => Promise<T>): Promise<T> {
    const token = await this.validToken(account)
    try { return await action(token) }
    catch (error) {
      // Retry only an explicit expired bearer response. Network errors and
      // invalid QR requests must never trigger a second approval submission.
      if (!(error instanceof riot.ServiceError) || error.status !== 401) throw error
      const renewed = await this.validToken(account, true)
      try { return await action(renewed) }
      catch (retryError) {
        if (retryError instanceof riot.ServiceError && retryError.status === 401) this.update(account, { access_token: undefined, sessionExpired: true })
        throw retryError
      }
    }
  }
  private async renewSessions() {
    if (this.renewing || this.busy || this.stopped) return
    this.renewing = true
    try {
      for (const account of [...this.accounts]) {
        if (this.stopped) break
        if (!account.sso?.ssid || account.sessionExpired) continue
        try { await this.validToken(account, true) } catch { /* Status is changed only on confirmed session expiry. */ }
      }
      if (!this.stopped && this.push?.token) await this.registerExisting(this.push.token)
    } finally { this.renewing = false }
  }
  private async registerExisting(token: string) {
    if (token === this.lastRegisteredToken || this.stopped) return
    let failures = 0, expired = false
    for (const account of [...this.accounts]) {
      if (!account.sso?.ssid || this.stopped) continue
      try { await riot.registerPush(await this.validToken(account), token) }
      catch (error) { failures++; expired ||= error instanceof riot.ServiceError && error.kind === 'session' }
    }
    this.lastRegisteredToken = failures ? '' : token
    if (failures) this.pushStatus = expired ? 'Listener connected · Some accounts need reconnection' : 'Listener connected · Account registration will retry'
    else if (this.pushStatus.startsWith('Listener connected')) this.pushStatus = 'Listening'
    this.emit()
  }
  private onPush(raw: Record<string, unknown>) {
    const account = this.accounts.find(a => a.puuid && a.puuid === raw.puuid)
    if (!account || typeof raw.suuid !== 'string' || typeof raw.cluster !== 'string') return
    if (this.requests.has(raw.suuid)) return
    const lat = raw.geolocation_latitude, lon = raw.geolocation_longitude
    this.requests.set(raw.suuid, { id: raw.suuid, accountId: accountId(account), name: account.name, time: typeof raw.attempted_at === 'number' || typeof raw.attempted_at === 'string' ? raw.attempted_at : null, location: lat != null && lon != null ? `${lat}, ${lon}` : 'Location unavailable', raw })
    void notifySignIn(account.name); this.emit()
  }
  private async respond(id: string, approve: boolean): Promise<Result> {
    const request = this.requests.get(id)
    if (!request) throw new riot.ServiceError('This request was already handled.')
    const account = this.account(request.accountId)
    if (!this.demo) await riot.respondToMfa(request.raw!, account.seed, approve)
    this.requests.delete(id)
    return { message: approve ? 'Sign-in approved' : 'Sign-in denied' }
  }
  private async prepareQr(id: string, url: string): Promise<Result> {
    if (this.demo) throw new riot.ServiceError('QR sign-in is disabled in the demo.')
    const account = this.account(id)
    if (!account.sso?.ssid && !account.access_token) throw new riot.ServiceError('QR sign-in needs an account added through browser login.')
    const { suuid, cluster } = riot.parseQr(url)
    const info = await this.authorized(account, token => riot.qrInfo(token, suuid, cluster))
    const geo = info.request?.geolocation || info.auth_session?.geolocation
    const location = geo?.lat != null && geo?.lon != null ? `${geo.lat}, ${geo.lon}` : 'Location unavailable'
    const confirmation = randomUUID()
    this.confirmations.clear()
    this.confirmations.set(confirmation, { accountId: id, suuid, cluster, expires: Date.now() + 90000 })
    return { confirmation, name: account.name, location }
  }
  private async approveQr(id: string): Promise<Result> {
    const request = this.confirmations.get(id)
    this.confirmations.delete(id)
    if (!request || request.expires < Date.now()) throw new riot.ServiceError('This confirmation expired. Scan the code again.')
    const account = this.account(request.accountId)
    const result = await this.authorized(account, token => riot.approveQr(token, request.suuid, request.cluster))
    if (Object.keys(result).length && result.success !== true) throw new riot.ServiceError('Riot did not confirm the sign-in. Try a new QR code.')
    return { message: 'QR sign-in approved' }
  }
  private async checkUpdate(): Promise<Result> {
    if (this.demo) return { message: 'Update checks are disabled in the demo' }
    const response = await riot.request('https://api.github.com/repos/aarsh21/riot-2fa-desktop/releases?per_page=10', { headers: { Accept: 'application/vnd.github+json' } })
    const data = await response.json() as { tag_name?: string; draft?: boolean }[]
    const release = Array.isArray(data) ? data.find(item => !item.draft && item.tag_name?.startsWith('desktop-v')) : undefined
    if (!release) return { message: 'No desktop releases have been published yet.' }
    return { message: `Latest desktop release: ${release.tag_name}. Downloads are available on GitHub.`, url: 'https://github.com/aarsh21/riot-2fa-desktop/releases' }
  }
  close() {
    this.stopped = true; clearInterval(this.timer)
    if (this.appearanceTimer) clearInterval(this.appearanceTimer)
    if (this.renewalTimer) clearInterval(this.renewalTimer)
    for (const timer of this.clipboardTimers) clearTimeout(timer)
    this.browser.cancel(); this.push?.close()
    this.snapshots.close(); this.captureController?.abort()
  }
}
