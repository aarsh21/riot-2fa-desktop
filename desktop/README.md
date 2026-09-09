# Desktop development

See the [project README](../README.md) for installation, features and credits.

```sh
bun install --frozen-lockfile
bunx patchright install chromium
bun run dev
```

Use Bun 1.4.2. `bun run demo` uses synthetic accounts without account network requests or persistence.

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

Capture region opens Windows Snipping Tool. This path uses the clipboard image supplied by the system tool; cancelling in the app stops waiting. macOS uses screencapture. Linux uses grim/slurp on Wayland or ImageMagick on X11. Global both-Shift capture is currently Windows-only.

## Local data

- Windows: `%APPDATA%/Riot2FA`
- macOS: `~/Library/Application Support/Riot2FA`
- Linux: `$XDG_DATA_HOME/Riot2FA`, default `~/.local/share/Riot2FA`

`RIOT2FA_DATA_DIR` overrides the directory. Account secrets and sessions are unencrypted JSON. Atomic writes preserve the previous file if serialization fails. `preferences.json` stores the snapshot opt-in. Closing quits; keep the app open or minimized for sign-in requests.
