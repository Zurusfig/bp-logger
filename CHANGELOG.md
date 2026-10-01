# Changelog

## [Unreleased]

### Added

- `lib/alert.ts`: `alert(level, message)` posts to a Discord webhook. Never throws.
  See docs/decisions.md ("Alerts never go over LINE").
- `lib/quota.ts`: `push_log` (month, used, exhausted) and `claim(tier)`, an atomic
  claim against the tier reserves in docs/decisions.md ("When the quota runs low,
  reminders go first").
- `push_log` table and `claim_push()` / `mark_push_exhausted()` functions
  (`supabase/migrations/0002_push_log.sql`).
- `PUSH_DRY_RUN=true` logs push messages instead of sending them. The quota claim
  still runs, so dry-run sends count against `push_log`.
- `REMINDERS_ENABLED=true` turns the missed-slot reminders back on.

### Changed

- `REVIEW_THRESHOLD` 0.95 to 0.75 (`lib/ocr.ts`). Set from 53 September production
  readings, where every correction sat at 0.60 or below, instead of one eval run of
  twenty images. See docs/decisions.md ("The review threshold comes from production
  corrections").

- `lib/line.ts`: `pushMessage` now returns a typed `PushResult` instead of resolving
  `void`. A 429 sets `push_log.exhausted` and alerts; any other non-ok, non-403
  response alerts. 403 is unchanged — still throws `PushForbidden` for the caller to
  mark the recipient unreachable.
- `pushMessage(userId, text, tier)` claims against the monthly budget before every
  send and returns `{ ok: false, reason: "quota" }` without calling LINE when the
  claim is refused. Sender messages use tier `sender`, reminders `reminder`.

### Removed

- The household fan-out. A saved, typed or completed reading now pushes only to the
  sender; everyone else uses the LIFF app (docs/decisions.md, "The message budget
  decides who hears about a reading").
- The sender's failed push is no longer rethrown after the fan-out; it is logged.
- Reminders are off unless `REMINDERS_ENABLED=true`. Previously documented as off
  but never actually gated.
- The 09:00 cron entry (docs/decisions.md, "One cron entry, and it reports rather
  than reminds").
