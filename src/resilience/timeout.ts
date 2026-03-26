// Resilience utilities for timeout, retry, and circuit breaking.
import { AgentError } from '../errors/agent-error';

/** Rejects an async operation when it exceeds the allowed execution time. */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new AgentError(`Operation timed out after ${timeoutMs}ms`, {
        transient: true
      });
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
