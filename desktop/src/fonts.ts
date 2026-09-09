import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Use a process-scoped Fontconfig config on Linux, never change desktop settings.
export async function prepareFonts() {
  const bundled = resolve(dirname(process.execPath), 'assets')
  const assets = existsSync(join(bundled, 'Geist-Regular.ttf')) ? bundled : resolve(import.meta.dir, '../assets')
  if (!existsSync(join(assets, 'Geist-Regular.ttf'))) return
  const names = ['Geist-Regular.ttf', 'Geist-Medium.ttf', 'Geist-SemiBold.ttf']
  if (process.platform === 'darwin') {
    const { dlopen, ptr } = await import('bun:ffi')
    const cf = dlopen('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', {
      CFURLCreateFromFileSystemRepresentation: { args: ['ptr', 'ptr', 'i64', 'bool'], returns: 'ptr' },
      CFRelease: { args: ['ptr'], returns: 'void' },
    })
    const ct = dlopen('/System/Library/Frameworks/CoreText.framework/CoreText', {
      CTFontManagerRegisterFontsForURL: { args: ['ptr', 'u32', 'ptr'], returns: 'bool' },
    })
    for (const name of names) {
      const bytes = Buffer.from(join(assets, name))
      const url = cf.symbols.CFURLCreateFromFileSystemRepresentation(null, ptr(bytes), bytes.length, false)
      if (url) { ct.symbols.CTFontManagerRegisterFontsForURL(url, 1, null); cf.symbols.CFRelease(url) }
    }
    return
  }
  if (process.platform === 'win32') {
    const { dlopen, ptr } = await import('bun:ffi')
    const gdi = dlopen('gdi32.dll', { AddFontResourceExW: { args: ['ptr', 'u32', 'ptr'], returns: 'i32' } })
    for (const name of names) {
      const path = Buffer.from(join(assets, name) + '\0', 'utf16le')
      gdi.symbols.AddFontResourceExW(ptr(path), 0x10, null)
    }
    return
  }
  if (process.platform !== 'linux') return
  const dir = join(tmpdir(), `riot2fa-fonts-${process.getuid?.() ?? 'user'}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const name of names) copyFileSync(join(assets, name), join(dir, name))
  const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  const config = join(dir, 'fonts.conf')
  writeFileSync(config, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${escape(dir)}</dir><cachedir>${escape(join(dir, 'cache'))}</cachedir></fontconfig>`)
  process.env.FONTCONFIG_FILE = config
}
