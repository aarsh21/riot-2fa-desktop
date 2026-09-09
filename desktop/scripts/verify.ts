import { connectStdio, type App } from '@gpuix/react/automation'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'

async function launch(options: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }): Promise<App> {
  const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.on('data', chunk => process.stderr.write(chunk))
  return connectStdio({ write: chunk => { child.stdin.write(chunk) }, feed: listener => { child.stdout.on('data', chunk => listener(chunk.toString())) }, close: async () => { child.kill() } })
}

async function screenshot(app: Awaited<ReturnType<typeof launch>>, path: string) {
  await new Promise(resolve => setTimeout(resolve, 100))
  if (process.platform !== 'linux' || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return app.screenshot({ path })
  const clients = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'], { encoding: 'utf8' }))
  const client = clients.find((c: { title: string }) => c.title === 'Riot 2FA · Demo')
  if (!client) throw new Error('The demo window was not found')
  execFileSync('grim', ['-g', `${client.at[0]},${client.at[1]} ${client.size[0]}x${client.size[1]}`, path])
}

const output = resolve(import.meta.dir, '../../.impeccable/review')
mkdirSync(output, { recursive: true })
const configurations = [
  { name: 'desktop-dark', theme: 'dark', width: '1080' },
  { name: 'desktop-light', theme: 'light', width: '1080' },
  { name: 'compact-dark', theme: 'dark', width: '600' },
]
for (const config of configurations) {
  const app = await launch({ command: process.env.RIOT2FA_VERIFY_BINARY || 'bun', args: process.env.RIOT2FA_VERIFY_BINARY ? ['--demo'] : ['src/main.tsx', '--demo'], cwd: process.env.RIOT2FA_VERIFY_BINARY ? dirname(process.env.RIOT2FA_VERIFY_BINARY) : resolve(import.meta.dir, '..'), env: { ...process.env, GPUIX_BACKGROUND: '1', RIOT2FA_THEME: config.theme, RIOT2FA_WIDTH: config.width, RIOT2FA_HEIGHT: '760' } })
  try {
    await app.getByText('alex#EUW').waitFor({ timeoutMs: 20000 })
    if (process.platform === 'linux' && process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      const clients = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'], { encoding: 'utf8' }))
      const client = clients.find((c: { title: string }) => c.title === 'Riot 2FA · Demo')
      assert.ok(client)
      execFileSync('hyprctl', ['dispatch', `hl.dsp.window.float({ window = "address:${client.address}", action = "toggle" })`])
      execFileSync('hyprctl', ['dispatch', `hl.dsp.window.resize({ window = "address:${client.address}", x = ${config.width}, y = 760 })`])
      execFileSync('hyprctl', ['dispatch', `hl.dsp.window.center({ window = "address:${client.address}" })`])
      execFileSync('hyprctl', ['setprop', `address:${client.address}`, 'opacity', '1 override 1 override', 'lock'])
      execFileSync('hyprctl', ['setprop', `address:${client.address}`, 'opaque', 'true'])
      execFileSync('hyprctl', ['setprop', `address:${client.address}`, 'force_rgbx', 'true'])
      await new Promise(resolve => setTimeout(resolve, 700))
    }
    await screenshot(app, `${output}/${config.name}.png`)
    if (config.name !== 'desktop-dark' || process.argv.includes('--captures-only')) continue
    await app.getByTestId('search').fill('weekend')
    assert.equal(await app.getByText('alex#NA1').count(), 0)
    assert.equal(await app.getByText('weekend#EUW').count(), 1)
    await app.getByTestId('search').fill('not-an-account')
    await app.getByText('No matching accounts').waitFor()
    await app.getByTestId('clear-search').press('enter')
    await app.getByText('alex#EUW').waitFor()
    await app.getByTestId('toggle-codes').press('enter')
    await app.getByText('Show codes').waitFor()
    assert.equal(await app.getByText('••• •••').count(), 3)
    await app.getByTestId('copy-4a434936c210a04edefad943').press('enter')
    await app.getByText('Copied').waitFor()
    await app.getByTestId('nav-requests').press('enter')
    await screenshot(app, `${output}/requests-dark.png`)
    await app.getByTestId('approve-demo-request').press('enter')
    await screenshot(app, `${output}/approval-dark.png`)
    await app.getByTestId('cancel-confirm').press('enter')
    assert.equal(await app.getByTestId('approve-demo-request').count(), 1)
    await app.getByTestId('deny-demo-request').press('enter')
    await app.getByText('No sign-ins waiting').waitFor()
    await app.getByTestId('nav-accounts').press('enter')
    await app.getByTestId('add-account').press('enter')
    await app.getByTestId('account-name').fill('test#LOCAL')
    await app.getByTestId('account-secret').fill('not-valid!')
    await app.getByTestId('save-account').press('enter')
    await app.getByTestId('error').waitFor()
    await screenshot(app, `${output}/add-error-dark.png`)
    await app.getByTestId('account-secret').fill('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    await app.getByTestId('save-account').press('enter')
    await app.getByText('test#LOCAL').waitFor()
    await app.getByTestId('nav-qr').press('enter')
    await screenshot(app, `${output}/qr-dark.png`)
    await app.getByTestId('nav-settings').press('enter')
    await screenshot(app, `${output}/settings-dark.png`)
    console.log('Native checks passed: search, empty state, reveal, copy, approval cancellation, denial, validation, manual add.')
  } finally { await app.close() }
}
