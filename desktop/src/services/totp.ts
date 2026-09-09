import { createHash, createHmac } from 'node:crypto'
import type { SavedAccount } from './storage'

export function decodeBase32(value: string): Buffer {
  const raw = value.toUpperCase().replace(/\s/g, '').replace(/=+$/, '')
  if (!raw || !/^[A-Z2-7]+$/.test(raw) || [1, 3, 6].includes(raw.length % 8)) throw new Error('This secret is not valid Base32. Check it and try again.')
  let bits = 0, buffer = 0
  const bytes: number[] = []
  for (const character of raw) {
    buffer = (buffer << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character)
    bits += 5
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255) }
  }
  if (bits && (buffer & ((1 << bits) - 1))) throw new Error('The Base32 secret has invalid padding bits.')
  return Buffer.from(bytes)
}
export function extractSecret(value: string): string {
  let raw = value.trim()
  if (/^(https?:|otpauth:)/i.test(raw)) {
    const url = new URL(raw)
    raw = url.searchParams.get('seed') || url.searchParams.get('secret') || ''
  }
  const normalized = raw.toUpperCase().replace(/\s/g, '').replace(/=+$/, '')
  if (decodeBase32(normalized).length < 10) throw new Error('The account secret must contain at least 10 bytes.')
  return normalized + '='.repeat((8 - normalized.length % 8) % 8)
}
export function totp(seed: string, time = Date.now(), digits = 6): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)))
  const digest = createHmac('sha256', decodeBase32(seed)).update(counter).digest()
  const offset = digest[digest.length - 1]! & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0')
}
export function accountId(account: SavedAccount) { return createHash('sha256').update(`${account.name}\0${account.seed}`).digest('hex').slice(0, 24) }
