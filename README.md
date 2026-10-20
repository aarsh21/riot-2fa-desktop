# Riot 2FA Desktop

A native desktop authenticator built with GPUIx, React and TypeScript. One app, with its runtime and sign-in browser included.

[Download](https://github.com/aarsh21/riot-2fa-desktop/releases) · [Report an issue](https://github.com/aarsh21/riot-2fa-desktop/issues)

## Features

- Riot browser sign-in or manual account setup.
- Account reconnection that preserves the existing secret, plus an explicit code check with Riot.
- Separate code verification and QR session status for every account.
- SHA-256 authentication codes, account search and copy.
- Explicit approval or denial of sign-in requests.
- QR sign-in with a separate confirmation.
- SnapShots on Windows: enable the shortcut in Settings, focus the window containing a Riot QR code, then press both Shift keys together. The app captures that window, reads the QR code locally, and opens the review flow.
- Region capture on Windows, macOS and Linux. Windows uses its own selector without touching the clipboard.
- macOS both-Shift and Linux desktop-portal capture shortcuts.
- Close-to-tray, with Open and Quit actions, when the desktop has a tray host.
- Encrypted account and session storage backed by the OS credential store.
- Native accessibility labels, headings and dialogs.
- System light and dark appearance, with bundled Geist fonts.

Snapshots are temporary and deleted after decoding. The shortcut is off until enabled. Capturing a QR code never approves a sign-in automatically.

## Install

Extract the matching download and keep its files together:

| Platform | Open |
| --- | --- |
| Windows x64 | `Riot 2FA.exe` |
| macOS Apple Silicon | `Riot 2FA.app` |
| Linux x64 | `Launch Riot 2FA` |

These are unsigned preview builds. macOS builds are not notarized. Linux requires a graphical session and compatible graphics libraries. See the notes attached to each release for its supported features and known issues.

## Development

Install Bun 1.4.2 and Rust 1.97.1, then:

```sh
cd desktop
bun install --frozen-lockfile
bun run prepare:renderer
bunx patchright install chromium
bun run dev
```

`bun run demo` uses synthetic accounts. `bun run build` produces a native package for the current operating system.

```sh
bun run typecheck
bun test src/services
bun run verify
bun run verify:session
bun run verify:login
```

Windows CI checks actual capture of a synthetic QR window. Linux UI checks cover keyboard interaction, compact layout, and light/dark appearance. Live sign-in was confirmed by the user on Linux. Live Linux checks now cover native QR approval, renewal after a locally expired bearer cache, Firebase installation renewal, a Google delivery connection and Riot device registration. Actual MFA notification delivery and live OTP acceptance remain unverified.

### Codes and session expiry

Codes are generated locally from the saved secret using SHA-256, six digits and a 30-second period. Browser token expiry does not stop code generation. Keep automatic date and time enabled on your computer. If Riot Mobile is enrolled again elsewhere, Riot may replace the secret; reconnecting a browser session cannot restore a replaced secret.

QR sign-in needs an online Riot session. The app uses a valid cached token first, saves cookies rotated by Riot during renewal, and attempts renewal on startup and every 15 minutes while running. Riot can still revoke or expire a session, especially while the app is closed. Use **Reconnect** on the affected account. It preserves the secret and checks a code with Riot instead of enrolling again.

**Check code** reports whether Riot accepts a code from the saved secret now. Newly enrolled accounts stay visibly unverified until Riot accepts their code. A successful check is recorded with its date. If Riot Mobile is already enabled and its secret is not saved here, import the existing secret; this app does not reset the remote factor automatically.

The automated native session test uses intercepted Riot responses and synthetic accounts. It exercises expired session recovery, code verification, encrypted restart and copying, while checking that a second account stays unchanged. It does not establish live Riot OTP or QR acceptance. Live OTP acceptance remains unverified. Separate explicit live tests validate native QR approval, real Riot session renewal after local cached-token expiry, Google listener authentication, and Riot push-device registration. Their JSON evidence records the source hashes and omits credentials and account identifiers.

The push listener supplies Firebase’s required Android package/certificate metadata, renews installation credentials before their seven-day expiry, and retries temporary failures. It validates Google’s TLS certificate and never approves sign-ins automatically.

Account secrets and sessions are encrypted using a key held by Windows Credential Manager, macOS Keychain or Linux Secret Service. The credential store must be unlocked. Existing account JSON migrates automatically. Copying vault files alone does not transfer accounts to another device.

Linux global shortcuts require a supporting desktop portal. Hyprland users must assign `dev.riot2fa.desktop:capture` to a key in their compositor settings. macOS may request Input Monitoring and Screen Recording permissions. Native accessibility support is implemented; complete screen-reader workflows still need human verification. No account data is included in this repository.

See [desktop development](desktop/README.md) for native build dependencies and verification.

## Credits

Credit to **Askin242** for the [original Riot account implementation](https://github.com/Askin242/RiotGames-Mobile-2FA-Bypass), which informed this desktop app. Original copyright and license notices are preserved in [LICENSE](LICENSE).

The SnapShots interaction is inspired by [T3 Code](https://github.com/pingdotgg/t3code). The capture integration here is implemented for GPUIx. Geist is provided by Vercel under the included SIL Open Font License.

Independent software, not affiliated with Riot Games or Vercel.
