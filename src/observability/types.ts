// Structured tracing types and tracer implementation.
/** Single structured event emitted during runtime execution. */
export interface TraceEvent {
    traceId: string;
    seq: number;
    ts: number;
    type: string;
    stage: string;
    message: string;
    runId: string;
    data?: Record<string, unknown>;
}

/** JSON-compatible trace payload flushed to external storage. */
export interface TraceDocument {
    traceId: string;
    runId: string;
    flushedAt: number;
    events: TraceEvent[];
}

/** WebSocket-like connection contract for real-time trace delivery. */
export interface TraceConnection {
    send(payload: string): void;
}

/** External storage abstraction for persisted traces. */
export interface TraceStore {
    save(document: TraceDocument): Promise<string>;
}
