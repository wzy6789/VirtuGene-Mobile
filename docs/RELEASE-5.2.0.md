# VirtuGene Mobile 5.2.0

Release date: 2026-09-23

## What's new

- Connects memory across private chat, group chat, Moments, diary, todos, and the world while respecting who actually witnessed or was allowed to see each item.
- Revoking access, editing, or deleting a source invalidates derived memories and summaries; older backups cannot restore withdrawn information.
- Group summaries are scoped to the current member roster so a character does not receive private context they never witnessed.
- Separates unfinished todo reminders from completed, shared experiences.

## Build verification

- Android `versionCode`: 27; `versionName`: 5.2.0.
- TypeScript check and Vite production build passed.
- Release APK signature matches the existing upgrade certificate: `ef38a01c9c1674a53537330e6de7ed6e3de86359715bc9c61af53ffc9de04016`.
- APK SHA-256: `CDC5104560F86E4FF00E605EEF6CE88EBADB1FEF404A451696C6207A0E6697E7`.
- APK size: 4,104,667 bytes.
- Browser verification: 7 suites, 342 assertions passed; Android device verification remains outstanding.
