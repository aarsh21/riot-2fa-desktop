import { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '..')
const dist = join(root, 'dist')
async function run(args: string[], env = process.env) {
  const child = Bun.spawn(args, { cwd: root, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`Build failed: ${args[0]}`)
}
const browsers = join(root, '.native-browsers')
await run(['bun', 'x', 'patchright', 'install', 'chromium', '--no-shell'], { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers })
rmSync(dist, { recursive: true, force: true })
const folder = process.platform === 'darwin' ? join(dist, 'Riot 2FA.app', 'Contents', 'MacOS') : join(dist, 'Riot 2FA')
mkdirSync(folder, { recursive: true })
const executable = join(folder, process.platform === 'win32' ? 'Riot 2FA.exe' : 'riot-2fa')
await run(['bun', 'build', '--compile', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', ...(process.platform === 'win32' ? ['--windows-hide-console', '--windows-title=Riot 2FA'] : []), 'src/main.tsx', '--outfile', executable])
cpSync(join(root, 'assets'), join(folder, 'assets'), { recursive: true })
cpSync(join(root, '..', 'LICENSE'), join(folder, 'LICENSE'))
const modules = join(root, 'node_modules')
const notices: string[] = ['Dependency notices. Some listed packages are build-time dependencies.\n']
const packages = readdirSync(modules).filter(name => !name.startsWith('.')).flatMap(name => name.startsWith('@') ? readdirSync(join(modules, name)).map(child => `${name}/${child}`) : [name])
for (const name of packages) {
  const path = join(modules, name)
  if (!existsSync(join(path, 'package.json'))) continue
  const metadata = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  notices.push(`${metadata.name} ${metadata.version}: ${JSON.stringify(metadata.license || 'See package notices')}`)
  for (const file of readdirSync(path, { withFileTypes: true })) {
    if (file.isFile() && /^(license|copying|notice)/i.test(file.name)) {
      const destination = join(folder, 'licenses', name)
      mkdirSync(destination, { recursive: true })
      cpSync(join(path, file.name), join(destination, file.name))
    }
  }
}
writeFileSync(join(folder, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n') + '\n')
cpSync(browsers, join(folder, 'browsers'), { recursive: true })
for (const name of ['patchright', 'patchright-core']) {
  cpSync(join(root, 'node_modules', name), join(folder, 'runtime', 'node_modules', name), { recursive: true })
}
if (process.platform === 'darwin') {
  writeFileSync(join(folder, '..', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Riot 2FA</string><key>CFBundleIdentifier</key><string>dev.riot2fa.desktop</string><key>CFBundleExecutable</key><string>riot-2fa</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`)
}
if (process.platform === 'linux') {
  mkdirSync(join(folder, 'tools'), { recursive: true })
  for (const name of ['wl-copy', 'wl-paste', 'grim', 'slurp', 'xclip']) {
    const path = Bun.which(name)
    if (path) cpSync(path, join(folder, 'tools', name))
    else console.warn(`Optional platform helper absent: ${name}`)
  }
  writeFileSync(join(folder, 'Launch Riot 2FA'), '#!/bin/sh\nAPP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$APP_DIR/riot-2fa" "$@"\n')
  chmodSync(join(folder, 'Launch Riot 2FA'), 0o755)
}
writeFileSync(join(dist, 'README.txt'), 'Riot 2FA\n\nOpen Riot 2FA.exe on Windows, Riot 2FA.app on macOS, or Launch Riot 2FA on Linux. Keep the application resources together. No Python, Bun installation, or server is required.\n\nThis is an unsigned development build. Linux requires a graphical session and normal GPUI graphics libraries. Screen capture availability depends on your desktop.\n')
console.log(`Packaged application: ${folder}`)
