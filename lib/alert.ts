export type AlertLevel = "info" | "warning" | "error";

/**
 * The only channel-independent way to reach the admin. The 2026-09 outage was
 * the LINE messaging channel itself failing, so an alert sent over LINE would
 * have failed with it (docs/incidents.md). Discord instead: no monthly cap,
 * and it's on the admin's phone.
 *
 * Never throws — an alert that fails must not take down whatever it was
 * warning about.
 */
export async function alert(level: AlertLevel, message: string): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.error("alert (DISCORD_WEBHOOK_URL not set)", { level, message });
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**[${level}]** ${message}` }),
    });
    if (!res.ok) {
      console.error("alert post failed", { status: res.status, level, message });
    }
  } catch (err) {
    console.error("alert post failed", { err: String(err), level, message });
  }
}
