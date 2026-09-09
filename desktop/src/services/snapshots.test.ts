import { expect, test } from 'bun:test'
import QRCode from 'qrcode'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { decodeQrImage } from './qr-image'
import { WindowsSnapshots } from './windows-snapshots'
const url = 'https://authenticate.riotgames.com/?suuid=12345678-abcd&cluster=eu1'
const fixture = () => QRCode.toBuffer(url, { width: 320, margin: 4 })
test('snapshot decodes a Riot QR image locally', async () => {
  expect(decodeQrImage(await fixture())).toBe(url)
})
test('snapshot rejects non-images, oversized images and unrelated QR payloads', async () => {
  expect(() => decodeQrImage(Buffer.from('not an image'))).toThrow('PNG')
  const oversized = Buffer.from(await fixture()); oversized.writeUInt32BE(200000, 16)
  expect(() => decodeQrImage(oversized)).toThrow('too large')
  const unrelated = await QRCode.toBuffer('https://example.com/')
  expect(() => decodeQrImage(unrelated)).toThrow('Riot')
  const blank = new PNG({ width: 100, height: 100 }); blank.data.fill(255)
  expect(() => decodeQrImage(PNG.sync.write(blank))).toThrow('No QR code')
})
test.skipIf(process.platform !== 'win32')('Windows captures a synthetic foreground window and both-Shift shortcut fires once while held', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'riot2fa-windows-test-'))
  const path = join(dir, 'qr.png'); writeFileSync(path, await fixture())
  const watcher = new WindowsSnapshots(), capture = new WindowsSnapshots()
  const received: string[] = []
  let ready!: () => void
  const readyEvent = new Promise<void>(resolve => { ready = resolve })
  const errors: string[] = []
  const previous = process.env.RIOT2FA_SNAPSHOT_TEST_SHORTCUT
  try {
    watcher.start(event => { if (event.status) ready(); if (event.url) received.push(event.url); if (event.error) errors.push(event.error) })
    await Promise.race([readyEvent, Bun.sleep(12000).then(() => { throw new Error('Shortcut worker did not become ready') })])
    process.env.RIOT2FA_SNAPSHOT_TEST_SHORTCUT = '1'
    expect(await capture.capture('selftest', undefined, path)).toBe(url)
    await Bun.sleep(300)
    expect(errors).toEqual([])
    expect(received).toEqual([url])
  } finally {
    if (process.env.CI && existsSync(join(dir, 'captured.png'))) {
      mkdirSync('test-results', { recursive: true })
      copyFileSync(join(dir, 'captured.png'), 'test-results/windows-snapshot.png')
    }
    if (previous === undefined) delete process.env.RIOT2FA_SNAPSHOT_TEST_SHORTCUT
    else process.env.RIOT2FA_SNAPSHOT_TEST_SHORTCUT = previous
    watcher.close(); capture.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)
