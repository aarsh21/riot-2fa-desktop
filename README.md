# Riot 2FA Desktop

A native desktop authenticator built with GPUIx, React and TypeScript. One app, with its runtime and sign-in browser included.

[Download](https://github.com/aarsh21/riot-2fa-desktop/releases) · [Report an issue](https://github.com/aarsh21/riot-2fa-desktop/issues)

## Features

- Riot browser sign-in or manual account setup.
- SHA-256 authentication codes, account search and copy.
- Explicit approval or denial of sign-in requests.
- QR sign-in with a separate confirmation.
- SnapShots on Windows: enable the shortcut in Settings, focus the window containing a Riot QR code, then press both Shift keys together. The app captures that window, reads the QR code locally, and opens the review flow.
- Capture region uses Windows Snipping Tool, with region and window selection. macOS uses its native capture selector. Linux uses available desktop capture tools.
- System light and dark appearance, with bundled Geist fonts.

Snapshots are temporary and deleted after decoding. The shortcut is off until enabled. Capturing a QR code never approves a sign-in automatically. Windows Snipping Tool also places its capture on the system clipboard.

## Install

Extract the matching download and keep its files together:

| Platform | Open |
| --- | --- |
| Windows x64 | `Riot 2FA.exe` |
| macOS Apple Silicon | `Riot 2FA.app` |
| Linux x64 | `Launch Riot 2FA` |

These are unsigned preview builds. macOS builds are not notarized. Linux requires a graphical session and compatible graphics libraries. See the notes attached to each release for its supported features and known issues.

## Development

Install Bun 1.4.2, then:

```sh
cd desktop
bun install --frozen-lockfile
bunx patchright install chromium
bun run dev
```

`bun run demo` uses synthetic accounts. `bun run build` produces a native package for the current operating system.

```sh
bun run typecheck
bun test src/services
bun run verify
```

Windows CI checks actual capture of a synthetic QR window. Linux UI checks cover keyboard interaction, compact layout, and light/dark appearance. Live sign-in was confirmed by the user on Linux; push registration remains a known issue. Closing the app stops sign-in requests.

Account secrets and sessions are stored locally as unencrypted JSON. Full screen-reader support is not yet available. No account data is included in this repository.

## Credits

Credit to **Askin242** for the [original Riot account implementation](https://github.com/Askin242/RiotGames-Mobile-2FA-Bypass), which informed this desktop app. Original copyright and license notices are preserved in [LICENSE](LICENSE).

The SnapShots interaction is inspired by [T3 Code](https://github.com/pingdotgg/t3code). The capture integration here is implemented for GPUIx. Geist is provided by Vercel under the included SIL Open Font License.

Independent software, not affiliated with Riot Games or Vercel.
