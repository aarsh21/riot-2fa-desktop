import { prepareFonts } from './fonts'
import { clientService, desktopHost, type ServiceView } from './desktop-host'
async function openWindow(service: ServiceView, demo: boolean) {
  await prepareFonts().catch(() => {})
  const { render } = await import('@gpuix/react')
  const { App } = await import('./ui')
  render(<App service={service} />, {
    title: demo ? 'Riot 2FA · Demo' : 'Riot 2FA', appName: 'Riot 2FA',
    width: Number(process.env.RIOT2FA_WIDTH) || 1080, height: Number(process.env.RIOT2FA_HEIGHT) || 760,
    minWidth: 560, minHeight: 500, windowBackground: 'opaque', focus: process.env.GPUIX_BACKGROUND !== '1',
  })
}
if (process.argv.includes('--ui')) {
  if (!process.send) throw new Error('The UI must be started by Riot 2FA.')
  await openWindow(await clientService(), false)
} else {
  const { AccountService } = await import('./service')
  const demo = process.argv.includes('--demo')
  const globalState = globalThis as typeof globalThis & { riotService?: InstanceType<typeof AccountService>; riotHost?: boolean }
  if (!demo && !globalState.riotService) {
    const { claimInstance } = await import('./services/instance')
    const { dataDirectory } = await import('./services/storage')
    const claimed = await claimInstance(dataDirectory(), () => process.emit('riot-show'))
    if (!claimed) process.exit(0)
    process.once('exit', () => claimed.close())
  }
  let vault, startupError: string | undefined
  if (!demo && !globalState.riotService) {
    const { Vault } = await import('./services/vault')
    const { dataDirectory } = await import('./services/storage')
    try { vault = await Vault.open(dataDirectory()) }
    catch (error) { startupError = error instanceof Error ? error.message : 'The encrypted vault could not be opened.' }
  }
  const service = globalState.riotService ??= new AccountService(demo, undefined, true, vault, startupError)
  process.once('exit', () => service.close())
  process.once('SIGTERM', () => { service.close(); process.exit(0) })
  process.once('SIGINT', () => { service.close(); process.exit(0) })
  if (!globalState.riotHost) {
    globalState.riotHost = !demo && !startupError && !process.argv.includes('--no-tray') && await desktopHost(service)
    if (!globalState.riotHost) await openWindow(service, demo)
  }
}
