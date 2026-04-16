// Unified event bus that merges runtime trace events and flow design events into one timeline.
import type { FlowDesignConnection, FlowDesignEvent } from '../flow/design-monitor';
import type { TraceConnection, TraceEvent } from './types';

/** Source marker used to distinguish runtime trace events from design events. */
export type UnifiedRunEventSource = 'trace' | 'flow-design';

/** One merged timeline event emitted to external observers. */
export interface UnifiedRunEvent {
    runId: string;
    seq: number;
    ts: number;
    source: UnifiedRunEventSource;
    type: string;
    message: string;
    stage?: string;
    traceId?: string;
    sessionId?: string;
    data?: Record<string, unknown>;
    payload: TraceEvent | FlowDesignEvent;

    // TODO(monitoring): Add a normalized visual payload here so mixed trace and
    // design consumers can render one timeline without branching on `source`.
}

/** Connection contract for consumers of the merged run timeline. */
export interface UnifiedRunEventConnection {
    send(event: UnifiedRunEvent): void;
    close?(): void | Promise<void>;
}

/** WebSocket-style transport abstraction for serialized merged timeline events. */
export interface UnifiedRunEventTransport {
    send(payload: string): void | Promise<void>;
    close?(): void | Promise<void>;
}

/** Configuration for the serialized merged timeline connection. */
export interface WebSocketUnifiedRunEventConnectionConfig {
    serializer?: (event: UnifiedRunEvent) => string;
}

const DEFAULT_CONFIG: WebSocketUnifiedRunEventConnectionConfig = {
    serializer: event => JSON.stringify(event),
};

/** Simple callback-based sink for merged run timeline events. */
export class CallbackUnifiedRunEventConnection implements UnifiedRunEventConnection {
    constructor(private readonly callback: (event: UnifiedRunEvent) => void) {}

    send(event: UnifiedRunEvent): void {
        this.callback(event);
    }
}

/** WebSocket-oriented sink for merged run timeline events. */
export class WebSocketUnifiedRunEventConnection implements UnifiedRunEventConnection {
    private readonly config: WebSocketUnifiedRunEventConnectionConfig;

    constructor(
        private readonly transport: UnifiedRunEventTransport,
        config: Partial<WebSocketUnifiedRunEventConnectionConfig> = {},
    ) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
        };
    }

    send(event: UnifiedRunEvent): void {
        void this.transport.send(this.config.serializer!(event));
    }

    close(): void {
        void this.transport.close?.();
    }
}

/** Bridges trace and flow-design streams into one ordered run timeline. */
export class UnifiedRunEventBus {
    private seq = 0;

    constructor(private readonly runId: string, private readonly connection: UnifiedRunEventConnection) {}

    asTraceConnection(): TraceConnection {
        return {
            send: event => {
                // TODO(monitoring): Allow per-source backpressure policies so a
                // burst of design events does not starve critical trace events.
                this.connection.send({
                    runId: event.runId,
                    seq: this.nextSeq(),
                    ts: event.ts,
                    source: 'trace',
                    type: event.type,
                    message: event.message,
                    stage: event.stage,
                    traceId: event.traceId,
                    data: event.data,
                    payload: event,
                });
            },
        };
    }

    asFlowDesignConnection(): FlowDesignConnection {
        return {
            send: event => {
                // TODO(monitoring): Attach run-step correlation ids here once
                // design events need to map back to specific planner steps.
                this.connection.send({
                    runId: this.runId,
                    seq: this.nextSeq(),
                    ts: event.ts,
                    source: 'flow-design',
                    type: event.type,
                    message: event.message,
                    sessionId: event.sessionId,
                    data: event.data,
                    payload: event,
                });
            },
        };
    }

    close(): void {
        void this.connection.close?.();
    }

    private nextSeq(): number {
        this.seq += 1;
        return this.seq;
    }
}
