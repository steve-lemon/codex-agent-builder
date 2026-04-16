// Vitest specs for executable flow node runtimes.
import { describe, expect, it } from 'vitest';
import { AiGenerateBlock, BufferBlock, InputBlock, ViewBlock } from './blocks';
import { connectFlowPorts, createFlowDocument, createFlowNode, getFlowPortById, setFlowPortPacket } from './document';
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

    it('executes an input -> buffer -> view chain end-to-end with packet propagation', async () => {
        const logs: string[] = [];
        const sleeps: number[] = [];
        let flow = createFlowDocument([InputBlock, BufferBlock, ViewBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'input-1',
            config: {
                input: 'pipeline text',
            },
        }).flow;
        flow = createFlowNode(flow, 'buffer', {
            nodeId: 'buffer-1',
            config: {
                wait: '12',
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

        flow = await factory.create(flow, 'input-1').execute(flow);
        expect(getFlowPortById(flow, 'buffer-1:input')?.packet?.value).toBe('pipeline text');

        flow = await factory.create(flow, 'buffer-1').execute(flow);
        expect(getFlowPortById(flow, 'view-1:input')?.packet?.value).toBe('pipeline text');

        flow = await factory.create(flow, 'view-1').execute(flow);

        expect(getFlowPortById(flow, 'buffer-1:output')?.packet?.value).toBe('pipeline text');
        expect(getFlowPortById(flow, 'view-1:input')?.packet?.value).toBe('pipeline text');
        expect(sleeps).toEqual([12]);
        expect(logs).toEqual(['pipeline text']);
    });

    it('preserves null packets through buffer and logs them as null in the view block', async () => {
        const logs: string[] = [];
        let flow = createFlowDocument([BufferBlock, ViewBlock]);
        flow = createFlowNode(flow, 'buffer', {
            nodeId: 'buffer-1',
            config: {
                wait: '0',
            },
        }).flow;
        flow = createFlowNode(flow, 'view', {
            nodeId: 'view-1',
        }).flow;
        flow = setFlowPortPacket(flow, {
            nodeId: 'buffer-1',
            port: 'input',
            packet: {
                value: null,
                ts: 999,
            },
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
        });

        flow = await factory.create(flow, 'buffer-1').execute(flow);
        flow = await factory.create(flow, 'view-1').execute(flow);

        expect(getFlowPortById(flow, 'buffer-1:output')?.packet).toEqual({
            value: null,
            ts: 999,
        });
        expect(getFlowPortById(flow, 'view-1:input')?.packet).toEqual({
            value: null,
            ts: 999,
        });
        expect(logs).toEqual(['null']);
    });

    it('fails execution when required config is missing or invalid', async () => {
        let flow = createFlowDocument([InputBlock, BufferBlock, ViewBlock, AiGenerateBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'input-1',
        }).flow;
        flow = createFlowNode(flow, 'buffer', {
            nodeId: 'buffer-1',
            config: {
                wait: '-5',
            },
        }).flow;
        flow = createFlowNode(flow, 'view', {
            nodeId: 'view-1',
        }).flow;
        flow = createFlowNode(flow, 'ai-generate', {
            nodeId: 'ai-1',
            config: {
                model: 'mock-gpt',
            },
        }).flow;

        const factory = new DefaultExecutableFlowNodeFactory();

        await expect(factory.create(flow, 'input-1').execute(flow)).rejects.toThrow(/invalid and cannot execute/);
        await expect(factory.create(flow, 'buffer-1').execute(flow)).rejects.toThrow(/non-negative number/);
        await expect(factory.create(flow, 'view-1').execute(flow)).rejects.toThrow(/Input packet is missing/);
        await expect(factory.create(flow, 'ai-1').execute(flow)).rejects.toThrow(/Input packet is missing/);
    });

    it('executes the ai generate block with mocked text output', async () => {
        let flow = createFlowDocument([InputBlock, AiGenerateBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'system-1',
            config: {
                input: 'You are helpful.',
            },
        }).flow;
        flow = createFlowNode(flow, 'input', {
            nodeId: 'prompt-1',
            config: {
                input: 'Summarize the release notes.',
            },
        }).flow;
        flow = createFlowNode(flow, 'ai-generate', {
            nodeId: 'ai-1',
            config: {
                model: 'mock-gpt',
                jsonOutput: 'false',
            },
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'system-1',
            sourcePort: 'output',
            targetNodeId: 'ai-1',
            targetPort: 'system',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'prompt-1',
            sourcePort: 'output',
            targetNodeId: 'ai-1',
            targetPort: 'prompt',
        }).flow;

        const factory = new DefaultExecutableFlowNodeFactory({
            aiGenerate: async request => {
                return `[${request.model}] ${request.system} :: ${request.prompt}`;
            },
        });

        flow = await factory.create(flow, 'system-1').execute(flow);
        flow = await factory.create(flow, 'prompt-1').execute(flow);
        flow = await factory.create(flow, 'ai-1').execute(flow);

        expect(getFlowPortById(flow, 'ai-1:output')?.packet?.value).toBe(
            '[mock-gpt] You are helpful. :: Summarize the release notes.',
        );
    });

    it('executes the ai generate block with mocked json output', async () => {
        let flow = createFlowDocument([InputBlock, AiGenerateBlock]);
        flow = createFlowNode(flow, 'input', {
            nodeId: 'prompt-1',
            config: {
                input: 'Return a JSON object.',
            },
        }).flow;
        flow = createFlowNode(flow, 'ai-generate', {
            nodeId: 'ai-1',
            config: {
                model: 'mock-json-model',
                jsonOutput: 'true',
            },
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'prompt-1',
            sourcePort: 'output',
            targetNodeId: 'ai-1',
            targetPort: 'prompt',
        }).flow;

        const factory = new DefaultExecutableFlowNodeFactory({
            aiGenerate: async request => {
                return {
                    model: request.model,
                    ok: true,
                    prompt: request.prompt,
                };
            },
        });

        flow = await factory.create(flow, 'prompt-1').execute(flow);
        flow = await factory.create(flow, 'ai-1').execute(flow);

        expect(getFlowPortById(flow, 'ai-1:output')?.packet?.value).toEqual({
            model: 'mock-json-model',
            ok: true,
            prompt: 'Return a JSON object.',
        });
    });
});
