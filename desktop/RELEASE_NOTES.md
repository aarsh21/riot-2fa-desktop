## Changes

- Removed redundant UI captions and helper text.
- Added Windows SnapShots: enable it in Settings, focus a Riot QR window, then press both Shift keys. Captures are decoded locally and deleted, with explicit sign-in review afterward.
- Capture region now uses Windows Snipping Tool, with region/window selection and cancellation.
- Removed legacy source files and rewrote the README, preserving credit to Askin242.

## Downloads

- Windows x64: extract the ZIP and open `Riot 2FA.exe`.
- Linux x64: extract the archive and open `Launch Riot 2FA`.
- macOS Apple Silicon: extract the archive and open `Riot 2FA.app`.

Keep application resources together. No separate runtime installation is needed. Checksums are included.

## Preview limits

Live Riot sign-in was confirmed by the user on Linux. Push registration still reports `PHONE_REGISTRATION_ERROR` on the development machine. QR approval against a live Riot request remains unverified.

Windows CI tests native capture and the both-Shift shortcut against a synthetic QR window. macOS/Linux retain region capture; their global shortcut is not implemented. Windows Snipping Tool places its capture on the clipboard.

Builds are unsigned, and macOS is not notarized. Closing quits; there is no close-to-tray. Secrets and sessions are stored in local unencrypted JSON. Full screen-reader support is not established. Do not rely on this preview as your only sign-in method.
