import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, realpathSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson, validateAccounts } from './storage'

type KeyStore = Pick<typeof Bun.secrets, 'get' | 'set'>
type Envelope = { version: 1; nonce: string; tag: string; ciphertext: string }
const documents = ['accounts', 'fcm_credentials-js'] as const
export type VaultDocument = typeof documents[number]

/** Only the random encryption key lives in the OS credential store. */
export class Vault {
  constructor(private directory: string, private key: Buffer) {
    if (key.length !== 32) throw new Error('Invalid vault key')
  }
  static async open(directory: string, keys: KeyStore = Bun.secrets): Promise<Vault> {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const identity = { service: 'dev.riot2fa.desktop', name: createHash('sha256').update(realpathSync(directory)).digest('hex') }
    let key: string | null
    try {
      key = await keys.get(identity)
      if (!key) {
        if (documents.some(name => existsSync(join(directory, `${name}.vault`)))) throw new Error('Missing vault key')
        key = randomBytes(32).toString('base64')
        await keys.set({ ...identity, value: key })
        if (await keys.get(identity) !== key) throw new Error('Key verification failed')
      }
    } catch {
      throw new Error('Unlock your operating system credential store, then reopen Riot 2FA. If its encryption key was removed, restore the key before opening this vault.')
    }
    const vault = new Vault(directory, Buffer.from(key, 'base64'))
    // Check every existing document before migrating or deleting anything.
    for (const name of documents) {
      const encrypted = vault.read<unknown>(name, null)
      const legacy = readJson<unknown>(join(directory, `${name}.json`), null)
      if (name === 'accounts') {
        if (encrypted !== null) validateAccounts(encrypted)
        if (legacy !== null) validateAccounts(legacy)
      }
    }
    for (const name of documents) {
      const oldPath = join(directory, `${name}.json`)
      if (!existsSync(oldPath)) continue
      if (!existsSync(vault.path(name))) vault.write(name, readJson(oldPath, null))
      vault.read(name, null)
      unlinkSync(oldPath)
    }
    return vault
  }
  private path(name: VaultDocument) { return join(this.directory, `${name}.vault`) }
  read<T>(name: VaultDocument, fallback: T): T {
    if (!existsSync(this.path(name))) return fallback
    try {
      const e = readJson<Envelope>(this.path(name), null as never)
      if (e.version !== 1) throw new Error('Unsupported vault version')
      const nonce = Buffer.from(e.nonce, 'base64'), tag = Buffer.from(e.tag, 'base64')
      if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid vault')
      const cipher = createDecipheriv('aes-256-gcm', this.key, nonce)
      cipher.setAAD(Buffer.from(`riot2fa:1:${name}`)); cipher.setAuthTag(tag)
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(e.ciphertext, 'base64')), cipher.final()]).toString('utf8')) as T
    } catch { throw new Error('Encrypted account storage could not be read. Restore the vault and its original OS credential-store key; existing files have been preserved.') }
  }
  write(name: VaultDocument, value: unknown) {
    const plaintext = Buffer.from(JSON.stringify(value))
    try {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce)
      cipher.setAAD(Buffer.from(`riot2fa:1:${name}`))
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
      writeJson(this.path(name), { version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }, this.directory)
    } finally { plaintext.fill(0) }
  }
}
