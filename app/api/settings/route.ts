import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalise, type SlotDef } from "@/lib/slot";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await getDb()
    .from("settings")
    .select("patient_name,last_visit_date,tz,slots")
    .eq("group_id", session.groupId)
    .maybeSingle();

  return Response.json(data ?? {});
}

type Body = {
  patient_name?: string | null;
  last_visit_date?: string | null;
  slots?: SlotDef[];
};

export async function PATCH(req: Request) {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as Body;
  const patch: Record<string, unknown> = {};

  if ("patient_name" in body) patch.patient_name = body.patient_name || null;

  if ("last_visit_date" in body) {
    const v = body.last_visit_date;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return Response.json({ error: "invalid date" }, { status: 400 });
    }
    patch.last_visit_date = v || null;
  }

  if (body.slots) {
    if (!Array.isArray(body.slots) || body.slots.length === 0) {
      return Response.json({ error: "slots must be a non-empty list" }, { status: 400 });
    }
    for (const s of body.slots) {
      if (!/^[a-z_]{2,20}$/.test(s.key ?? "")) {
        return Response.json({ error: `bad slot key: ${s.key}` }, { status: 400 });
      }
      if (!/^\d{1,2}:\d{2}$/.test(s.from ?? "")) {
        return Response.json({ error: `bad time for ${s.key}` }, { status: 400 });
      }
    }
    // Stored sorted so every reader sees the same order.
    patch.slots = normalise(body.slots);
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await getDb()
    .from("settings")
    .update(patch)
    .eq("group_id", session.groupId)
    .select("patient_name,last_visit_date,tz,slots")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}