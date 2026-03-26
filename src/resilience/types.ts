// Resilience utilities for timeout, retry, and circuit breaking.
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  coolDownMs: number;
}
