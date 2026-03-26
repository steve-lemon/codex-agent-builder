// Resilience utilities for timeout, retry, and circuit breaking.
/** Computes exponential delay growth between retry attempts. */
export function computeBackoffMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
}

/** Sleeps for the given number of milliseconds. */
export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
