import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { accountId, extractSecret, totp } from './services/totp'
import { dataDirectory, loadAccounts, readJson, writeJson, type SavedAccount } from './services/storage'
import * as riot from './services/riot'
import { BrowserLogin } from './services/browser'
import { captureQr, notifySignIn, readClipboard, systemDark, writeClipboard } from './services/platform'
import { PushClient } from './services/push'
import { WindowsSnapshots, type SnapshotEvent } from './services/windows-snapshots'

export type Account = { id: string; name: string; code: string | null; qrEnabled: boolean }
export type LoginRequest = { id: string; accountId: string; name: string; time: number | string | null; location: string; demo?: boolean }
export type State = { accounts: Account[]; requests: LoginRequest[]; remaining: number; pushStatus: string; demo: boolean; dark: boolean; storagePath: string; error: string | null; snapshotsEnabled: boolean; snapshotStatus: string; snapshot: (SnapshotEvent & { id: string }) | null }
export type Result = { message?: string; url?: string; confirmation?: string; name?: string; location?: string }
type PendingRequest = LoginRequest & { raw?: Record<string, unknown>; busy?: boolean }
type QrConfirmation = { accountId: string; token: string; suuid: string; cluster: string; expires: number }

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
  private appearanceTimer: ReturnType<typeof setInterval> | null = null
  private clipboardTimers = new Set<ReturnType<typeof setTimeout>>()
  private stopped = false
  private busy = false
  private lastRegisteredToken = ''
  private themeDark = true
  private pushStatus = 'Starting listener'
  private snapshots = new WindowsSnapshots()
  private snapshotsEnabled = false
  private snapshotStatus = 'Off'
  private latestSnapshot: State['snapshot'] = null
  private captureController: AbortController | null = null

  constructor(private demo: boolean, private directory = dataDirectory(), live = true) {
    try {
      this.accounts = demo ? [
        { name: 'alex#EUW', seed: 'JBSWY3DPEHPK3PXP', sso: { demo: 'true' } },
        { name: 'alex#NA1', seed: 'KRUGS4ZANFZSAYJA' },
        { name: 'weekend#EUW', seed: 'MFRGGZDFMZTWQ2LK' },
      ] : loadAccounts(directory)
    } catch { this.error = 'Account storage could not be read. Repair or restore accounts.json before adding accounts.' }
    if (demo) {
      this.pushStatus = 'Demo session'
      this.requests.set('demo-request', { id: 'demo-request', accountId: accountId(this.accounts[0]!), name: 'alex#EUW', time: Date.now(), location: 'Demo request', demo: true })
    }
    this.state = this.snapshot()
    this.timer = setInterval(() => this.emit(), 1000)
    if (!demo && live) {
      try {
        this.snapshotsEnabled = process.platform === 'win32' && readJson<{ snapshotsEnabled?: boolean }>(join(directory, 'preferences.json'), {}).snapshotsEnabled === true
        if (this.snapshotsEnabled) this.startSnapshots()
      } catch { this.snapshotStatus = 'Could not read shortcut preference' }
      const appearance = async () => { this.themeDark = await systemDark(); if (!this.stopped) this.emit() }
      void appearance(); this.appearanceTimer = setInterval(() => void appearance(), 30000)
      if (!this.error) {
        this.push = new PushClient(directory, data => this.onPush(data), status => { this.pushStatus = status; this.emit() }, token => { void this.registerExisting(token) })
        void this.push.start()
      }
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private snapshot(): State {
    return {
      accounts: this.accounts.map(account => { let code: string | null = null; try { code = totp(account.seed) } catch {} return { id: accountId(account), name: account.name, code, qrEnabled: Boolean(account.sso && Object.keys(account.sso).length) } }),
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
      try { writeJson(join(this.directory, 'accounts.json'), next, this.directory) }
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
        case 'respond': return await this.respond(String(params.requestId), params.approve === true)
        case 'scan': {
          if (this.demo) throw new riot.ServiceError('Screen scanning is disabled in the demo.')
          this.captureController = new AbortController()
          try { return { url: await captureQr(this.captureController.signal) } }
          finally { this.captureController = null }
        }
        case 'snapshots': {
          if (process.platform !== 'win32' && !this.demo) throw new riot.ServiceError('The global shortcut is available on Windows. Use Capture region on this desktop.')
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
  private async login(): Promise<Result> {
    if (this.demo) throw new riot.ServiceError('Browser login is disabled in the demo. Launch normally to connect your account.')
    const session = await this.browser.login()
    if (!session) return { message: 'Browser login cancelled' }
    const csrf = session.csrf
    const user = await loginStep('Reading your Riot account', () => riot.fetchUser(session.cookies, csrf))
    const response = await loginStep('Checking two-factor authentication', () => riot.fetchFactors(session.cookies, csrf))
    const factors = Array.isArray(response) ? response : response.factors
    if (!Array.isArray(factors) || !factors.some(f => f.factor === 'email' && f.status === 'enabled')) throw new riot.ServiceError('Enable email two-factor authentication at account.riotgames.com, then try again.')
    const seed = await loginStep('Connecting the authenticator', () => riot.enableMfa(session.cookies, csrf))
    const account: SavedAccount = { name: riot.userName(user), seed, puuid: user.puuid || user.sub, sso: session.sso }
    this.store(account)
    let message = 'Account added'
    try {
      const token = await this.validToken(account)
      await riot.verifyMfa(token, seed)
      if (this.push?.token) await riot.registerPush(token, this.push.token)
      else message += '. Push registration is unavailable; codes are ready.'
    } catch { message += '. Verification or push registration failed; the account secret was saved.' }
    return { message }
  }
  private startSnapshots() {
    this.snapshots.start(event => {
      if (this.stopped) return
      if (event.status) this.snapshotStatus = event.status
      if (!this.busy && (event.url || event.error)) this.latestSnapshot = { ...event, id: randomUUID() }
      this.emit()
    })
  }
  private async validToken(account: SavedAccount): Promise<string> {
    let token: string | null = null
    try { token = await riot.mintToken(account.sso) } catch {}
    if (token) {
      this.commit(this.accounts.map(a => accountId(a) === accountId(account) ? { ...a, access_token: token! } : a))
      return token
    }
    if (riot.tokenValid(account.access_token)) return account.access_token!
    throw new riot.ServiceError('Your session expired. Add this account again through browser login.')
  }
  private async registerExisting(token: string) {
    if (token === this.lastRegisteredToken || this.stopped) return
    this.lastRegisteredToken = token
    let failures = 0
    for (const account of [...this.accounts]) {
      if (!account.sso?.ssid || this.stopped) continue
      try { await riot.registerPush(await this.validToken(account), token) } catch { failures++ }
    }
    if (failures) { this.pushStatus = 'Some accounts need browser reconnection'; this.emit() }
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
    if (!account.sso?.ssid) throw new riot.ServiceError('QR sign-in needs an account added through browser login.')
    const { suuid, cluster } = riot.parseQr(url)
    const token = await this.validToken(account)
    const info = await riot.qrInfo(token, suuid, cluster)
    const geo = info.request?.geolocation || info.auth_session?.geolocation
    const location = geo?.lat != null && geo?.lon != null ? `${geo.lat}, ${geo.lon}` : 'Location unavailable'
    const confirmation = randomUUID()
    this.confirmations.clear()
    this.confirmations.set(confirmation, { accountId: id, token, suuid, cluster, expires: Date.now() + 90000 })
    return { confirmation, name: account.name, location }
  }
  private async approveQr(id: string): Promise<Result> {
    const request = this.confirmations.get(id)
    this.confirmations.delete(id)
    if (!request || request.expires < Date.now()) throw new riot.ServiceError('This confirmation expired. Scan the code again.')
    this.account(request.accountId)
    const result = await riot.approveQr(request.token, request.suuid, request.cluster)
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
    for (const timer of this.clipboardTimers) clearTimeout(timer)
    this.browser.cancel(); this.push?.close()
    this.snapshots.close(); this.captureController?.abort()
  }
}
