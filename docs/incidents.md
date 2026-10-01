# Incidents

One section per production failure. Written after it is fixed, not while fixing it.

## 2026-09: LINE push quota exhausted

**Symptom.** No confirmations and no reminders from about 7 September. Photos were still read,
readings still saved, LIFF still updated. Only outgoing messages were missing.

**Detected.** The family mentioned it on 15 September. Nothing alerted. About 8 days silent.

**Cause.** The Free plan allows 300 sends a month, counted per recipient. Every reading pushed
to every enrolled member: 13 recipients, about 3.5 readings a day, plus reminders to all 13
twice a day. Roughly 690 sends attempted against a cap of 300.

**Contributing factors.**
- Push failures other than 403 were not logged, so 429 responses were invisible.
- Cost analysis during the build covered the OCR API and never the messaging quota.
- There was no alerting channel outside LINE, so an alert about this would also have failed.

**Fix.** Sender plus admin only, no household fan-out. Reminders off. 22:00 daily summary.
Review threshold 0.95 to 0.75 so fewer readings become admin pushes. Local quota counter with
a tiered drop order. Discord alerts.

**Immediate mitigation.** `update members set notify_all = false, notify_reminders = false;`
run on 15 September, which caps October at about 106 sends even if nothing else ships.

**Prevention.** Alerting lives outside the channel it monitors. Any metered resource gets a
counter and a reserve, not just a hope that the volume stays small.

**Open.** The timezone LINE resets the monthly quota in is unconfirmed. The nightly sync
catches a reset within a day.