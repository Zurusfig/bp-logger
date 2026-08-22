import { sessionFromRequest } from "@/lib/auth";
import { getDb, signedImageUrl } from "@/lib/db";
import { deriveSlot } from "@/lib/slot";

export const runtime = "nodejs";

/** GET /api/readings/[id] — one row plus a short-lived signed URL for its photo. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data, error } = await getDb()
    .from("readings")
    .select("*")
    .eq("id", id)
    .eq("group_id", session.groupId) // scoping, not just filtering: another household must 404
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({
    ...data,
    image_url: data.image_path ? await signedImageUrl(data.image_path, 600) : null,
  });
}


const RANGES: Record<string, [number, number]> = {
  sys: [60, 260],
  dia: [30, 160],
  pulse: [30, 180],
};

type Body = {
  sys?: number | null;
  dia?: number | null;
  pulse?: number | null;
  taken_at?: string;
  slot?: string;
};

/**
 * PATCH /api/readings/[id]
 *
 * Any row is editable, confirmed or not: a confidently wrong reading looks settled
 * and still needs correcting. A human edit is more trustworthy than the OCR that
 * produced the value, so editing clears needs_review rather than re-raising it, and
 * edited_by is recorded so the change is visible in the table.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json()) as Body;

  const { data: current } = await getDb()
    .from("readings")
    .select("sys,dia,pulse,taken_at,slot")
    .eq("id", id)
    .eq("group_id", session.groupId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!current) return Response.json({ error: "not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};

  for (const f of ["sys", "dia", "pulse"] as const) {
    if (!(f in body)) continue;
    const v = body[f];
    if (v === null) {
      patch[f] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) {
      return Response.json({ error: `${f} must be a whole number` }, { status: 400 });
    }
    const [lo, hi] = RANGES[f];
    if (v < lo || v > hi) {
      return Response.json({ error: `${f} ต้องอยู่ระหว่าง ${lo} ถึง ${hi}` }, { status: 400 });
    }
    patch[f] = v;
  }

  const merged = { ...current, ...patch } as Record<string, number | null>;
  if (merged.sys != null && merged.dia != null) {
    if (merged.sys <= merged.dia) {
      return Response.json({ error: "SYS ต้องมากกว่า DIA" }, { status: 400 });
    }
  }

  // Changing the time can move a reading to a different day or slot, so both are
  // re-derived unless the caller set the slot explicitly.
  if (body.taken_at) {
    const t = new Date(body.taken_at);
    if (Number.isNaN(t.getTime())) {
      return Response.json({ error: "invalid taken_at" }, { status: 400 });
    }
    patch.taken_at = t.toISOString();
    const d = deriveSlot(t);
    patch.slot = body.slot ?? d.slot;
    patch.reading_date = d.reading_date;
  } else if (body.slot) {
    patch.slot = body.slot;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const now = new Date().toISOString();
  patch.edited_by = session.userId;
  patch.edited_at = now;

  const complete = merged.sys != null && merged.dia != null && merged.pulse != null;
  if (complete) {
    patch.needs_review = false;
    patch.reviewed_by = session.userId;
    patch.reviewed_at = now;
  }

  const { data, error } = await getDb()
    .from("readings")
    .update(patch)
    .eq("id", id)
    .eq("group_id", session.groupId)
    .select("id,sys,dia,pulse,taken_at,slot,reading_date,needs_review")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

/** FR-4.4: soft delete only. The row and its image are never destroyed. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const { error } = await getDb()
    .from("readings")
    .update({
      deleted_at: new Date().toISOString(),
      edited_by: session.userId,
      edited_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", session.groupId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}