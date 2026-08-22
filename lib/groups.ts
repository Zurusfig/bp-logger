/**
 * ALLOWED_GROUP_ID can list more than one household as a comma-separated string,
 * e.g. a test group alongside the real family group. Each listed group is still a
 * fully separate household — this only gates which groups the bot will talk to,
 * it never merges their data. Empty or unset means "accept any group", the
 * self-hosted default.
 */
export function isAllowedGroup(groupId?: string): boolean {
  const raw = process.env.ALLOWED_GROUP_ID;
  if (!raw) return true;

  const allowed = raw
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;

  return groupId !== undefined && allowed.includes(groupId);
}
