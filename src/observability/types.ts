// Structured tracing types and tracer implementation.
export interface TraceEvent {
  ts: string;
  type: string;
  runId: string;
  data?: Record<string, unknown>;
}
