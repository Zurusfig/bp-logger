import fs from "fs";
import { readDisplayCorrected } from "../lib/ocr";

const file = process.argv[2];

if (!file) {
  console.error("usage: npx tsx --env-file=.env.local scripts/one.ts img_017.jpg");
  process.exit(1);
}

(async () => {
  const buf = fs.readFileSync(`eval/samples/${file}`);
  console.log(JSON.stringify(await readDisplayCorrected(buf), null, 2));
})();