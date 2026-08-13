import { verifySignature } from "@/lib/line";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text(); // raw string — must hash exactly what LINE sent
  const sig = req.headers.get("x-line-signature");

  if (!verifySignature(body, sig)) {
    console.warn("bad signature");
    return new Response("unauthorized", { status: 401 });
  }

  const { events } = JSON.parse(body);

  for (const e of events) {
    console.log(JSON.stringify({
      type: e.type,
      msgType: e.message?.type,
      sourceType: e.source?.type,
      groupId: e.source?.groupId,
      userId: e.source?.userId,
      messageId: e.message?.id,
      timestamp: e.timestamp,
    }));
  }

  return new Response(null, { status: 200 });
}