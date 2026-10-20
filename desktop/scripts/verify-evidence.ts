// Reproducible local proof bundle. Live server acceptance is reported separately.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '..'), output = join(root, 'test-results')
mkdirSync(output, { recursive: true })
const checks: { name: string; command: string[]; exitCode: number; log: string }[] = []
async function check(name: string, args: string[], env = process.env) {
  const child = Bun.spawn(args, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const log = join(output, `${name}.log`)
  writeFileSync(log, stdout + stderr)
  checks.push({ name, command: args, exitCode, log })
  console.log(`${exitCode === 0 ? 'PASS' : 'FAIL'} ${name}`)
  if (exitCode !== 0) throw new Error(`${name} failed. See ${log}`)
}
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
try {
  await check('typecheck', ['bun', 'run', 'typecheck'])
  await check('unit', ['bun', 'test', 'src/services'])
  await check('session-ui', ['bun', 'run', 'verify:session'])
  await check('browser-handoff', ['bun', 'run', 'verify:login'])
  await check('build', ['bun', 'run', 'build'])
  const binary = join(root, 'dist', process.platform === 'darwin' ? 'Riot 2FA.app/Contents/MacOS/riot-2fa' : `Riot 2FA/${process.platform === 'win32' ? 'Riot 2FA.exe' : 'riot-2fa'}`)
  if (process.argv.includes('--live')) {
    if (!process.env.RIOT2FA_LIVE_AUTH_FILE || !process.env.RIOT2FA_LIVE_PUSH_CREDENTIALS_FILE) throw new Error('Live proof requires private test authorization and delivery credential files')
    await check('live-qr', ['bun', 'scripts/verify-live-qr.ts', '--approve-own-challenge'], { ...process.env, RIOT2FA_VERIFY_BINARY: binary })
    await check('live-push', ['bun', 'scripts/verify-live-push.ts', '--register-this-test-device', '--delete-test-registration'])
  }
  await check('packaged-ui', ['bun', 'scripts/verify.ts', '--no-captures'], { ...process.env, RIOT2FA_VERIFY_BINARY: binary })
  const sourceFiles = ['package.json', 'scripts/prepare-renderer.ts', 'src/services/push.ts', 'src/services/push.test.ts', 'patches/@eneris%2Fpush-receiver@4.3.1.patch', 'scripts/live-qr-ui.tsx', 'scripts/verify-live-qr.ts', 'scripts/verify-live-push.ts', 'src/service.ts', 'src/ui.tsx', 'src/services/riot.ts', 'src/services/browser.ts', 'src/services/storage.ts', 'src/services/totp.ts', 'src/services/session.test.ts', 'scripts/verify.ts', 'scripts/session-ui-fixture.tsx', 'scripts/verify-session-ui.ts', 'scripts/verify-login.ts', 'scripts/verify-evidence.ts', 'bun.lock']
  const captures = ['desktop-dark', 'desktop-light', 'compact-dark', 'requests-dark', 'approval-dark', 'add-error-dark', 'qr-dark', 'settings-dark'].map(name => resolve(root, `../.impeccable/review/${name}.png`)).filter(existsSync)
  const unit = readFileSync(join(output, 'unit.log'), 'utf8')
  const liveRecord = (name: string) => {
    const path = join(output, `${name}.json`)
    if (!existsSync(path)) return { verified: false, reason: 'No live record exists' }
    const evidence = JSON.parse(readFileSync(path, 'utf8'))
    const matches = Array.isArray(evidence.sources) && evidence.sources.every((source: { path: string; sha256: string }) => digest(join(root, source.path)) === source.sha256)
    const liveBinary = evidence.afterCachedTokenExpiry?.packagedExecutable
    const binaryMatches = !liveBinary || existsSync(liveBinary.path) && digest(liveBinary.path) === liveBinary.sha256
    return { verified: evidence.passed === true && matches && binaryMatches, path, sourceHashesMatch: matches, binaryHashMatches: binaryMatches, evidence }
  }
  const liveQr = liveRecord('live-qr'), livePush = liveRecord('live-push')
  const report = {
    passed: true, recordedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    testScope: 'Native Linux app and packaged executable. Riot HTTP and browser handoff use intercepted synthetic data.',
    unitSummary: { passed: Number(unit.match(/(\d+) pass/)?.[1]), skipped: Number(unit.match(/(\d+) skip/)?.[1]), failed: Number(unit.match(/(\d+) fail/)?.[1]) },
    checks, binary: { path: binary, sha256: digest(binary) },
    sources: sourceFiles.map(path => ({ path, sha256: digest(join(root, path)) })),
    screenshots: captures.map(path => ({ path, sha256: digest(path), content: 'Synthetic demo accounts' })),
    liveValidation: { accountBrowser: 'Signed-in Riot Account Management inspected; email MFA and Riot Mobile shown enabled', authorization: liveQr.verified ? 'Live Riot userinfo matched the authorized account and native QR login succeeded' : 'Live authorization is not verified against current source hashes', otpAcceptance: 'Not verified against the live account: its existing setup secret is not present in this workspace', qrApproval: liveQr, push: livePush, crossPlatform: 'Windows/macOS runtime execution not performed on this Linux host' },
    productionCertification: false,
  }
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(report, null, 2))
  console.log(`Evidence: ${join(output, 'evidence.json')}`)
} catch (error) {
  writeFileSync(join(output, 'evidence.json'), JSON.stringify({ passed: false, checks, error: String(error) }, null, 2))
  throw error
}
