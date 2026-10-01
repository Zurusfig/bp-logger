import type Anthropic from "@anthropic-ai/sdk";
import { getDb } from "./db";
import { alert } from "./alert";
import { localParts } from "./slot";

/**
 * USD per million tokens, matched by model ID prefix so dated IDs such as
 * claude-haiku-4-5-20251001 resolve. Cache writes are 1.25x input (5-minute
 * TTL) and cache reads 0.1x input. Nothing here uses caching yet, but the
 * response reports those fields, so they're priced rather than dropped.
 */
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: "claude-sonnet-4-6", input: 3, output: 15 },
  { prefix: "claude-haiku-4-5", input: 1, output: 5 },
];

const TZ = "Asia/Bangkok";

/** Today more than this many times the 7-day average, and over SPIKE_FLOOR, warns. */
const SPIKE_FACTOR = 3;
const SPIKE_FLOOR = 0.5;

export type UsageRow = {
  day: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
};

/**
 * Adds one Claude call's token counts to today's row (docs/decisions.md,
 * "Anthropic spend is counted locally"). Never throws: accounting must never
 * block a reading, same as bumpUsage().
 */
export async function recordUsage(model: string, usage: Anthropic.Usage): Promise<void> {
  try {
    const { error } = await getDb().rpc("record_anthropic_usage", {
      p_model: model,
      p_input: usage.input_tokens,
      p_output: usage.output_tokens,
      p_cache_write: usage.cache_creation_input_tokens ?? 0,
      p_cache_read: usage.cache_read_input_tokens ?? 0,
    });
    if (error) console.error("record usage failed", { model, err: error.message });
  } catch (err) {
    console.error("record usage failed", { model, err: String(err) });
  }
}

/** USD for one row, or null when the model isn't in PRICES. */
export function costOf(row: UsageRow): number | null {
  const p = PRICES.find((x) => row.model.startsWith(x.prefix));
  if (!p) return null;
  const perToken = (rate: number) => rate / 1_000_000;
  return (
    row.input_tokens * perToken(p.input) +
    row.cache_write_tokens * perToken(p.input * 1.25) +
    row.cache_read_tokens * perToken(p.input * 0.1) +
    row.output_tokens * perToken(p.output)
  );
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type SpendResult =
  | { today: number; month: number; avg7: number; calls: number; unpriced: string[] }
  | { skipped: "error" };

/**
 * The daily spend message, posted to Discord by the 22:00 cron. Today and this
 * month are Bangkok calendar days; the 7-day average covers the seven days
 * before today, so a quiet today doesn't drag it down. A model missing from
 * PRICES counts as $0 and is named in the message, so a model change shows up
 * instead of quietly reading low.
 *
 * Reads the table directly; only writes go through record_anthropic_usage().
 */
export async function reportSpend(): Promise<SpendResult> {
  const today = localParts(new Date(), TZ).date;
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStart = shiftDay(today, -7);
  const from = monthStart < weekStart ? monthStart : weekStart;

  const { data, error } = await getDb()
    .from("anthropic_usage")
    .select("day,model,calls,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens")
    .gte("day", from)
    .lte("day", today);

  if (error) {
    await alert("error", `spend report failed: ${error.message}`);
    return { skipped: "error" };
  }

  const rows = (data ?? []) as UsageRow[];
  let todayUsd = 0;
  let monthUsd = 0;
  let weekUsd = 0;
  let calls = 0;
  const unpriced = new Set<string>();

  for (const row of rows) {
    const cost = costOf(row);
    if (cost === null) unpriced.add(row.model);
    const usd = cost ?? 0;
    if (row.day === today) {
      todayUsd += usd;
      calls += row.calls;
    }
    if (row.day >= monthStart) monthUsd += usd;
    if (row.day >= weekStart && row.day < today) weekUsd += usd;
  }

  const avg7 = weekUsd / 7;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const lines = [
    "Anthropic spend (estimate from bp-logger's own calls)",
    `Today: ${usd(todayUsd)} · ${calls} calls`,
    `This month: ${usd(monthUsd)} · 7-day avg ${usd(avg7)}/day`,
    "Remaining balance: Console → Settings → Billing",
  ];
  if (unpriced.size > 0) {
    lines.push(`Not priced, counted as $0: ${[...unpriced].join(", ")} (lib/spend.ts)`);
  }

  const spike = todayUsd > SPIKE_FLOOR && todayUsd > avg7 * SPIKE_FACTOR;
  if (spike) lines.push(`Today is over ${SPIKE_FACTOR}x the 7-day average.`);

  await alert(spike || unpriced.size > 0 ? "warning" : "info", lines.join("\n"));

  return { today: todayUsd, month: monthUsd, avg7, calls, unpriced: [...unpriced] };
}
