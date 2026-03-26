// Resilience utilities for timeout, retry, and circuit breaking.
/** Retry configuration applied by the resilience wrapper. */
export interface RetryOptions {
    maxAttempts: number;
    baseDelayMs: number;
}

/** Thresholds that control when a circuit breaker opens and resets. */
export interface CircuitBreakerOptions {
    failureThreshold: number;
    coolDownMs: number;
}
