# Changelog

## [Unreleased]

### Added

- `lib/alert.ts`: `alert(level, message)` posts to a Discord webhook. Never throws.
  See docs/decisions.md ("Alerts never go over LINE").
- `lib/quota.ts`: `push_log` (month, used, exhausted) and `claim(tier)`, an atomic
  claim against the tier reserves in docs/decisions.md ("When the quota runs low,
  reminders go first"). Not yet wired into any send path.
- `push_log` table and `claim_push()` / `mark_push_exhausted()` functions
  (`supabase/migrations/0002_push_log.sql`).
- `PUSH_DRY_RUN=true` logs push messages instead of sending them.

### Changed

- `lib/line.ts`: `pushMessage` now returns a typed `PushResult` instead of resolving
  `void`. A 429 sets `push_log.exhausted` and alerts; any other non-ok, non-403
  response alerts. 403 is unchanged — still throws `PushForbidden` for the caller to
  mark the recipient unreachable.
