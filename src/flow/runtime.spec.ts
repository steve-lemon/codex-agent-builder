// Vitest specs for executable flow node runtimes.
import { describe, expect, it } from 'vitest';
import { BufferBlock, InputBlock, ViewBlock } from './blocks';
import { connectFlowPorts, createFlowDocument, createFlowNode, getFlowPortById } from './document';
import { DefaultExecutableFlowNodeFactory } from './runtime';

describe('flow runtime', () => {
    it('executes the input block by writing config input into the output packet', async () => {
        let flow = createFlowDocument([InputBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'input-1',
            config: {
                input: 'hello world',
            },
        }).flow;

        const runtime = new DefaultExecutableFlowNodeFactory().create(flow, 'input-1');
        const nextFlow = await runtime.execute(flow);

        expect(getFlowPortById(nextFlow, 'input-1:output')?.packet?.value).toBe('hello world');
    });

    it('executes the buffer block by waiting and forwarding the input packet', async () => {
        let flow = createFlowDocument([InputBlock, BufferBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'input-1',
            config: {
                input: 'buffered text',
            },
        }).flow;
        flow = createFlowNode(flow, 'buffer', {
            nodeId: 'buffer-1',
            config: {
                wait: '5',
            },
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'input-1',
            sourcePort: 'output',
            targetNodeId: 'buffer-1',
            targetPort: 'input',
        }).flow;

        const factory = new DefaultExecutableFlowNodeFactory();
        flow = await factory.create(flow, 'input-1').execute(flow);
        flow = await factory.create(flow, 'buffer-1').execute(flow);

        expect(getFlowPortById(flow, 'buffer-1:input')?.packet).toEqual({
            value: 'buffered text',
            ts: getFlowPortById(flow, 'buffer-1:input')?.packet?.ts,
        });
        expect(getFlowPortById(flow, 'buffer-1:output')?.packet?.value).toBe('buffered text');
    });

    it('executes the view block by logging the input packet value', async () => {
        const logs: string[] = [];
        let flow = createFlowDocument([InputBlock, ViewBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'input-1',
            config: {
                input: 'visible text',
            },
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

        const factory = new DefaultExecutableFlowNodeFactory({
            logger: message => {
                logs.push(message);
            },
        });
        flow = await factory.create(flow, 'input-1').execute(flow);
        await factory.create(flow, 'view-1').execute(flow);

        expect(getFlowPortById(flow, 'view-1:input')?.packet?.value).toBe('visible text');
        expect(logs).toEqual(['visible text']);
    });
});
