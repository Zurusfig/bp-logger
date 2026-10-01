# Changelog

Notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com).

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
- `docs/incidents.md`, starting with the 2026-09 push quota outage.
- 22:00 daily summary to each household's admins: readings logged today, how many
  still need review, and which started slots are empty. Sent once a day, at tier
  `summary`, even when nothing was logged.
- Instant admin push for problem reads: a photo reading saved with `needs_review`
  goes to every admin other than the sender, at tier `admin`.
- Admins are members with `members.is_admin` set, by hand in Supabase.

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
- The sender's failed push is logged instead of rethrown.
- Reminders are off unless `REMINDERS_ENABLED=true`. Previously documented as off
  but never actually gated. The cron route now runs the summary every night and the
  reminders only when turned on.

### Removed

- The household fan-out. A saved, typed or completed reading now pushes only to the
  sender; everyone else uses the LIFF app (docs/decisions.md, "The message budget
  decides who hears about a reading").
- The 09:00 cron entry (docs/decisions.md, "One cron entry, and it reports rather
  than reminds").

## [1.0.0] - 2026-09-04

The state described in [the article](https://medium.com/@zagif2151382/reading-my-grandfathers-blood-pressure-monitor-with-a-line-bot-3ac6f7661d48).
Tagged `v1.0`. Group photo OCR, review queue, LIFF log and printable report, household
fan-out, reminders at 09:00 and 22:00.

[Unreleased]: https://github.com/Zurusfig/bp-logger/compare/v1.0...HEAD
[1.0.0]: https://github.com/Zurusfig/bp-logger/releases/tag/v1.0
