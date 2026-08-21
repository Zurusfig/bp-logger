import { sessionFromRequest } from "@/lib/auth";
import { getDb, signedImageUrl } from "@/lib/db";

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