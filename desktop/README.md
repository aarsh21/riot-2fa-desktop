# Riot 2FA desktop

One native desktop application built with GPUIx, React and TypeScript. Account storage, codes, browser login, push requests and QR decoding run inside the compiled Bun application. Packaged users need no Python, Bun installation or local server.

## Development

```sh
cd desktop
bun install --frozen-lockfile
bunx patchright install chromium
bun run dev
```

Use Bun 1.4.2. `bun run demo` opens synthetic accounts without account network requests or persistence. The original Python app remains unchanged and separate.

## Package

Run `bun run build` on the target operating system. It bundles the executable, Geist fonts, browser and internal runtime into `dist/`. Open `Riot 2FA.exe` on Windows, `Riot 2FA.app` on macOS, or `Launch Riot 2FA` on Linux. Keep the resources together.

The workflow builds Windows x64, Linux x64 and macOS arm64 artifacts. Packages are unsigned development builds; signing and release publication are not configured. Linux requires a graphical session and GPUI graphics libraries. Available Wayland clipboard/capture helpers and xclip are copied into the package. X11 capture additionally uses ImageMagick. Paste a QR URL when capture is unavailable.

## Behavior

- Codes are hidden on launch. Copy generates a fresh code and clears it after 30 seconds if unchanged and the app remains open.
- Login is user-driven and requires Riot email MFA. Requests require explicit approval or denial. QR sign-in has a separate confirmation.
- Account JSON is compatible with the original app. Secrets and sessions are unencrypted. Writes are atomic with owner-only POSIX permissions.
- Data: `%APPDATA%/Riot2FA` on Windows; `~/Library/Application Support/Riot2FA` on macOS; `$XDG_DATA_HOME/Riot2FA`, default `~/.local/share/Riot2FA`, on Linux. `RIOT2FA_DATA_DIR` overrides it. JS push credentials use a separate file from the old Python format.
- Keep the window open or minimized for requests. Closing quits; close-to-tray is not implemented. Windows requests appear in the app without OS toasts.
- Screen capture is temporary and local. macOS may require screen-recording permission.
- GPUIx lacks public password masking and full accessibility semantics. Manual secret entry is visible; controls support keyboard focus with visible borders. Screen-reader parity is not established.
- Release checks report desktop previews from aarsh21/riot-2fa-desktop. Updates are downloaded manually.

## Verification

```sh
bun run typecheck
bun test src/services
bun run verify
```

Unit checks cover TOTP vectors, storage integrity, account changes, cookie scoping and approval state. Native verification uses synthetic data only. On Hyprland it floats/resizes only the demo window and captures with grim. Keyboard automation avoids an upstream simulated mouse-click crash.

Linux native behavior is tested locally. Live sign-in was confirmed by the user on Linux. Windows/macOS execution, QR sign-in and push flows still need validation. The workflow itself does not establish that remote builds passed.

Independent software, not affiliated with Riot Games or Vercel. Geist uses the included SIL Open Font License. GPUIx is Apache-2.0.

## GitHub releases

Push a tag matching the package version, such as `desktop-v0.1.0`, to build and publish a GitHub prerelease. All three platform builds and their unit checks must pass before publication. Downloads have distinct platform names and SHA-256 checksums. Release notes come from `desktop/RELEASE_NOTES.md`. Ordinary pushes and pull requests build artifacts without publishing.
