import { PushReceiver } from '@eneris/push-receiver'
import type { Credentials } from '@eneris/push-receiver/dist/types'
import { join } from 'node:path'
import { readJson, writeJson } from './storage'

export class PushClient {
  private receiver: PushReceiver | null = null
  private stopped = false
  token = ''
  constructor(private directory: string, private onMessage: (data: Record<string, unknown>) => void, private onStatus: (status: string) => void, private onToken: (token: string) => void) {}
  async start() {
    const path = join(this.directory, 'fcm_credentials-js.json')
    try {
      const saved = readJson<{ credentials?: Credentials; ids?: string[] }>(path, {})
      const receiver = this.receiver = new PushReceiver({
        credentials: saved.credentials, persistentIds: saved.ids || [], bundleId: 'com.riotgames.mobile.leagueconnect', debug: false,
        firebase: { projectId: 'leagueconnect-1f13a', appId: '1:595870631183:android:cdbf60becd73557e', apiKey: 'AIzaSyCxhfh9jZtDD2KBUUO6d7HySuzG4xjdR4o', messagingSenderId: '595870631183' },
      })
      let credentials = saved.credentials
      const persist = () => { if (!this.stopped) writeJson(path, { credentials, ids: receiver.persistentIds.slice(-200) }, this.directory) }
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
    } catch { if (!this.stopped) this.onStatus('Listener unavailable') }
  }
  close() { this.stopped = true; this.receiver?.destroy() }
}
