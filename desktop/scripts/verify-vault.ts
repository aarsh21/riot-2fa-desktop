import { mkdtempSync, realpathSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Vault } from '../src/services/vault'
const directory = mkdtempSync(join(tmpdir(), 'riot-os-vault-'))
const identity = { service: 'dev.riot2fa.desktop', name: createHash('sha256').update(realpathSync(directory)).digest('hex') }
try {
  const vault = await Vault.open(directory)
  vault.write('accounts', [{ name: 'synthetic', seed: 'GEZDGNBVGY3TQOJQ' }])
  if (readFileSync(join(directory, 'accounts.vault'), 'utf8').includes('GEZDGNBVGY3TQOJQ')) throw new Error('Plaintext secret')
  const reopened = await Vault.open(directory)
  if (reopened.read<any[]>('accounts', [])[0]?.name !== 'synthetic') throw new Error('Cannot reopen vault')
  console.log('OS-backed vault encrypts and reopens successfully')
} finally { await Bun.secrets.delete(identity); rmSync(directory, { recursive: true, force: true }) }
