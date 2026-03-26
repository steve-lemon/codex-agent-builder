// Structured tracing types and tracer implementation.
import type { TraceEvent } from './types';
import { now } from '../time/now';

/** Collects structured trace events in memory for inspection and tests. */
export class AgentTracer {
  private readonly events: TraceEvent[] = [];

  log(runId: string, type: string, data?: Record<string, unknown>): void {
    this.events.push({
      ts: now(),
      runId,
      type,
      data
    });
  }

  getEvents(runId?: string): TraceEvent[] {
    if (!runId) {
      return [...this.events];
    }
    return this.events.filter((e) => e.runId === runId);
  }

  clear(): void {
    this.events.length = 0;
  }
}
