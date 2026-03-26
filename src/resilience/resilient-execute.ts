// Resilience utilities for timeout, retry, and circuit breaking.
import { computeBackoffMs, sleep } from './backoff';
import { isRetryableError } from './retry-classifier';
import { withTimeout } from './timeout';
import type { RetryOptions } from './types';
import type { CircuitBreaker } from './circuit-breaker';
import { AgentError } from '../errors/agent-error';

/** Applies timeout, retry, and circuit breaker behavior to an async execution. */
export async function resilientExecute<T>(params: {
    key: string;
    execute: () => Promise<T>;
    timeoutMs: number;
    retry: RetryOptions;
    circuitBreaker?: CircuitBreaker;
    enableCircuitBreaker: boolean;
}): Promise<T> {
    const { key, execute, timeoutMs, retry, circuitBreaker, enableCircuitBreaker } = params;

    if (enableCircuitBreaker && circuitBreaker && !circuitBreaker.canExecute(key)) {
        throw new AgentError(`Circuit breaker is open for ${key}`);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
        try {
            const result = await withTimeout(execute(), timeoutMs);
            if (enableCircuitBreaker && circuitBreaker) {
                circuitBreaker.onSuccess(key);
            }
            return result;
        } catch (error) {
            lastError = AgentError.from(error);
            if (enableCircuitBreaker && circuitBreaker) {
                circuitBreaker.onFailure(key);
            }

            const canRetry = attempt < retry.maxAttempts && isRetryableError(lastError);
            if (!canRetry) {
                break;
            }

            await sleep(computeBackoffMs(attempt, retry.baseDelayMs));
        }
    }

    throw AgentError.from(lastError);
}
