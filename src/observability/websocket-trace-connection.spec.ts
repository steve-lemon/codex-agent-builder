// Vitest specs for the buffered WebSocket trace connection.
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { TraceBatchMessage, TraceEvent, TraceTransport } from './types';
import { WebSocketTraceConnection } from './websocket-trace-connection';

function makeEvent(seq: number, runId = 'run-1'): TraceEvent {
    return {
        traceId: runId,
        runId,
        seq,
        ts: seq,
        type: `event_${seq}`,
        stage: 'runtime',
        message: `event ${seq}`,
    };
}

function parseMessages(sent: string[]): TraceBatchMessage[] {
    return sent.map(item => JSON.parse(item) as TraceBatchMessage);
}

describe('WebSocketTraceConnection', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends the first event immediately and batches subsequent events within the window', () => {
        vi.useFakeTimers();
        const sent: string[] = [];
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
        };
        const connection = new WebSocketTraceConnection(transport, {
            batchWindowMs: 500,
            maxBatchSize: 10,
            maxBufferedEvents: 20,
        });

        connection.send(makeEvent(1));
        connection.send(makeEvent(2));
        connection.send(makeEvent(3));

        expect(parseMessages(sent)).toHaveLength(1);
        expect(parseMessages(sent)[0]?.events.map(event => event.seq)).toEqual([1]);

        vi.advanceTimersByTime(499);
        expect(parseMessages(sent)).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(parseMessages(sent)).toHaveLength(2);
        expect(parseMessages(sent)[1]?.events.map(event => event.seq)).toEqual([2, 3]);
    });

    it('flushes early when the batch size limit is reached during the window', () => {
        vi.useFakeTimers();
        const sent: string[] = [];
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
        };
        const connection = new WebSocketTraceConnection(transport, {
            batchWindowMs: 500,
            maxBatchSize: 2,
            maxBufferedEvents: 5,
        });

        connection.send(makeEvent(1));
        connection.send(makeEvent(2));
        connection.send(makeEvent(3));

        const batches = parseMessages(sent);
        expect(batches).toHaveLength(2);
        expect(batches[0]?.events.map(event => event.seq)).toEqual([1]);
        expect(batches[1]?.events.map(event => event.seq)).toEqual([2, 3]);

        connection.send(makeEvent(4));
        expect(parseMessages(sent)).toHaveLength(3);
        expect(parseMessages(sent)[2]?.events.map(event => event.seq)).toEqual([4]);
    });

    it('caps buffered traffic by flushing overflow chunks when many events arrive quickly', () => {
        vi.useFakeTimers();
        const sent: string[] = [];
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
        };
        const connection = new WebSocketTraceConnection(transport, {
            batchWindowMs: 500,
            maxBatchSize: 3,
            maxBufferedEvents: 4,
        });

        connection.send(makeEvent(1));
        connection.send(makeEvent(2));
        connection.send(makeEvent(3));
        connection.send(makeEvent(4));
        connection.send(makeEvent(5));
        connection.send(makeEvent(6));

        const batches = parseMessages(sent);
        expect(batches.map(batch => batch.events.map(event => event.seq))).toEqual([[1], [2, 3, 4], [5]]);

        vi.advanceTimersByTime(500);
        const flushed = parseMessages(sent);
        expect(flushed.map(batch => batch.events.map(event => event.seq))).toEqual([[1], [2, 3, 4], [5], [6]]);
    });

    it('supports runtime config updates and explicit flush', () => {
        vi.useFakeTimers();
        const sent: string[] = [];
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
        };
        const connection = new WebSocketTraceConnection(transport, {
            batchWindowMs: 500,
            maxBatchSize: 10,
            maxBufferedEvents: 10,
        });

        connection.send(makeEvent(1));
        connection.send(makeEvent(2));
        connection.updateConfig({ batchWindowMs: 100, maxBatchSize: 2 });
        connection.send(makeEvent(3));

        expect(parseMessages(sent).map(batch => batch.events.map(event => event.seq))).toEqual([[1], [2, 3]]);

        connection.send(makeEvent(4));
        connection.send(makeEvent(5));
        connection.flush();

        expect(parseMessages(sent).map(batch => batch.events.map(event => event.seq))).toEqual([[1], [2, 3], [4], [5]]);
    });

    it('closes the underlying transport after flushing buffered events', () => {
        vi.useFakeTimers();
        const sent: string[] = [];
        const close = vi.fn();
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
            close,
        };
        const connection = new WebSocketTraceConnection(transport, {
            batchWindowMs: 500,
            maxBatchSize: 10,
            maxBufferedEvents: 10,
        });

        connection.send(makeEvent(1));
        connection.send(makeEvent(2));
        connection.close();

        expect(parseMessages(sent).map(batch => batch.events.map(event => event.seq))).toEqual([[1], [2]]);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('allows custom serialization for transport payloads', () => {
        const sent: string[] = [];
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
        };
        const connection = new WebSocketTraceConnection(transport, {
            serializer(message) {
                return `trace:${message.runId}:${message.events.length}`;
            },
        });

        connection.send(makeEvent(1, 'run-x'));

        expect(sent).toEqual(['trace:run-x:1']);
    });

    it('can drop overflow events and emit a notice with the dropped count', () => {
        vi.useFakeTimers();
        const sent: string[] = [];
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
        };
        const connection = new WebSocketTraceConnection(transport, {
            batchWindowMs: 500,
            maxBatchSize: 10,
            maxBufferedEvents: 2,
            overflowStrategy: 'drop',
            emitDropNotice: true,
        });

        connection.send(makeEvent(1));
        connection.send(makeEvent(2));
        connection.send(makeEvent(3));
        connection.send(makeEvent(4));
        connection.send(makeEvent(5));

        expect(parseMessages(sent).map(batch => batch.events.map(event => event.seq))).toEqual([[1]]);

        vi.advanceTimersByTime(500);

        const batches = parseMessages(sent);
        expect(batches).toHaveLength(3);
        expect(batches[1]?.events[0]).toEqual(
            expect.objectContaining({
                type: 'trace_events_dropped',
                stage: 'trace',
                data: {
                    droppedCount: 2,
                },
            }),
        );
        expect(batches[2]?.events.map(event => event.seq)).toEqual([2, 3]);
    });

    it('can drop overflow events silently when drop notices are disabled', () => {
        vi.useFakeTimers();
        const sent: string[] = [];
        const transport: TraceTransport = {
            send(payload) {
                sent.push(payload);
            },
        };
        const connection = new WebSocketTraceConnection(transport, {
            batchWindowMs: 500,
            maxBatchSize: 10,
            maxBufferedEvents: 1,
            overflowStrategy: 'drop',
            emitDropNotice: false,
        });

        connection.send(makeEvent(1));
        connection.send(makeEvent(2));
        connection.send(makeEvent(3));

        vi.advanceTimersByTime(500);

        expect(parseMessages(sent).map(batch => batch.events.map(event => event.seq))).toEqual([[1], [2]]);
    });
});
