# FlyFam notification sounds

Custom push sounds for family notifications (takeoff / landing / roster share).

## Current set

| File | Role | Design |
|------|------|--------|
| `flyfam_took_off.wav` | Takeoff | **K1** — classic rising beep (low → high) |
| `flyfam_landed.wav` | Landing | **L1** — classic falling beep (high → low) |
| `flyfam_roster_share.wav` | Roster share | Mixkit airport announcement ding (terminal) |

Preview / picks: `docs/notification-sounds-preview.html`

## Native packaging (required)

`app.config.js` registers these under `expo-notifications` → `sounds`, but with a committed `android/` + `ios/` tree the files must also live in the native projects:

- Android: `android/app/src/main/res/raw/*.wav`
- iOS: `ios/FlyFam/Sounds/*.wav` (and listed in the Xcode Resources build phase)

Android notification channels lock their sound on first creation — channel IDs use `_v2` (`flyfam_took_off_v2`, …) so existing installs recreate channels after a store update.

Rich notification artwork (colored takeoff / landing / roster images) lives under `assets/notification-artwork/` and is documented there — separate from these sound files.
