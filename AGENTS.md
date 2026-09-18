<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Where things are documented

- `docs/decisions.md` — why the code is shaped this way. Check for a "Superseded" note before
  following any decision.
- `docs/evaluation.md` — OCR accuracy, eval sets, threshold history.
- `docs/incidents.md` — production failures. Read before touching notification or quota code.
- `CHANGELOG.md` — what changed and when. Update it in the same PR as the change.
- Tag `v1.0` is the state the published article describes. Do not edit history before it.

## Rules

- Every send has a cost. Pushes count against 300/month per recipient, replies are free.
  Never add a push without checking the budget in `docs/decisions.md`.
- Update the matching `decisions.md` entry in the same commit as the behaviour change.