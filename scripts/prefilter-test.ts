import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { couldBeBpPhoto, isBpDisplay } from "../lib/prefilter";

/**
 * Grades the two prefilter stages against every labelled image.
 *
 * The only unacceptable outcome is a FALSE NEGATIVE: a real BP photo rejected, which
 * silently loses a reading. False positives merely cost a fraction of a cent.
 *
 * usage: npx tsx --env-file=.env.local scripts/prefilter-test.ts
 *        npx tsx --env-file=.env.local scripts/prefilter-test.ts --stage1   (free, no API)
 */

const STAGE1_ONLY = process.argv.includes("--stage1");

type Row = Record<string, string>;

const rows: Row[] = parse(fs.readFileSync("eval/labels.csv"), {
  columns: true,
  skip_empty_lines: true,
});

// Everything that is not a "negative" row is a genuine BP photo and MUST pass.
const positives = rows.filter((r) => r.split !== "negative");
const negatives = rows.filter((r) => r.split === "negative");

async function check(row: Row) {
  const buf = fs.readFileSync(path.join("eval/samples", row.filename));
  const s1 = await couldBeBpPhoto(buf);
  if (!s1) return { s1, s2: false };
  if (STAGE1_ONLY) return { s1, s2: true };
  return { s1, s2: await isBpDisplay(buf) };
}

(async () => {
  const falseNegatives: string[] = [];
  const stage1Drops: string[] = [];
  let passed = 0;

  for (const row of positives) {
    const { s1, s2 } = await check(row);
    if (s1 && s2) passed++;
    else {
      falseNegatives.push(
        `${row.filename}  stage1=${s1} stage2=${s2}  [${row.conditions ?? ""}]`
      );
      if (!s1) stage1Drops.push(row.filename);
    }
    process.stdout.write(".");
  }

  let blocked = 0;
  const leaks: string[] = [];
  for (const row of negatives) {
    const { s1, s2 } = await check(row);
    if (!s1 || !s2) blocked++;
    else leaks.push(`${row.filename}  [${row.note ?? ""}]`);
    process.stdout.write(".");
  }
  console.log("\n");

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "—");

  console.log(`mode: ${STAGE1_ONLY ? "stage 1 only (free)" : "stage 1 + stage 2 triage"}\n`);
  console.log(
    `BP photos passed        ${passed}/${positives.length}  ${pct(passed, positives.length)}%  ` +
      `${falseNegatives.length === 0 ? "PASS" : "FAIL — lost readings"}`
  );
  console.log(
    `non-BP photos blocked   ${blocked}/${negatives.length}  ${pct(blocked, negatives.length)}%  ` +
      `(savings, not a gate)`
  );

  if (falseNegatives.length) {
    console.log(`\nFALSE NEGATIVES — these would be silently lost:\n${falseNegatives.join("\n")}`);
    if (stage1Drops.length) {
      console.log(
        `\n${stage1Drops.length} dropped by the free stage — loosen couldBeBpPhoto() before shipping.`
      );
    }
  }

  if (leaks.length) {
    console.log(`\nreached the expensive pipeline (cost, not correctness):\n${leaks.join("\n")}`);
  }

  const savedPct = pct(blocked, negatives.length);
  console.log(
    `\nestimated cost avoided on non-BP images: ${savedPct}% of them never reach the full read`
  );
})();