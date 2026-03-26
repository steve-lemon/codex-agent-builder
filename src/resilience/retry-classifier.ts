// Resilience utilities for timeout, retry, and circuit breaking.
/** Heuristically classifies whether an error should be retried. */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const transient = (error as { transient?: boolean }).transient;
  if (transient) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('network') ||
    message.includes('rate limit')
  );
}
