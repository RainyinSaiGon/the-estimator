const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

/** Exponential retry delay, capped so a damaged object does not stall forever. */
export function r2CleanupRetryDelayMs(attempt: number) {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
  return Math.min(60_000 * 2 ** Math.min(normalizedAttempt, 11), MAX_RETRY_DELAY_MS);
}
