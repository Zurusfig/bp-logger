import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { readDisplayCorrected, type Reading } from "../lib/ocr";

const SPLIT = process.argv[2] ?? "dev"; // dev | test | synthetic | negative
const LIMIT = Number(process.argv[3] ?? 0); // 0 = all; use a small number while tuning
const CONCURRENCY = 4;
const CONFIDENT = 0.8; // a WRONG answer at or above this is a confident-wrong
const FIELDS = ["sys", "dia", "pulse"] as const;

type Row = Record<string, string>;
type Result = { row: Row; pred: Reading | null; error?: string };

const num = (v: string) => (v === undefined || v.trim() === "" ? null : Number(v));
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "—");

const rows: Row[] = parse(fs.readFileSync("eval/labels.csv"), {
  columns: true,
  skip_empty_lines: true,
});
let set = rows.filter((r) => r.split === SPLIT);
if (LIMIT > 0) set = set.slice(0, LIMIT);

if (set.length === 0) {
  console.error(`no rows with split="${SPLIT}"`);
  process.exit(1);
}

async function run(): Promise<Result[]> {
  const out: Result[] = [];
  for (let i = 0; i < set.length; i += CONCURRENCY) {
    const batch = set.slice(i, i + CONCURRENCY);
    const done = await Promise.all(
      batch.map(async (row): Promise<Result> => {
        const file = path.join("eval/samples", row.filename);
        try {
          return { row, pred: await readDisplayCorrected(fs.readFileSync(file)) };
        } catch (e: any) {
          return { row, pred: null, error: e.message };
        }
      })
    );
    out.push(...done);
    process.stdout.write(".".repeat(batch.length));
  }
  console.log("\n");
  return out;
}

function reportNegative(results: Result[]) {
  const leaks: string[] = [];
  let rejected = 0;

  for (const { row, pred, error } of results) {
    if (error || !pred) {
      leaks.push(`${row.filename}  ERROR  ${error}`);
      continue;
    }
    const invented = [pred.sys, pred.dia, pred.pulse].some((v) => v !== null);
    if (!pred.is_bp_display && !invented) rejected++;
    else
      leaks.push(
        `${row.filename}  [${row.note ?? ""}]  is_bp=${pred.is_bp_display}  ` +
          `${pred.sys}/${pred.dia}/${pred.pulse}  conf=${pred.confidence}`
      );
  }

  const pass = rejected === results.length;
  console.log(
    `negatives correctly rejected  ${rejected}/${results.length}  ${pass ? "PASS" : "FAIL"}`
  );
  if (leaks.length) console.log(`\nleaks:\n${leaks.join("\n")}`);
}

function reportSynthetic(results: Result[]) {
  let checked = 0;
  let held = 0;
  const bad: string[] = [];

  for (const { row, pred, error } of results) {
    if (error || !pred) {
      bad.push(`${row.filename}  ERROR  ${error}`);
      continue;
    }
    for (const f of FIELDS) {
      if (num(row[f]) !== null) continue; // only the occluded fields matter here
      checked++;
      if (pred[f] === null) held++;
      else
        bad.push(
          `${row.filename}  ${f}  should be null  got ${pred[f]}  ` +
            `conf=${pred.confidence}  [${row.note ?? ""}]`
        );
    }
  }

  const pass = held === checked && bad.length === 0;
  console.log(`occluded fields returned null  ${held}/${checked}  ${pass ? "PASS" : "FAIL"}`);
  if (bad.length) console.log(`\nhallucinated:\n${bad.join("\n")}`);
}

/**
 * Three buckets, because a null is not a failure:
 *   CORRECT  - matched the label
 *   WRONG    - returned a number that disagrees with the label  <- the real errors
 *   ABSTAIN  - returned null where the label has a value        <- safe, goes to review
 */
function reportAccuracy(results: Result[]) {
  let correct = 0,
    wrong = 0,
    abstain = 0,
    total = 0,
    confidentWrong = 0;
  const wrongs: string[] = [];
  const abstains: string[] = [];
  const errors: string[] = [];
  const byTag: Record<string, [number, number, number]> = {}; // correct, wrong, abstain
  let reviewFlagged = 0,
    reviewCaughtWrong = 0,
    imagesWithWrong = 0;

  for (const { row, pred, error } of results) {
    if (error || !pred) {
      errors.push(`${row.filename}  ERROR  ${error}`);
      continue;
    }
    const tags = (row.conditions ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (!pred.is_bp_display) errors.push(`${row.filename}  rejected as non-BP  [${tags}]`);

    const flagged = pred.confidence < 0.75;
    if (flagged) reviewFlagged++;
    let hadWrong = false;

    for (const f of FIELDS) {
      const exp = num(row[f]);
      const got = pred[f];
      total++;
      for (const t of tags) byTag[t] ??= [0, 0, 0];

      if (exp === got) {
        correct++;
        for (const t of tags) byTag[t][0]++;
      } else if (got === null) {
        abstain++;
        for (const t of tags) byTag[t][2]++;
        abstains.push(
          `${row.filename}  ${f}  expected ${exp}  conf=${pred.confidence}  [${tags}]`
        );
      } else {
        wrong++;
        hadWrong = true;
        for (const t of tags) byTag[t][1]++;
        wrongs.push(
          `${row.filename}  ${f}  expected ${exp ?? "null"}  got ${got}  ` +
            `conf=${pred.confidence}  rot=${pred.orientation_deg}  [${tags}]`
        );
        if (pred.confidence >= CONFIDENT) confidentWrong++;
      }
    }
    if (hadWrong) imagesWithWrong++;
    if (hadWrong && flagged) reviewCaughtWrong++;
  }

  console.log(`split: ${SPLIT}   images: ${results.length}   fields: ${total}\n`);
  console.log(`  CORRECT   ${String(correct).padStart(3)}   ${pct(correct, total)}%`);
  console.log(`  WRONG     ${String(wrong).padStart(3)}   ${pct(wrong, total)}%   <- real errors`);
  console.log(
    `  ABSTAIN   ${String(abstain).padStart(3)}   ${pct(abstain, total)}%   <- safe, needs review`
  );
  console.log(`\n  precision (correct of answered)  ${pct(correct, correct + wrong)}%`);

  console.log(`\nby condition        correct  wrong  abstain`);
  for (const [t, [c, w, a]] of Object.entries(byTag).sort()) {
    console.log(
      `  ${t.padEnd(12)} ${String(c).padStart(6)} ${String(w).padStart(6)} ${String(a).padStart(8)}    ${pct(c, c + w + a)}%`
    );
  }

  console.log(`\nCONFIDENT-WRONG  ${confidentWrong}   ${confidentWrong === 0 ? "PASS" : "FAIL"}`);
  console.log(
    `review queue: ${reviewFlagged}/${results.length} flagged, caught ${reviewCaughtWrong}/${imagesWithWrong} images containing a wrong field`
  );

  if (wrongs.length) console.log(`\nWRONG:\n${wrongs.join("\n")}`);
  if (abstains.length) console.log(`\nABSTAIN:\n${abstains.join("\n")}`);
  if (errors.length) console.log(`\nERRORS:\n${errors.join("\n")}`);
}

(async () => {
  const results = await run();
  if (SPLIT === "negative") reportNegative(results);
  else if (SPLIT === "synthetic") reportSynthetic(results);
  else reportAccuracy(results);
})();