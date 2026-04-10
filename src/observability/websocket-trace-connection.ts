// Buffered trace connection that emits trace batches over a WebSocket-like transport.
import { now } from '../time/now';
import type { TraceBatchMessage, TraceConnection, TraceEvent, TraceTransport } from './types';

/** Runtime-tunable batching configuration for trace streaming. */
export interface WebSocketTraceConnectionConfig {
    /**
     * Time window in milliseconds used to collect follow-up events after the first immediate send
     * - 첫 즉시 전송 이후 후속 event를 모으는 시간창
     */
    batchWindowMs: number;
    /**
     * Maximum number of events included in one outbound batch payload
     * - 한 번에 보내는 batch 내 event 최대 개수
     */
    maxBatchSize: number;
    /**
     * Maximum number of buffered events kept in memory before overflow handling is applied
     * - 메모리에 잠시 쌓아둘 수 있는 event 최대 개수
     */
    maxBufferedEvents: number;
    /**
     * Overflow behavior when buffered events exceed the configured limit: flush older events or drop new ones
     * - overflow 시 flush할지 drop할지 결정
     */
    overflowStrategy: 'flush' | 'drop';
    /**
     * Whether to emit a synthetic trace event that reports how many events were dropped due to overflow
     * - drop 발생 시 몇 개 버려졌는지 synthetic event를 보낼지 결정
     */
    emitDropNotice: boolean;
    /**
     * Optional custom serializer for converting a batch payload into the wire format expected by the transport
     * - transport가 기대하는 wire format으로 직렬화하는 커스텀 함수
     */
    serializer?: (message: TraceBatchMessage) => string;
}

const DEFAULT_CONFIG: WebSocketTraceConnectionConfig = {
    batchWindowMs: 500,
    maxBatchSize: 25,
    maxBufferedEvents: 100,
    overflowStrategy: 'flush',
    emitDropNotice: true,
    serializer: message => JSON.stringify(message),
};

/** TraceConnection implementation that sends the first event immediately and batches subsequent events briefly. */
export class WebSocketTraceConnection implements TraceConnection {
    private config: WebSocketTraceConnectionConfig;
    private buffer: TraceEvent[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private windowOpen = false;
    private droppedEvents = 0;

    constructor(private readonly transport: TraceTransport, config: Partial<WebSocketTraceConnectionConfig> = {}) {
        this.config = this.mergeConfig(config);
    }

    send(event: TraceEvent): void {
        if (!this.windowOpen) {
            this.windowOpen = true;
            this.emit([event]);
            this.startWindow();
            return;
        }

        if (this.buffer.length >= this.config.maxBufferedEvents) {
            this.handleOverflow(event);
            return;
        }

        this.buffer.push(event);

        if (this.buffer.length >= this.config.maxBatchSize) {
            this.flushBuffered();
            this.resetWindow();
        }
    }

    /** Applies new batching settings without dropping already buffered events. */
    updateConfig(config: Partial<WebSocketTraceConnectionConfig>): void {
        this.config = this.mergeConfig(config);

        if (this.windowOpen) {
            this.startWindow();
        }

        while (this.buffer.length > this.config.maxBufferedEvents) {
            this.handleOverflow();
        }
    }

    /** Immediately sends any buffered events. */
    flush(): void {
        this.flushBuffered();
        this.resetWindow(false);
    }

    /** Flushes buffered events and closes the underlying transport if supported. */
    close(): void {
        this.flush();
        void this.transport.close?.();
    }

    private flushBuffered(): void {
        this.emitDropNoticeIfNeeded();
        while (this.buffer.length > 0) {
            this.emit(this.buffer.splice(0, this.config.maxBatchSize));
        }
    }

    private startWindow(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }

        this.timer = setTimeout(() => {
            this.flushBuffered();
            this.resetWindow(false);
        }, this.config.batchWindowMs);
    }

    private resetWindow(clearBuffer = true): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.windowOpen = false;

        if (clearBuffer) {
            this.buffer = [];
        }
    }

    private handleOverflow(nextEvent?: TraceEvent): void {
        if (this.config.overflowStrategy === 'drop') {
            if (nextEvent) {
                this.droppedEvents += 1;
            } else if (this.buffer.length > this.config.maxBufferedEvents) {
                const overflowCount = this.buffer.length - this.config.maxBufferedEvents;
                this.buffer.splice(-overflowCount, overflowCount);
                this.droppedEvents += overflowCount;
            }
            return;
        }

        const overflowBatch = this.buffer.splice(0, this.config.maxBatchSize);
        this.emit(overflowBatch);
        if (nextEvent) {
            this.buffer.push(nextEvent);
        }
    }

    private emitDropNoticeIfNeeded(): void {
        if (!this.config.emitDropNotice || this.droppedEvents === 0) {
            return;
        }

        const referenceEvent = this.buffer[0];
        if (!referenceEvent) {
            this.droppedEvents = 0;
            return;
        }

        const droppedEvent: TraceEvent = {
            traceId: referenceEvent.traceId,
            runId: referenceEvent.runId,
            seq: referenceEvent.seq,
            ts: now(),
            type: 'trace_events_dropped',
            stage: 'trace',
            message: `${this.droppedEvents} trace events were dropped due to connection backpressure`,
            data: {
                droppedCount: this.droppedEvents,
            },
        };

        this.emit([droppedEvent]);
        this.droppedEvents = 0;
    }

    private emit(events: TraceEvent[]): void {
        if (events.length === 0) {
            return;
        }

        const message: TraceBatchMessage = {
            traceId: events[0]!.traceId,
            runId: events[0]!.runId,
            sentAt: now(),
            events,
        };

        void this.transport.send(this.config.serializer!(message));
    }

    private mergeConfig(config: Partial<WebSocketTraceConnectionConfig>): WebSocketTraceConnectionConfig {
        return {
            ...DEFAULT_CONFIG,
            ...config,
        };
    }
}
