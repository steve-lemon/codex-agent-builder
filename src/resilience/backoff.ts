// Resilience utilities for timeout, retry, and circuit breaking.
export function computeBackoffMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
