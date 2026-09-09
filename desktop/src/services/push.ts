import { PushReceiver } from '@eneris/push-receiver'
import type { Credentials } from '@eneris/push-receiver/dist/types'
import type { Vault } from './vault'

export class PushClient {
  private receiver: PushReceiver | null = null
  private stopped = false
  token = ''
  constructor(private vault: Vault, private onMessage: (data: Record<string, unknown>) => void, private onStatus: (status: string) => void, private onToken: (token: string) => void) {}
  async start() {
    try {
      const saved = this.vault.read<{ credentials?: Credentials; ids?: string[] }>('fcm_credentials-js', {})
      const receiver = this.receiver = new PushReceiver({
        credentials: saved.credentials, persistentIds: saved.ids || [], bundleId: 'com.riotgames.mobile.leagueconnect', debug: false, chromePlatform: 3, chromeVersion: '94.0.4606.51',
        firebase: { projectId: 'leagueconnect-1f13a', appId: '1:595870631183:android:cdbf60becd73557e', apiKey: 'AIzaSyCxhfh9jZtDD2KBUUO6d7HySuzG4xjdR4o', messagingSenderId: '595870631183' },
      })
      let credentials = saved.credentials
      const persist = () => { if (!this.stopped) this.vault.write('fcm_credentials-js', { credentials, ids: receiver.persistentIds.slice(-200) }) }
      receiver.onCredentialsChanged(event => { credentials = event.newCredentials; persist() })
      receiver.onNotification(envelope => {
        if (this.stopped) return
        const data = envelope.message.data || envelope.message
        this.onMessage(data as Record<string, unknown>); persist()
      })
      receiver.on('ON_DISCONNECT', () => { if (!this.stopped) this.onStatus('Reconnecting listener') })
      receiver.onReady(() => {
        if (this.stopped) return
        this.token = receiver.fcmToken
        this.onStatus('Listening'); this.onToken(this.token)
      })
      await receiver.connect()
      if (!this.stopped && receiver.fcmToken) { this.token = receiver.fcmToken; this.onStatus('Listening'); this.onToken(this.token) }
    } catch (error) {
      this.receiver?.destroy(); this.receiver = null
      if (!this.stopped) this.onStatus(error && typeof error === 'object' && 'code' in error && error.code === 'ANDROID_ONLY' ? 'Push blocked by Riot’s Android-only Firebase configuration. Sign-in codes still work.' : 'Listener unavailable')
    }
  }
  close() { this.stopped = true; this.receiver?.destroy() }
}
