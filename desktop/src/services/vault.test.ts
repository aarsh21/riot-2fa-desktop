import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vault } from './vault'
const dirs: string[] = []
const directory = () => { const d = mkdtempSync(join(tmpdir(), 'riot-vault-')); dirs.push(d); return d }
const keyStore = () => { let value: string | null = null; return { get: async () => value, set: async (input: { value: string }) => { value = input.value } } }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
test('migrates accounts and sessions without leaving plaintext, then reopens', async () => {
  const d = directory(), keys = keyStore(), accounts = [{ name: 'test', seed: 'GEZDGNBVGY3TQOJQ', sso: { ssid: 'synthetic-session' } }]
  writeFileSync(join(d, 'accounts.json'), JSON.stringify(accounts))
  writeFileSync(join(d, 'fcm_credentials-js.json'), JSON.stringify({ credentials: { token: 'synthetic-push-token' } }))
  const vault = await Vault.open(d, keys)
  expect(vault.read<unknown>('accounts', [])).toEqual(accounts)
  expect(existsSync(join(d, 'accounts.json'))).toBe(false)
  expect(existsSync(join(d, 'fcm_credentials-js.json'))).toBe(false)
  const encrypted = readFileSync(join(d, 'accounts.vault'), 'utf8')
  expect(encrypted).not.toContain('GEZDGNBVGY3TQOJQ')
  expect(encrypted).not.toContain('synthetic-session')
  expect((await Vault.open(d, keys)).read<unknown>('accounts', [])).toEqual(accounts)
  vault.write('accounts', accounts)
  expect(readFileSync(join(d, 'accounts.vault'), 'utf8')).not.toBe(encrypted)
})
test('missing or locked OS keys preserve the encrypted file', async () => {
  const d = directory(), keys = keyStore(), v = await Vault.open(d, keys)
  v.write('accounts', [{ name: 'test', seed: 'GEZDGNBVGY3TQOJQ' }])
  const before = readFileSync(join(d, 'accounts.vault'), 'utf8')
  await expect(Vault.open(d, keyStore())).rejects.toThrow('credential store')
  await expect(Vault.open(d, { get: async () => { throw new Error('locked') }, set: keys.set })).rejects.toThrow('credential store')
  expect(readFileSync(join(d, 'accounts.vault'), 'utf8')).toBe(before)
})
test('tampering and swapping encrypted documents fail authentication without fallback', async () => {
  const d = directory(), keys = keyStore(), v = await Vault.open(d, keys)
  v.write('accounts', [{ name: 'test', seed: 'GEZDGNBVGY3TQOJQ' }])
  const content = readFileSync(join(d, 'accounts.vault'), 'utf8')
  writeFileSync(join(d, 'fcm_credentials-js.vault'), content)
  writeFileSync(join(d, 'accounts.json'), '[]')
  await expect(Vault.open(d, keys)).rejects.toThrow('preserved')
  expect(existsSync(join(d, 'accounts.json'))).toBe(true)
  const e = JSON.parse(content); e.tag = Buffer.alloc(16).toString('base64')
  writeFileSync(join(d, 'accounts.vault'), JSON.stringify(e))
  expect(() => v.read<unknown>('accounts', [])).toThrow('preserved')
})
test('failed serialization preserves the last encrypted account file', async () => {
  const d = directory(), v = await Vault.open(d, keyStore()); v.write('accounts', [])
  const circular: any = {}; circular.self = circular
  expect(() => v.write('accounts', circular)).toThrow()
  expect(v.read<unknown>('accounts', null)).toEqual([])
})
