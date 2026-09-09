A native GPUIx desktop preview with a monochrome interface, bundled Geist fonts, system appearance, and TypeScript account logic. No Python or separate server is required.

## Downloads

- Windows x64: extract the ZIP and open `Riot 2FA.exe`.
- Linux x64: extract the archive and open `Launch Riot 2FA` in the application folder. Requires a graphical desktop and compatible graphics libraries.
- macOS Apple Silicon: extract the archive and open `Riot 2FA.app`.

Keep each application's resources together. Chromium is included for the dedicated sign-in window. SHA256SUMS.txt contains archive checksums.

## Included

Account search, SHA-256 authentication codes, copy, manual account addition, account removal, browser enrollment, explicit push approval/denial, and QR sign-in with confirmation. Codes are hidden on launch. Copy clears after 30 seconds if unchanged while the app remains open.

## Preview limitations

- The user confirmed live Riot sign-in on the Linux development build. QR sign-in has not been confirmed end to end. Push registration currently reports `PHONE_REGISTRATION_ERROR` on the development machine. Do not rely on this preview as your only way to sign in.
- Native interaction checks passed on Linux with synthetic accounts. Windows and macOS packages pass build and unit checks before publication, but have not had native UI or live-account testing.
- Builds are unsigned and macOS is not notarized. OS security prompts may prevent opening them.
- Closing the window quits; there is no close-to-tray behavior. Windows OS toast notifications are not implemented.
- Account secrets and saved sessions are local, unencrypted JSON. Manual secret entry is visible. Full screen-reader support is not established.
- Screen capture depends on desktop support and permissions. A QR URL can be pasted instead.

This is independent software, not affiliated with Riot Games or Vercel. The original Python app remains available in the source tree.
