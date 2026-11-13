import { PushReceiver } from '@eneris/push-receiver'
import type { ClientConfig, Credentials } from '@eneris/push-receiver/dist/types'
import type { Vault } from './vault'

type Receiver = Pick<PushReceiver, 'persistentIds' | 'fcmToken' | 'onCredentialsChanged' | 'onNotification' | 'on' | 'onReady' | 'connect' | 'destroy'>
export const pushConfiguration = {
  bundleId: 'com.riotgames.mobile.leagueconnect', debug: false, chromePlatform: 3, chromeVersion: '94.0.4606.51',
  firebase: {
    projectId: 'leagueconnect-1f13a', appId: '1:595870631183:android:cdbf60becd73557e', apiKey: 'AIzaSyCxhfh9jZtDD2KBUUO6d7HySuzG4xjdR4o', messagingSenderId: '595870631183',
    // Public package/certificate metadata used by the original Riot integration.
    // Firebase requires these on REST calls for this Android-restricted API key.
    androidPackage: 'com.riotgames.mobile.leagueconnect', androidCert: 'BB8C141D6E2CCE36551021FB3CD05188EF4D03F2',
  },
} satisfies ClientConfig

export class PushClient {
  private receiver: Receiver | null = null
  private stopped = false
  private starting = false
  private retryAttempt = 0
  private cancelAttempt: (() => void) | undefined
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private renewalTimer: ReturnType<typeof setTimeout> | null = null
  token = ''
  constructor(private vault: Vault, private onMessage: (data: Record<string, unknown>) => void, private onStatus: (status: string) => void, private onToken: (token: string) => void, private createReceiver: (config: ClientConfig) => Receiver = config => new PushReceiver(config)) {}
  async start() {
    if (this.stopped || this.starting || this.receiver) return
    this.starting = true
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const saved = this.vault.read<{ credentials?: Credentials; ids?: string[] }>('fcm_credentials-js', {})
      const receiver = this.receiver = this.createReceiver({ ...pushConfiguration, credentials: saved.credentials, persistentIds: saved.ids || [] })
      let credentials = saved.credentials
      const persist = () => { if (!this.stopped) this.vault.write('fcm_credentials-js', { credentials, ids: receiver.persistentIds.slice(-200) }) }
      receiver.onCredentialsChanged(event => { credentials = event.newCredentials; persist(); this.scheduleRenewal(credentials) })
      receiver.onNotification(envelope => {
        if (this.stopped) return
        const data = envelope.message.data || envelope.message
        this.onMessage(data as Record<string, unknown>); persist()
      })
      receiver.on('ON_DISCONNECT', () => { if (!this.stopped) this.onStatus('Reconnecting listener') })
      let announced = ''
      const ready = () => {
        if (this.stopped || this.receiver !== receiver || !receiver.fcmToken) return
        this.token = receiver.fcmToken
        this.retryAttempt = 0
        this.onStatus('Listening')
        if (announced !== this.token) { announced = this.token; this.onToken(this.token) }
      }
      receiver.onReady(ready)
      await Promise.race([
        receiver.connect(),
        new Promise<never>((_, reject) => { this.cancelAttempt = () => reject(new Error('Listener stopped')) }),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Listener connection timed out')), 30000) }),
      ])
      ready()
      if (credentials) this.scheduleRenewal(credentials)
    } catch (error) {
      this.receiver?.destroy(); this.receiver = null; this.token = ''
      if (this.renewalTimer) { clearTimeout(this.renewalTimer); this.renewalTimer = null }
      if (!this.stopped) {
        const restricted = error && typeof error === 'object' && 'code' in error && error.code === 'ANDROID_ONLY'
        this.onStatus(restricted ? 'Push unavailable · Registration refused by Google. Codes and QR sign-in are available.' : 'Listener unavailable · Retrying automatically')
        if (!restricted) {
          const delay = Math.min(5000 * 2 ** Math.min(this.retryAttempt++, 5), 60000)
          this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.start() }, delay)
        }
      }
    } finally { if (deadline) clearTimeout(deadline); this.cancelAttempt = undefined; this.starting = false }
  }
  private scheduleRenewal(credentials: Credentials) {
    if (this.stopped) return
    if (this.renewalTimer) clearTimeout(this.renewalTimer)
    const installation = credentials.fcm.installation
    const expiresAt = installation.createdAt + installation.expiresIn
    const delay = Number.isFinite(expiresAt) ? Math.max(1000, expiresAt - Date.now() - 60000) : 60000
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = null
      if (this.stopped) return
      this.receiver?.destroy(); this.receiver = null; this.token = ''
      this.onStatus('Renewing listener credentials')
      void this.start()
    }, Math.min(delay, 2147000000))
  }
  close() {
    this.stopped = true
    this.cancelAttempt?.()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.renewalTimer) clearTimeout(this.renewalTimer)
    this.receiver?.destroy(); this.receiver = null; this.token = ''
  }
}
