## Changes

- Account secrets, browser sessions and push credentials use AES-256-GCM encryption. The key stays in Windows Credential Manager, macOS Keychain or the Linux Secret Service. Existing JSON files migrate after the encrypted copy is verified.
- Closing the window keeps the app running when a system tray is available. Open and Quit are in the tray menu. Launching the app again reopens the running instance.
- Windows region selection no longer uses the clipboard. Both-Shift active-window capture remains available.
- macOS supports a both-Shift region-capture shortcut with Input Monitoring permission. Linux registers a desktop-portal shortcut. Some compositors require assigning its key combination in desktop settings.
- Native accessibility support comes from a pinned GPUIx source build, with named buttons, fields, headings and confirmation dialogs.
- Riot session renewal persists rotated cookies. Reconnect preserves the existing authenticator secret, and each account shows separate code verification and QR session status.
- Firebase registration supplies the required Android identity headers. Installation tokens renew before expiry; temporary listener and device-registration failures retry automatically.
- Google delivery connections verify the server certificate. Listener shutdown cancels pending startup work.

## Downloads

Extract the matching archive and open `Riot 2FA.exe`, `Riot 2FA.app`, or `Launch Riot 2FA`. Keep the application resources together. Checksums are included. No separate runtime installation is needed.

## Remaining checks and requirements

Live Linux validation now covers the packaged executable renewing an expired local bearer cache, approving its own fresh Riot QR challenge, saving the renewed session in an OS-keyed encrypted vault, and connecting its Google listener. Separate live checks confirm renewal of eight-day-old local Firebase installation metadata and Riot device registration. Actual live OTP acceptance and delivery of a real MFA notification remain unverified. Windows and macOS execution were not performed on this Linux host.

The OS credential store must be available and unlocked. Keep the vault and its OS key together; copying encrypted files alone to another computer does not transfer accounts. Migration removes the old files but cannot erase copies retained by backups or the filesystem.

Linux needs a supported graphics stack, a Secret Service and a desktop portal for global shortcuts. Close-to-tray needs a tray host; otherwise closing quits. macOS requires the applicable Input Monitoring and Screen Recording permissions. Native accessibility trees can be checked automatically, but complete NVDA, VoiceOver and Orca workflows still need human verification.

Builds remain unsigned and macOS is not notarized. Keep another sign-in method available.
