const DAY_MS = 24 * 60 * 60 * 1000;

// Non-persisted artifacts are discarded DEFAULT_TTL_SECONDS (90 days) after
// their last write - see apps/app/src/store.ts. Warning for the whole 90 days
// would just be noise, so the row stays quiet until the discard is close
// enough to be worth acting on.
const WARN_WITHIN_DAYS = 30;

/**
 * Label for an artifact row's discard warning, or null when there is nothing
 * to warn about: persisted, no expiry recorded, or still further out than
 * WARN_WITHIN_DAYS.
 */
export function expiryWarning(
  artifact: { persist: boolean; expiresAt?: string },
  now: number = Date.now()
): string | null {
  if (artifact.persist || !artifact.expiresAt) return null;
  const at = new Date(artifact.expiresAt).getTime();
  if (Number.isNaN(at)) return null;

  const days = Math.ceil((at - now) / DAY_MS);
  if (days > WARN_WITHIN_DAYS) return null;

  const date = new Date(at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  // Within a day (or already past), "あと1日" would print alongside today's
  // own date and read as a contradiction - say it plainly instead.
  return days <= 1 ? `まもなく廃棄 (${date})` : `あと${days}日で廃棄 (${date})`;
}
