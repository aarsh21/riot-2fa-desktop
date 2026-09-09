import { prepareFonts } from './fonts'
await prepareFonts().catch(() => { /* The system font remains a usable fallback. */ })
// Load the renderer after the app-local font configuration is ready.
const { render } = await import('@gpuix/react')
const { App } = await import('./ui')
const { AccountService } = await import('./service')
const demo = process.argv.includes('--demo')
const globalState = globalThis as typeof globalThis & { riotService?: InstanceType<typeof AccountService> }
const service = globalState.riotService ??= new AccountService(demo)
process.once('exit', () => service.close())
process.once('SIGTERM', () => { service.close(); process.exit(0) })
process.once('SIGINT', () => { service.close(); process.exit(0) })
render(<App service={service} />, {
  title: demo ? 'Riot 2FA · Demo' : 'Riot 2FA',
  appName: 'Riot 2FA',
  width: Number(process.env.RIOT2FA_WIDTH) || 1080,
  height: Number(process.env.RIOT2FA_HEIGHT) || 760,
  minWidth: 560, minHeight: 500,
  windowBackground: 'opaque',
  focus: process.env.GPUIX_BACKGROUND !== '1',
})
