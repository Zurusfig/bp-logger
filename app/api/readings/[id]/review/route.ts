import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/readings/[id]/review
 *
 * A human compared the numbers against the original photo and confirmed them.
 * Only clears the flag — it never changes values. Editing lands in M5.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: row } = await getDb()
    .from("readings")
    .select("sys,dia,pulse")
    .eq("id", id)
    .eq("group_id", session.groupId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  // Confirming an incomplete reading would hide it from the queue while it is still
  // missing a value, so refuse until every field has a number.
  if (row.sys === null || row.dia === null || row.pulse === null) {
    return Response.json({ error: "reading is incomplete" }, { status: 400 });
  }

  const { error } = await getDb()
    .from("readings")
    .update({
      needs_review: false,
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", session.groupId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}