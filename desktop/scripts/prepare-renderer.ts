import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '..')
const revision = '6b4be86952aa89cfe61bb573740aea33fef5c5c4'
const source = process.env.RIOT2FA_GPUIX_SOURCE || join(root, '.gpuix')
async function run(args: string[], cwd = source) {
  const child = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`Renderer preparation failed: ${args[0]}`)
}
if (!existsSync(join(source, '.git'))) {
  mkdirSync(source, { recursive: true })
  await run(['git', 'init'])
  await run(['git', 'remote', 'add', 'origin', 'https://github.com/remorses/gpuix.git'])
  await run(['git', 'fetch', '--depth', '1', 'origin', revision])
  await run(['git', 'checkout', '--detach', 'FETCH_HEAD'])
}
const head = await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: source, stdout: 'pipe' }).stdout).text()
if (head.trim() !== revision) throw new Error('GPUIx checkout does not match the pinned revision')
await run(['git', 'submodule', 'update', '--init', '--recursive', '--depth', '1'])
await run(['bun', 'install', '--frozen-lockfile', '--ignore-scripts'])
await run(['cargo', 'build', '--release', '--locked', ...(process.platform === 'linux' ? ['--no-default-features'] : ['--features', 'test-support'])], join(source, 'packages/native'))
await run(['bun', 'run', 'build'], join(source, 'packages/react'))
const target = process.env.CARGO_TARGET_DIR || join(source, 'packages/native/target')
const nativeFile = process.platform === 'win32' ? 'gpuix_native.dll' : process.platform === 'darwin' ? 'libgpuix_native.dylib' : 'libgpuix_native.so'
const suffix = process.platform === 'win32' ? 'win32-x64-msvc' : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64-gnu'
for (const name of ['react', 'native']) {
  const destination = join(root, 'node_modules/@gpuix', name)
  // Keep npm's dependency manifests; install the matching source-built API and binary.
  for (const file of name === 'react' ? ['dist', 'jsx-runtime.js', 'jsx-runtime.d.ts', 'jsx-dev-runtime.js', 'jsx-dev-runtime.d.ts'] : ['index.js', 'index.d.ts']) {
    cpSync(join(source, 'packages', name, file), join(destination, file), { recursive: true })
  }
}
cpSync(join(target, 'release', nativeFile), join(root, 'node_modules/@gpuix/native', `gpuix-native.${suffix}.node`))
writeFileSync(join(root, 'node_modules/@gpuix/native/riot-revision'), revision)
console.log('Installed GPUIx with native accessibility support')
