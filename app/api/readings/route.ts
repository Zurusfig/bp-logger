import { sessionFromRequest } from "@/lib/auth";
import { getDb, signedImageUrl } from "@/lib/db";

export const runtime = "nodejs";

export type ReadingDto = {
  id: string;
  taken_at: string;
    slot: string | null;
  reading_date: string | null;
  sys: number | null;
  dia: number | null;
  pulse: number | null;
  irregular_flag: boolean | null;
  needs_review: boolean;
  review_note: string | null;
  confidence: number | null;
  sender_id: string;
  source: string;
  has_image: boolean;
  image_url?: string | null;
};

/**
 * GET /api/readings?from=2026-07-01&to=2026-08-21&review=1
 *
 * Defaults to the last 30 days. Pass review=1 for the review queue only.
 * Image URLs are signed on demand and short-lived — the bucket stays private.
 */
export async function GET(req: Request) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const from =
    url.searchParams.get("from") ??
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const reviewOnly = url.searchParams.get("review") === "1";
  const withImages = url.searchParams.get("images") === "1";

  let q = getDb()
    .from("readings")
    .select(
      "id,taken_at,slot,reading_date,sys,dia,pulse,irregular_flag," +
        "needs_review,review_note,confidence,sender_id,source,image_path"
    )
    .eq("group_id", session.groupId)
    .is("deleted_at", null)
    .gte("reading_date", from)
    .lte("reading_date", to)
    .order("reading_date", { ascending: false })
    .order("taken_at", { ascending: true });

  if (reviewOnly) q = q.eq("needs_review", true);

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows: ReadingDto[] = await Promise.all(
    (data ?? []).map(async (r: any) => ({
      id: r.id,
      taken_at: r.taken_at,
      slot: r.slot,
      reading_date: r.reading_date,
      sys: r.sys,
      dia: r.dia,
      pulse: r.pulse,
      irregular_flag: r.irregular_flag,
      needs_review: r.needs_review,
      review_note: r.review_note,
      confidence: r.confidence,
      sender_id: r.sender_id,
      source: r.source,
      has_image: !!r.image_path,
      image_url: withImages && r.image_path ? await signedImageUrl(r.image_path) : null,
    }))
  );

  const { data: members } = await getDb()
    .from("members")
    .select("user_id,display_name")
    .eq("group_id", session.groupId);

  const { data: settings } = await getDb()
    .from("settings")
    .select("patient_name,last_visit_date,tz,slots")
    .eq("group_id", session.groupId)
    .maybeSingle();

  return Response.json({
    readings: rows,
    members: Object.fromEntries(
      (members ?? []).map((m: any) => [m.user_id, m.display_name ?? ""])
    ),
    settings: settings ?? null,
    range: { from, to },
    review_count: rows.filter((r) => r.needs_review).length,
  });
}