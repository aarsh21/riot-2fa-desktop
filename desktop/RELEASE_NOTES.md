## Changes

- Account secrets, browser sessions and push credentials use AES-256-GCM encryption. The key stays in Windows Credential Manager, macOS Keychain or the Linux Secret Service. Existing JSON files migrate after the encrypted copy is verified.
- Closing the window keeps the app running when a system tray is available. Open and Quit are in the tray menu. Launching the app again reopens the running instance.
- Windows region selection no longer uses the clipboard. Both-Shift active-window capture remains available.
- macOS supports a both-Shift region-capture shortcut with Input Monitoring permission. Linux registers a desktop-portal shortcut. Some compositors require assigning its key combination in desktop settings.
- Native accessibility support comes from a pinned GPUIx source build, with named buttons, fields, headings and confirmation dialogs.
- Push errors distinguish Riot's Android-only Firebase restriction from a connection failure.

## Downloads

Extract the matching archive and open `Riot 2FA.exe`, `Riot 2FA.app`, or `Launch Riot 2FA`. Keep the application resources together. Checksums are included. No separate runtime installation is needed.

## Remaining checks and requirements

Live Linux browser sign-in was confirmed by the user. Live QR approval remains unverified, at the user's request. Google rejects this desktop client's push registration with `API_KEY_ANDROID_APP_BLOCKED`; Riot must permit a desktop registration method before that connection can work.

The OS credential store must be available and unlocked. Keep the vault and its OS key together; copying encrypted files alone to another computer does not transfer accounts. Migration removes the old files but cannot erase copies retained by backups or the filesystem.

Linux needs a supported graphics stack, a Secret Service and a desktop portal for global shortcuts. Close-to-tray needs a tray host; otherwise closing quits. macOS requires the applicable Input Monitoring and Screen Recording permissions. Native accessibility trees can be checked automatically, but complete NVDA, VoiceOver and Orca workflows still need human verification.

Builds remain unsigned and macOS is not notarized. Keep another sign-in method available.
