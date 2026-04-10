// Structured tracing types and tracer implementation.
/** Single structured event emitted during runtime execution. */
export interface TraceEvent {
    traceId: string;
    seq: number;
    ts: number;
    type: string;
    stage: TraceStage;
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
    send(event: TraceEvent): void;
}

/** Serialized trace batch sent over an external streaming transport. */
export interface TraceBatchMessage {
    traceId: string;
    runId: string;
    sentAt: number;
    events: TraceEvent[];
}

/** Transport abstraction used by trace connections to emit serialized payloads. */
export interface TraceTransport {
    send(payload: string): void | Promise<void>;
    close?(): void | Promise<void>;
}

/** External storage abstraction for persisted traces. */
export interface TraceStore {
    save(document: TraceDocument): Promise<string>;
}

/** Stages for structured tracing. */
export type TraceStage =
    | 'run'
    | 'planner'
    | 'step'
    | 'tool'
    | 'approval'
    | 'reflector'
    | 'finalizer'
    | 'trace'
    | 'error'
    | 'runtime';

/** state of run condition */
export type RunStatus = 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';

/** approval-decistion-type */
export type ApprovalDecisionType = 'approve' | 'reject' | 'edit-and-approve';
