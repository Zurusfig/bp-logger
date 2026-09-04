# Evaluation

How the OCR gets tested, what it scores, and the one failure that matters.

All numbers here come from `eval/results/`, produced at `REVIEW_THRESHOLD = 0.95` and
`temperature: 0` against the prompt currently in `lib/ocr.ts`. Runs aren't deterministic even
at pinned temperature, so treat single figures below as one representative run, not an exact
measurement — see the README's results table for the reproducible ranges across repeat runs.

The sys/dia/pulse values inside `eval/labels.csv` and `eval/results/*.json` are placeholders.
They were real readings off a family member's monitor; those were replaced with deterministic
fake numbers before this repo went public, keeping every correct/wrong/abstain outcome exactly
as it scored against the real ones so the statistics below still hold.

## How the harness scores

`scripts/eval.ts` scores field by field, not image by image. Each of SYS, DIA and pulse lands
in one of three buckets.

- **Correct.** Matched the label.
- **Wrong.** Returned a number that disagrees with the label. These are the real errors.
- **Abstained.** Returned null where the label has a value. Safe. The reading goes to the
  review queue and someone checks the photo.

Three buckets instead of two, because a null isn't a failure. The model is told to return
null when it isn't sure, so counting abstentions as errors would punish it for doing the
right thing.

The headline number is **precision over answered fields**: correct divided by correct plus
wrong. Abstentions are left out of the denominator. The question it answers is "when this
thing gives you a number, how often is it right", which is what matters for a document going
to a doctor.

There's also a per-condition breakdown, since the failure modes aren't evenly spread. Blur,
glare, dark, partial, rotated, tilted, colorcast and clean.

## The confident-wrong gate

The harness has one pass/fail check. A **confident-wrong** is a wrong value on a row that
production would have saved without flagging.

That's the failure the whole design exists to prevent. A wrong number that reaches the
doctor's table with nothing marking it as suspect.

This used to be measured against constants that only existed in the harness. It flagged rows
at confidence below 0.75 and called a wrong answer confident at 0.8 or above. Production
flags at `REVIEW_THRESHOLD`, which is 0.95, and also flags any row with a null field or a
failed validation check.

Those numbers being different made the harness output misleading. Because 0.75 is lower than
0.95, the harness flagged **fewer** rows than production would, so its review-queue figures
undercounted what the running system actually catches.

The harness now calls `needsReview()` from `lib/ocr.ts` directly. Flagged means what it means
in production, and the two can't drift apart again.

## Two more test sets that try to break it

**Negatives.** Ten photos that aren't blood pressure monitors: people, food, a shop shelf, a
chat screenshot, a receipt. The run passes only if all ten come back with `is_bp_display`
false and no invented numbers. A single leaked number fails it.

**Synthetic occlusion.** Five real monitor photos with specific digits covered up. The labels
for the covered fields are deliberately blank. The run passes only if the model returns null
for exactly those fields. This measures hallucination directly. Everything else in the
harness measures accuracy, which is a different thing.

## The prefilter harness

`scripts/prefilter-test.ts` grades the two prefilter stages against the same labelled set.

Its standard is deliberately lopsided. A false negative is a real photo thrown away and fails
the run. A false positive is reported as cost, not as an error.

Note the denominator. It counts as positives everything that isn't in the negative split.
That's 25 dev plus 20 held out plus 5 synthetic, so **50**, not 45. The five synthetic images
are real monitor photos with regions painted over, so they belong in the positive set. The
prefilter should pass them.

`--stage1` runs only the free pixel checks and makes no API calls.

## The labelled set

60 images in `eval/labels.csv`.

| Split | n | What it is |
|---|---|---|
| `dev` | 25 | tuning |
| `test` | 20 | held out |
| `synthetic` | 5 | digits covered, 8 fields total, all must come back null |
| `negative` | 10 | not monitors, all must be rejected |

Condition tags across all 60: blur 28, dark 17, glare 17, partial 13, colorcast 8, rotated 5,
tilted 4, clean 4.

Rotation labels: 0 on 55 images, 90 on two, 270 on three. There are no 180-degree images in
the set, even though the pipeline tries a 180 candidate on every rotated photo.

`eval/samples/` is gitignored. They're real photos of a family member's medical device. The
harness can't be re-run from a clone, and `eval/results/` is the record.

## Results

### Accuracy

Figures below are ranges across repeat runs at the current settings, not a single measurement
— see the note at the top of this document.

| | dev | held out |
|---|---|---|
| Images | 25 | 20 |
| Fields scored | 75 | 60 |
| Correct | 76.0-81.3% | 78.3-83.3% |
| Wrong | 4.0-6.7% | 1.7-6.7% |
| Abstained | 12.0-18.7% | 15.0% |
| **Precision** | **92.4-95.2%** | **92.2-98.0%** |
| Confident-wrong | 0, pass, every run | 0, pass, every run |
| Review queue | 21 of 25 flagged | 18-19 of 20 flagged |

### By condition, held out

From one representative run — condition-level counts weren't tracked across repeat runs the
way the split-level totals above were, so treat this breakdown as illustrative rather than a
tight range.

| Condition | Correct | Wrong | Abstained | Correct % |
|---|---|---|---|---|
| clean | 6 | 0 | 0 | 100.0 |
| colorcast | 10 | 0 | 2 | 83.3 |
| rotated | 7 | 0 | 2 | 77.8 |
| glare | 20 | 2 | 5 | 74.1 |
| blur | 26 | 1 | 9 | 72.2 |
| dark | 17 | 0 | 7 | 70.8 |
| partial | 8 | 0 | 4 | 66.7 |
| tilted | 2 | 1 | 0 | 66.7 |

Clean photos are perfect. Glare is where the wrong answers cluster. Dark and partial photos
mostly produce abstentions, which is the behaviour you want.

Rotated photos scored 7 correct and 0 wrong here. The read-every-rotation approach appears to
be doing its job, though 9 fields across 2 images is too small to lean on.

### The other test sets

- Negatives: 10 of 10 rejected. Pass.
- Synthetic occlusion: 8 of 8 covered fields returned null. Pass.
- Prefilter: 50 of 50 monitor photos passed, no lost readings. 10 of 10 non-monitor photos
  blocked before the expensive read.

## img_028: the failure that wasn't

An earlier version of this document treated one held-out image as the project's single
confident-wrong result — a high-confidence field that disagreed with my hand-typed label,
reproducibly, run after run. It drove a recommendation below to raise `REVIEW_THRESHOLD`.

It was wrong, and not the model's fault. When I went back to the source photo, the digit was
exactly what the model said. My hand label was the mistake — one keystroke, made once,
typed off the same photo in an afternoon of labelling 60 images by hand. I fixed the label; the
model had been right the whole time.

So: across every run recorded in `eval/results/`, at every threshold tested, **there has never
been an actual confident-wrong** — a wrong field that production would have saved without
flagging. Every wrong field observed sat at 0.7 confidence or below, comfortably inside the
review queue regardless of where the threshold sits.

### Why `REVIEW_THRESHOLD` is 0.95 anyway

Not because of img_028. Rotated images that agree across candidates get their confidence
capped at exactly 0.9 (`lib/ocr.ts:194`). The old threshold, also 0.9, compared with a strict
`<`, so `0.9 < 0.9` is false — a rotated, self-consistent reading could land exactly on the
line and never get flagged. That's a real gap, independent of any single mislabeled example.

| Threshold | Held-out images flagged | Confident-wrong |
|---|---|---|
| 0.90 | 14 of 20 | 0 |
| 0.93 | 18-19 of 20 | 0 |
| 0.95 (current) | 18-19 of 20 | 0 |

0.90 already catches every wrong field in this set — the jump at 0.93 is almost entirely those
capped-at-0.9 rotated images crossing the line, not anything closing a real miss. 0.95 is the
cautious choice, not the necessary one: one run of twenty images isn't enough to lean on a
looser threshold once there's headroom to spare.

### The caveat that comes with it

20-25 images per split is a small set, and runs aren't deterministic even at pinned
temperature — one field flipping between runs moves precision by roughly a point. Confidence
values also cluster hard around a short list of round numbers (0.5, 0.6, 0.9, 0.95) rather than
behaving like a calibrated probability, and confidence separates right from wrong only weakly:
correct reads and wrong reads both show up at every confidence level in the queue. Most of what
lands in review isn't a mistake — it's abstentions that need a human anyway, rotated images
capped by rule, and correct reads the model wasn't fully sure of. Treat every number on this
page as a direction, not a precise measurement.
