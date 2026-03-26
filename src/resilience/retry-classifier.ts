// Resilience utilities for timeout, retry, and circuit breaking.
import { AgentError } from '../errors/agent-error';

/** Heuristically classifies whether an error should be retried. */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const transient =
    error instanceof AgentError
      ? error.transient
      : (error as Error & { transient?: boolean }).transient;
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
