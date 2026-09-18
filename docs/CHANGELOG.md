# Changelog

Notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Changed
- `REVIEW_THRESHOLD` 0.95 to 0.75, set from 53 production corrections instead of one eval run
- Reading confirmations go to the sender only
- 1:1 chats get free reply messages, with push as fallback
- The 22:00 cron sends a daily summary instead of a missed-slot reminder

### Added
- Message quota guard: local `push_log`, nightly reconciliation with LINE, tiered drop order
- Discord webhook alerts for quota tiers, unexpected push errors and worker failures
- `PUSH_DRY_RUN` to log messages instead of sending them
- `docs/incidents.md`

### Removed
- Household fan-out: every member used to be pushed about every reading
- The 09:00 reminder cron. Reminders off by default via `REMINDERS_ENABLED=false`

## [1.0.0] - 2026-09-04

The state described in [the article](https://medium.com/@zagif2151382/reading-my-grandfathers-blood-pressure-monitor-with-a-line-bot-3ac6f7661d48).
Tagged `v1.0`. Group photo OCR, review queue, LIFF log and printable report, household
fan-out, reminders at 09:00 and 22:00.