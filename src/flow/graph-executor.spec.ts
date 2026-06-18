// Vitest specs for executing flow runtimes through the shared graph executor.
import { describe, expect, it } from 'vitest';
import { GraphExecutionEngine } from '../graph/executor';
import { BuiltinFlowBlockIds, getBuiltinFlowBlock } from './block-pool';
import { connectFlowPorts, createFlowDocument, createFlowNode, getFlowPortById } from './document';
import { planFlowGraph } from './graph';
import { DefaultExecutableFlowNodeFactory } from './runtime';
import type { FlowDocument } from './types';

describe('flow graph executor integration', () => {
    it('executes a flow graph end-to-end through the graph executor', async () => {
        const [InputBlock, BufferBlock, ViewBlock] = await Promise.all([
            getBuiltinFlowBlock(BuiltinFlowBlockIds.input),
            getBuiltinFlowBlock(BuiltinFlowBlockIds.buffer),
            getBuiltinFlowBlock(BuiltinFlowBlockIds.view),
        ]);
        const logs: string[] = [];
        const sleeps: number[] = [];
        let flow = createFlowDocument([InputBlock, BufferBlock, ViewBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'input-1',
            config: {
                input: 'graph pipeline',
            },
        }).flow;
        flow = createFlowNode(flow, 'buffer', {
            nodeId: 'buffer-1',
            config: {
                wait: '7',
            },
        }).flow;
        flow = createFlowNode(flow, 'view', {
            nodeId: 'view-1',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'input-1',
            sourcePort: 'output',
            targetNodeId: 'buffer-1',
            targetPort: 'input',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'buffer-1',
            sourcePort: 'output',
            targetNodeId: 'view-1',
            targetPort: 'input',
        }).flow;

        const factory = new DefaultExecutableFlowNodeFactory({
            logger: message => {
                logs.push(message);
            },
            sleep: async ms => {
                sleeps.push(ms);
            },
        });
        const planned = planFlowGraph(flow);
        let currentFlow: FlowDocument = flow;

        const engine = new GraphExecutionEngine<string>(async input => {
            const runtime = factory.create(currentFlow, input.node.id);
            currentFlow = await runtime.execute(currentFlow);
            return input.node.id;
        });
        const result = await engine.execute(planned.graph, planned.plan);

        expect(result.status).toBe('completed');
        expect(result.executionOrder).toEqual(['input-1', 'buffer-1', 'view-1']);
        expect(getFlowPortById(currentFlow, 'input-1:output')?.packet?.value).toBe('graph pipeline');
        expect(getFlowPortById(currentFlow, 'buffer-1:input')?.packet?.value).toBe('graph pipeline');
        expect(getFlowPortById(currentFlow, 'buffer-1:output')?.packet?.value).toBe('graph pipeline');
        expect(getFlowPortById(currentFlow, 'view-1:input')?.packet?.value).toBe('graph pipeline');
        expect(logs).toEqual(['graph pipeline']);
        expect(sleeps).toEqual([7]);
    });

    it('returns a failed graph run when a flow node is invalid for execution', async () => {
        const [InputBlock, ViewBlock] = await Promise.all([
            getBuiltinFlowBlock(BuiltinFlowBlockIds.input),
            getBuiltinFlowBlock(BuiltinFlowBlockIds.view),
        ]);
        let flow = createFlowDocument([InputBlock, ViewBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'input-1',
        }).flow;
        flow = createFlowNode(flow, 'view', {
            nodeId: 'view-1',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'input-1',
            sourcePort: 'output',
            targetNodeId: 'view-1',
            targetPort: 'input',
        }).flow;

        const factory = new DefaultExecutableFlowNodeFactory();
        const planned = planFlowGraph(flow);
        let currentFlow: FlowDocument = flow;

        const engine = new GraphExecutionEngine<string>(async input => {
            const runtime = factory.create(currentFlow, input.node.id);
            currentFlow = await runtime.execute(currentFlow);
            return input.node.id;
        });
        const result = await engine.execute(planned.graph, planned.plan);

        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/invalid and cannot execute/);
        expect(result.executionOrder).toEqual([]);
    });
});
