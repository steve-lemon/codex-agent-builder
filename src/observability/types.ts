// Structured tracing types and tracer implementation.
/** Single structured event emitted during runtime execution. */
export interface TraceEvent {
  ts: number;
  type: string;
  runId: string;
  data?: Record<string, unknown>;
}
