# Design decisions

Why the system works the way it does. Each entry points at the code, where the same
reasoning is usually written in a comment next to the thing it explains.

A `> Superseded` note under a heading means the decision no longer holds. The original
reasoning is kept below it, and the code that implemented it is at tag `v1.0`.

## Reading the photo

### The model's orientation report is a trigger, never an answer

`lib/ocr.ts:156`, `lib/ocr.ts:167`

Phone photos of a monitor arrive rotated. Seven-segment digits stay readable when you turn
them, but they turn into different digits. A rotated 6 reads as 9. A rotated 5 reads as 2.
116 becomes 911.

The prompt asks the model for an orientation before it reads anything. That answer isn't
reliable enough to act on. So it's only used as a signal that something is off.

When the model reports any rotation, sharp physically rotates the image to 90, 180 and 270
and reads all three. The angle the model named picks nothing. The four candidate reads get
ranked by how many fields they filled, then by confidence.

### Agreement between rotations is the confidence signal

`lib/ocr.ts:185`, `lib/ocr.ts:194`

A model's own confidence score on a blurred LCD isn't worth much on its own. Agreement is
better evidence. If two or more rotations produce the same three numbers, that's hard to get
by chance.

So the winning read's confidence gets overwritten. Two or more rotations agreeing caps it at
0.9. No agreement drops it to 0.6.

### Null beats a guess

`lib/ocr.ts:23`, `lib/ocr.ts:62`

A wrong number that looks right is worse than no number. It lands on the doctor's table and
nothing marks it as suspect. A null is visibly missing and goes to the review queue.

The prompt says this in several ways. Never guess a digit. A partly visible number is null.
"Probably 5" is null. There's no penalty for null. Don't infer a value from what's medically
plausible.

The prompt also tells the model to cap its own confidence at 0.7 on blurred or out-of-focus
images, because blur causes single-segment misreads that feel certain. 66 reads as 65. 8
reads as 6.

### The output schema puts reasoning before digits

`lib/ocr.ts:23`

The JSON keys have to come out in a fixed order, and `orientation_deg` and `observations`
come first. The numbers come after.

That's deliberate. The model commits to an orientation and writes down which digits are
unreadable before it produces any value. `observations` is capped at 30 words and scoped to
those two things.

There's no structured-output enforcement on the API call. The contract is prompt-only, which
is why `extractJson` walks the reply looking for the first balanced object.

### The review threshold comes from production corrections

`lib/ocr.ts`

0.95 was set from one eval run, and on the strength of img_028, which turned out to be a
label of mine that was wrong. In production it flagged 45 of 53 readings, so almost every
reading needed a human.

53 September readings with LIFF confirmations give a better answer. Every correction sat at
0.60 or below. Nothing at 0.65 or above was ever corrected, across 21 readings. The eval sets
agree: the highest-confidence wrong field anywhere is 0.6.

Set to 0.75. It keeps two buckets of margin above the highest known wrong read and brings
flagging from 85% to 62%. The floor is about 28%, because 15 of 53 readings genuinely needed
a fix.

Revisit monthly against fresh corrections. Never raise it on one run of twenty images again.

## Deciding what to read at all

### Colour and aspect-ratio filtering were measured, then dropped

`lib/prefilter.ts:16`

Both looked like obvious cheap filters. Neither survived contact with real photos.

Pink and colour-cast monitor shots reach a channel spread around 49, which overlaps ordinary
photos. Any saturation threshold risks dropping a real reading. Aspect ratio is worse:
monitor shots are plain 16:9 or 9:16 phone photos, identical to everything else in the group.

What's left is a filter that only rejects shapes a monitor photo can't have. Extreme aspect
ratios, images too small to resolve digits, animated files.

### The error costs aren't symmetric, so triage fails open

`lib/prefilter.ts:22`, `lib/prefilter.ts:97`

Asymmetric error cost, meaning the two ways of being wrong cost very different amounts.

A false negative drops a real reading. Nobody finds out. The household believes it was
recorded and it wasn't.

A false positive sends a photo of lunch to the OCR. That costs a fraction of a cent.

So everything ambiguous goes through. The triage prompt is told to answer YES when it can't
tell what it's looking at. Any unexpected reply from the model is also treated as YES.

### Triage is skipped in a private chat

`lib/worker.ts:108`

Forwarding a photo to the bot directly is an explicit request to read it. That doesn't need
filtering, so it goes straight to the full pipeline.

### A hard daily cap

`lib/prefilter.ts:11`

50 reads per group per day. It exists so a holiday photo dump can't run up a bill.

The counter lives in Postgres and the RPC that increments it swallows its own errors and
returns 0. Accounting failure shouldn't block a reading, and the cap failing open is the
cheaper mistake.

The LINE message budget is the same idea applied to a different meter, with one difference:
that one fails **closed**. An API overrun costs a fraction of a cent; a message overrun
silently disables every outgoing message for the rest of the month.

## Storing it

### One row per photo, never merged

`lib/worker.ts:103`, `lib/db.ts:106`

Deduplication is an exact SHA-256 of the image bytes, scoped to the group. The same photo
posted twice is one reading. Two different photos minutes apart are two readings, because
that's what a two-measurement session is.

Nothing averages or collapses readings anywhere in the pipeline.

### Delete is always soft

`app/api/readings/[id]/route.ts:151`

Deleting sets `deleted_at`. Every read query filters on it. The row and its photo stay.

### Any row can be edited, and editing clears the review flag

`app/api/readings/[id]/route.ts:49`

Confirmed rows are editable too. A confidently wrong reading looks settled and still needs
fixing.

A person comparing the number against the photo is better evidence than the OCR that produced
it. So an edit clears the review flag instead of raising it. `edited_by`, `edited_at`,
`reviewed_by` and `reviewed_at` record who did what.

### One validation gate, used in both places

`lib/ocr.ts:199`, `app/api/readings/[id]/route.ts:90`

The checks are: SYS 60-260, DIA 30-160, pulse 30-180, SYS above DIA, and a gap between them
of more than 10.

The edit endpoint used to have its own copy of the range checks and was missing the gap rule,
so a manual edit could save something the OCR path would have rejected. It now calls the same
`validate()` function.

It runs against the merged row rather than just the incoming fields. Editing one value can
only be judged next to the two it has to agree with.

### Readings before dawn belong to yesterday

`lib/slot.ts:55`

A measurement at 00:20 is a before-bed reading. Filing it under the next morning creates a
phantom entry and loses the real one.

Anything before the first slot of the day gets filed under the previous day's last slot.

### Slot windows are a guess, so the slot stays editable

`lib/slot.ts:59`

Readings get sorted into named slots by clock time. Waking and after-morning-medicine sit
close together and will sometimes catch the wrong reading.

The assignment is a default, not a fact. Every row in the app exposes it for editing.

## Talking to people

### The bot never posts in the group

`lib/line.ts:40`

The group chat is a real conversation between family members. A bot replying to every photo
would ruin it.

Confirmations, requests for missing digits and correction receipts all go to the sender's
private chat with the account. A 403 back from LINE means that person never added the account
as a friend, so they get marked unreachable instead of retried forever.

Reconsidered 2026-09. Reply messages are free where pushes are metered, so replying to the
photo in the group would make every confirmation cost nothing. Rejected anyway: it notifies
13 people per photo, and the group is where the family actually talks. This rule costs real
quota and is worth it.

### Everyone else in the household hears about it too

> **Superseded 2026-09** by "The message budget decides who hears about a reading".
> One push per member per reading, times 13 members, exhausted the 300/month cap in about
> six days. See `docs/incidents.md`. Original behaviour is at tag `v1.0`.

`lib/worker.ts:180`

Anyone in the household can open the app to check or finish a reading, so a saved reading
gets pushed to every other member who wants it.

That fan-out never throws. The reading is already saved by the time it runs, so a lookup
failure or one person's push failing must not take down the rest.

The message to someone who didn't take the reading never asks them to reply with numbers.
The pending-fill record is keyed to the sender's user ID, so only the sender's reply can fill
it in. Everyone else gets the edit link.

### The sender's push failing doesn't cancel the fan-out

> **Superseded 2026-09**. There is no fan-out left to protect. The sender's push is now the
> only one on the reading path, and its failure is recorded, not rethrown.

`lib/worker.ts:258`

If the sender has blocked the account, their own confirmation fails. The rest of the
household still needs telling. The error is held and rethrown after the fan-out runs.

### Typed numbers in the group need an exact match

`lib/worker.ts:265`

The regex is anchored at both ends and matches three numbers with separators and nothing
else. Thai phone numbers and prices in ordinary chat both contain runs of digits, and neither
should create a reading.

### Reminders are a checklist, not a health warning

`lib/messages.ts:196`

The reminder says a slot hasn't been logged today. It never mentions values, risk or
outcomes. It's the same shape whether one slot or three are due.

Disabled 2026-09: off unless `REMINDERS_ENABLED=true`, so a missing variable can't turn
them back on. The family didn't act on them, and each one cost one message per recipient.
Missed slots appear in the 22:00 summary instead. The code stays in place so they can be
switched back on if the habit changes.

### The message budget decides who hears about a reading

`lib/quota.ts`, `lib/worker.ts`

The Free plan allows 300 sends a month. Pushes are counted per recipient, so a push to 13
people is 13 messages. Replies are not counted at all.

Who gets a push:

- the sender, confirming the reading or asking for a missing number
- the admin, for problem reads only, plus a 22:00 summary
- nobody else. Everyone else uses the LIFF app, which is what they already do.

About 202 of 300 in a normal month. The household fan-out was 690 and did not fit.

The admin is whoever has `members.is_admin` set, by hand in Supabase. The column was in the
schema from the start and unused until now. A household can have more than one, and each one
costs a send. An admin who sent the reading is not pushed about it twice.

### When the quota runs low, reminders go first

`lib/quota.ts`

Drop order, cheapest loss first: reminders, then the admin's instant problem pushes (the
22:00 summary still carries the count), then the summary, and last the sender's messages.
The sender is last because only the sender can fix a bad read quickly.

Tiers on remaining quota: 60 stops reminders, 40 stops admin pushes, 15 leaves sender
messages only, 0 means LIFF alone.

### Reply first in a 1:1 chat, push only as fallback

`lib/line.ts`

A reply token arrives with every inbound event, costs nothing, expires in about 60 seconds,
and can only answer the chat the message came from. Text follow-ups in the 1:1 chat are a
fast database write, so a reply almost always makes the window.

Group photos cannot use it, because the reply would land in the group. Those stay push.
If the token has expired or the reply fails, fall back to push.

### The quota is counted locally, not asked for on every send

`lib/quota.ts`

Asking LINE before every send costs two extra API calls on the photo path, which is the path
already racing a 60 second reply window. So a `push_log` row per month is incremented on
every successful send, the 22:00 cron reconciles it against LINE's real consumption once a
day, and a 429 sets `exhausted` until the next month.

The local count can drift, for example when LINE does not count a push to someone who blocked
the account. The nightly sync corrects it, and the reserve absorbs the drift in between.

### Alerts never go over LINE

`lib/alert.ts`

The 2026-09 outage was the messaging channel itself failing. An alert sent over that channel
would have failed with it. Alerts go to a Discord webhook: no monthly cap, and it is on the
admin's phone.

Alert on: a quota tier being crossed, any push error other than 403, any `worker failed` or
`event failed`, and the cron failing.

A tier crossing alerts on the one claim that lands exactly on that tier's floor, so each
alerts once a month. A 429 alerts once too, from whichever request first sets `exhausted`.
It is kept, even with tier alerts, because a 429 means LINE ran out before the local count
did: the count has drifted, and no tier alert would have said so.

## Platform

### Acknowledge LINE first, read the photo afterwards

`app/api/webhook/route.ts:21`

LINE retries a webhook it doesn't get a fast answer to. The read pipeline is between one and
eight vision calls.

So the handler checks the signature, hands everything to Vercel's `waitUntil`, and returns
200 with an empty body before OCR starts. The promise has its `.catch` attached inline,
because an unhandled rejection after the response has gone would kill the invocation.

### The signature is computed over raw bytes

`app/api/webhook/route.ts:9`

LINE signs exactly the bytes it sent. Parsing the JSON and re-serialising it produces
different bytes, and verification fails every time. The handler reads the body as text and
only parses after the check passes.

### Enrolment happens on any group activity

`lib/worker.ts:58`

Someone who never posts a photo still needs to open the app. Without a row in `members` the
session lookup can't tell which household they belong to, and they're locked out.

So any message in an allowed group enrols the sender, and so does a `memberJoined` event.

### One cron entry, and it reports rather than reminds

> **Replaces "Two cron entries, one endpoint, no shared state" (2026-09).**
> The 09:00 entry is gone with the reminders. Original behaviour is at tag `v1.0`.

`app/api/cron/reminders/route.ts`

The 22:00 entry survives because the daily summary needs it: how many readings were logged,
how many were flagged, which slots are missing. That is one message a day to the admin
instead of one per member per missed slot.

The summary goes to every reachable admin, even on a day with nothing logged, since that is
the day the admin most needs to hear about. A household with no admin gets no summary, and
the run logs that. Missing slots are the ones whose start time has passed and that have no
reading yet, so a slot that begins after 22:00 is never reported missing.

The route still works out from the data what is due, so repeated or overlapping runs stay
harmless. The summary is recorded in `reminders_sent` under the reserved key `_summary`
before it is pushed, so a retry finds it and sends nothing. Reminder sends are recorded before the push, which means a send blocked by the
quota guard still consumes its claim. Acceptable while reminders are off; revisit if they
come back.

### The Supabase client is built lazily

`lib/db.ts:13`

Next.js imports this module during the build to collect page data, before any environment
variables exist. Creating the client at module scope fails the production build with
"supabaseUrl is required".

The same comment carries the other half: this client holds the service key, which bypasses
row-level security, so it must never end up in anything shipped to the browser.

### Household isolation is hand-written

`app/api/readings/[id]/route.ts:23`

There are no RLS policies. Every query chains a `group_id` filter, and the single-row routes
repeat it on the write as well as the read, so another household's reading ID returns 404
rather than 403.

This is a real constraint. There's no database-level backstop if a future route forgets.

### One LINE user, one household

`lib/db.ts:56`

`members.user_id` is the primary key and enrolment upserts on it. Someone in two allowed
groups gets moved to whichever they used most recently.

The fix is dropping the key to `(user_id, group_id)` and storing a current-household pointer
for private-chat lookups. That's a schema change and it hasn't been done.

## Front end

### html2canvas-pro, and hex colours in the report

`app/app/report/page.tsx:92`, `lib/report-format.ts:3`

Tailwind v4 emits `oklch()` colour values. The original html2canvas can't parse them and
throws.

The report views use the fork instead. Their colours are written as hex literals that mirror
the design tokens, rather than as Tailwind classes, for the same reason.

### The report expands before it's captured

`app/app/report/page.tsx:92`

The sheet is `width: 100%` so it never overflows its scroll container. html2canvas only
captures the element's own box, so a report wide enough to scroll was getting silently
cropped.

It's temporarily widened to its full content width, captured, then restored in a `finally`.

### LINE's in-app browser can't download or print

`app/app/report/page.tsx:92`

Two workarounds for the same cause. The WebView that LINE opens LIFF apps in doesn't reliably
honour `<a download>`, and the tap just does nothing. So inside LINE the PNG is shown as an
image and the user long-presses to save it.

The same WebView has no print UI, so `window.print()` is a no-op. Print hands off to the
device's real browser instead, carrying the selected date range in the URL.

### Two report layouts

`components/report-sheet.tsx`, `components/report-table.tsx`

The sheet runs days down the page and slots across it, which is how paper blood pressure
diaries are laid out and what keeps a month on one A4 page.

The table is one row per reading. Some doctors ask for that instead.

### Thai and Latin from one typeface

`app/layout.tsx:5`

Anuphan covers both scripts as a single family. The SYS and DIA labels sit on the same
optical grid as the Thai text around them instead of falling back to a mismatched system
font.