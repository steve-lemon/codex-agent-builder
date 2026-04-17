// Structured tracing types and tracer implementation.
import { now } from '../tools/now';
import { FileTraceStore } from './file-trace-store';
import type { TraceConnection, TraceDocument, TraceEvent, TraceStage, TraceStore } from './types';

interface TraceSession {
    traceId: string;
    runId: string;
    seq: number;
    events: TraceEvent[];
    connections: Set<TraceConnection>;
}

/** Collects, streams, and flushes structured trace sessions per run. */
export class AgentTracer {
    private readonly sessions = new Map<string, TraceSession>();

    private connection: TraceConnection | null = null;

    constructor(private readonly traceStore: TraceStore = new FileTraceStore()) {}

    startTrace(runId: string, traceId = runId): string {
        if (!this.sessions.has(runId)) {
            this.sessions.set(runId, {
                traceId,
                runId,
                seq: 0,
                events: [],
                connections: new Set(),
            });
        }

        return this.sessions.get(runId)!.traceId;
    }

    log(runId: string, type: string, data?: Record<string, unknown>): void {
        const session = this.getOrCreateSession(runId);
        const event: TraceEvent = {
            traceId: session.traceId,
            seq: session.seq + 1,
            ts: now(),
            stage: this.inferStage(type),
            message: this.formatMessage(type, data),
            runId,
            type,
            data,
        };

        session.seq = event.seq;
        session.events.push(event);

        //* report with default
        this.connection?.send(event);

        for (const connection of session.connections) {
            connection.send(event);
        }
    }

    getEvents(runId?: string): TraceEvent[] {
        if (!runId) {
            return Array.from(this.sessions.values()).flatMap(session => [...session.events]);
        }

        return [...(this.sessions.get(runId)?.events ?? [])];
    }

    /** set the default connection */
    setConnection(connection: TraceConnection) {
        this.connection = connection;
    }

    attachConnection(runId: string, connection: TraceConnection): void {
        this.getOrCreateSession(runId).connections.add(connection);
    }

    detachConnection(runId: string, connection: TraceConnection): void {
        this.sessions.get(runId)?.connections.delete(connection);
    }

    async flush(runId: string): Promise<TraceDocument> {
        const session = this.getOrCreateSession(runId);
        const document: TraceDocument = {
            traceId: session.traceId,
            runId,
            flushedAt: now(),
            events: [...session.events],
        };

        await this.traceStore?.save(document);
        return document;
    }

    clear(): void {
        this.sessions.clear();
    }

    private getOrCreateSession(runId: string): TraceSession {
        this.startTrace(runId);
        return this.sessions.get(runId)!;
    }

    private inferStage(type: string): TraceStage {
        if (type.startsWith('run_')) return 'run';
        if (type.startsWith('planner')) return 'planner';
        if (type.startsWith('step_')) return 'step';
        if (type.startsWith('tool_')) return 'tool';
        if (type.startsWith('diagnostic_')) return type === 'diagnostic_error' ? 'error' : 'runtime';
        if (type.startsWith('approval')) return 'approval';
        if (type.startsWith('reflector')) return 'reflector';
        if (type.startsWith('finalizer')) return 'finalizer';
        if (type === 'trace_flush') return 'trace';
        if (type === 'error') return 'error';
        return 'runtime';
    }

    private formatMessage(type: string, data?: Record<string, unknown>): string {
        switch (type) {
            case 'run_start':
                return 'Run started';
            case 'run_end':
                return `Run ended with status ${String(data?.status ?? 'unknown')}`;
            case 'skill_selected':
                return `Selected skill ${String(data?.skillName ?? 'unknown')}`;
            case 'planner_call':
                return 'Planner invoked';
            case 'step_start':
                return `Starting step ${String(data?.stepId ?? 'unknown')} (${String(data?.mode ?? 'unknown')})`;
            case 'step_end':
                return `Completed step ${String(data?.stepId ?? 'unknown')}`;
            case 'tool_start':
                return `Calling tool ${String(data?.toolName ?? 'unknown')}`;
            case 'tool_end':
                return `Tool ${String(data?.toolName ?? 'unknown')} completed`;
            case 'approval_wait':
                return `Waiting for approval on ${String(data?.toolName ?? 'unknown')}`;
            case 'approval_decision':
                return `Approval decision received: ${String(data?.decision ?? 'unknown')}`;
            case 'reflector_call':
                return 'Reflector invoked';
            case 'finalizer_call':
                return 'Finalizer invoked';
            case 'diagnostic_debug':
            case 'diagnostic_info':
            case 'diagnostic_warn':
            case 'diagnostic_error':
                // TODO(observability): Consider richer formatting for diagnostic events so
                // UIs can render scope/action separately instead of flattening into one message.
                return `${String(data?.scope ?? 'diagnostic')}: ${String(data?.message ?? type)}`;
            case 'trace_flush':
                return `Trace flushed to ${String(data?.path ?? 'unknown')}`;
            case 'error':
                return `Execution error: ${String(data?.message ?? 'unknown')}`;
            default:
                return type;
        }
    }
}
