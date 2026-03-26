// Vitest specs for core runtime behaviors.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileTraceStore } from './file-trace-store';
import { AgentTracer } from './tracer';

describe('AgentTracer', () => {
    it('isolates trace sessions per run and emits clear execution messages', () => {
        const tracer = new AgentTracer();
        tracer.startTrace('run-1');
        tracer.startTrace('run-2');

        tracer.log('run-1', 'run_start', { userInput: 'hello' });
        tracer.log('run-1', 'tool_start', { toolName: 'getCustomerById' });
        tracer.log('run-2', 'run_start', { userInput: 'other' });

        const run1Events = tracer.getEvents('run-1');
        expect(run1Events).toHaveLength(2);
        expect(run1Events[0]?.traceId).toBe('run-1');
        expect(run1Events[0]?.seq).toBe(1);
        expect(run1Events[0]?.message).toBe('Run started');
        expect(run1Events[1]?.message).toBe('Calling tool getCustomerById');
        expect(tracer.getEvents('run-2')).toHaveLength(1);
    });

    it('streams trace events to attached websocket-like connections in real time', () => {
        const tracer = new AgentTracer();
        const received: string[] = [];
        const connection = {
            send(payload: string) {
                received.push(payload);
            },
        };

        tracer.attachConnection('run-live', connection);
        tracer.log('run-live', 'step_start', { stepId: 's1', mode: 'single-tool' });

        expect(received).toHaveLength(1);
        expect(JSON.parse(received[0] ?? '{}')).toEqual(
            expect.objectContaining({
                runId: 'run-live',
                type: 'step_start',
                stage: 'step',
                message: 'Starting step s1 (single-tool)',
            }),
        );
    });

    it('flushes JSON-compatible trace output to external storage', async () => {
        const outputDir = await mkdtemp(join(tmpdir(), 'agent-trace-'));
        const tracer = new AgentTracer(new FileTraceStore(outputDir));

        tracer.startTrace('run-flush');
        tracer.log('run-flush', 'run_start', { userInput: 'hello' });
        tracer.log('run-flush', 'run_end', { status: 'completed' });

        const document = await tracer.flush('run-flush');
        const saved = JSON.parse(await readFile(join(outputDir, 'run-flush.json'), 'utf-8')) as typeof document;

        expect(document.runId).toBe('run-flush');
        expect(saved.traceId).toBe('run-flush');
        expect(saved.events).toHaveLength(2);
        expect(saved.events[1]?.message).toBe('Run ended with status completed');
    });
});
