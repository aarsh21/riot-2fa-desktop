# Desktop development

See the [project README](../README.md) for installation, features and credits.

```sh
bun install --frozen-lockfile
bun run prepare:renderer
bunx patchright install chromium
bun run dev
```

Use Bun 1.4.2 and Rust 1.97.1. The renderer is pinned to GPUIx commit `6b4be86952aa89cfe61bb573740aea33fef5c5c4` for native accessibility support. Preparation builds it locally and installs its matching React bindings. Repeat preparation after reinstalling dependencies.

Windows needs the MSVC C++ build tools. macOS needs Xcode and its Metal toolchain. Linux needs Clang, Fontconfig, Wayland, XKB, X11, OpenSSL, Zstd and Vulkan development packages. See the CI workflow for the exact Ubuntu packages.

 `bun run demo` uses synthetic accounts without account network requests or persistence.

## Build and verify

```sh
bun run typecheck
bun test src/services
bun run verify
bun run build
```

Build on the target operating system. Packages include the runtime, browser, fonts and license notices. GitHub Actions builds Windows x64, Linux x64 and macOS arm64. A `desktop-v*` tag matching package.json publishes a preview after all builds pass.

`verify` uses keyboard automation and demo data. On Hyprland it floats/resizes only the demo window and captures it with grim. `scripts/verify-login.ts` verifies the browser handoff with intercepted requests and synthetic cookies.

The Windows snapshot test opens a synthetic QR window, captures it through the native helper, and exercises the global shortcut. Other platforms skip that native check. Local PNG decoding checks run everywhere.

## SnapShots

On Windows, Settings enables both-Shift capture of the foreground window. A separate, hidden PowerShell process polls the physical Shift keys and captures once per press. Capture uses physical window bounds, clips to the desktop and disposes graphics handles. A heartbeat detects a stalled worker; disabling the shortcut or exiting the app terminates it. Captures are decoded locally and removed. No accessibility text is collected.

Windows region capture uses a native selection overlay and never places pixels on the clipboard. Escape, right-click, or Cancel capture dismisses it. macOS uses screencapture; Linux uses grim/slurp on Wayland or ImageMagick on X11.

macOS polls both physical Shift keys after Input Monitoring permission is granted. Linux registers with the GlobalShortcuts portal and requests Ctrl+Alt+S. The desktop owns the actual binding. Hyprland requires a user binding to `dev.riot2fa.desktop:capture`. Enabling the shortcut also installs the app’s desktop entry so the portal can identify it.

## Local data

- Windows: `%APPDATA%/Riot2FA`
- macOS: `~/Library/Application Support/Riot2FA`
- Linux: `$XDG_DATA_HOME/Riot2FA`, default `~/.local/share/Riot2FA`

`RIOT2FA_DATA_DIR` overrides the directory. Accounts and push credentials are AES-256-GCM encrypted with a random key stored through `Bun.secrets`. The vault is bound to the data directory and OS credential-store entry. Existing JSON migrates after encrypted files have been authenticated. Missing keys and damaged vaults block writes. Atomic writes preserve the previous file if serialization fails. `preferences.json` stores the snapshot opt-in. The app owns a tray helper and a GPUIx window process. Closing the window leaves the account service running; Open recreates the window and Quit ends all helpers. IPC stays in local pipes. If no tray host is available, closing quits. A single-instance pipe prevents two app processes from writing the vault concurrently.
