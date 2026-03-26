// Resilience utilities for timeout, retry, and circuit breaking.
import type { CircuitBreakerOptions } from './types';

type CircuitState = 'closed' | 'open';

interface Entry {
  state: CircuitState;
  failures: number;
  openedAt?: number;
}

export class CircuitBreaker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: CircuitBreakerOptions) {}

  canExecute(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.state === 'closed') {
      return true;
    }

    const now = Date.now();
    if (entry.openedAt && now - entry.openedAt >= this.options.coolDownMs) {
      this.entries.set(key, { state: 'closed', failures: 0 });
      return true;
    }

    return false;
  }

  onSuccess(key: string): void {
    this.entries.set(key, { state: 'closed', failures: 0 });
  }

  onFailure(key: string): void {
    const current = this.entries.get(key) ?? { state: 'closed' as const, failures: 0 };
    const failures = current.failures + 1;
    if (failures >= this.options.failureThreshold) {
      this.entries.set(key, { state: 'open', failures, openedAt: Date.now() });
      return;
    }

    this.entries.set(key, { state: 'closed', failures });
  }

  getState(key: string): CircuitState {
    return this.entries.get(key)?.state ?? 'closed';
  }
}
