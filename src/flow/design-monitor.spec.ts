// Specs for live flow design monitoring sessions and transport adapters.
import { describe, expect, it } from 'vitest';
import { InputBlock, ViewBlock } from './blocks';
import {
    CallbackFlowDesignConnection,
    FlowDesignSession,
    WebSocketFlowDesignConnection,
    type FlowDesignEvent,
} from './design-monitor';

describe('flow design monitor', () => {
    it('emits graph lifecycle, node lifecycle, and edge events with snapshots', () => {
        const events: FlowDesignEvent[] = [];
        const session = new FlowDesignSession(
            'design-session-1',
            [InputBlock, ViewBlock],
            new CallbackFlowDesignConnection(event => {
                events.push(event);
            }),
        );

        session.start({ request: 'design a simple flow' });
        session.stageNode('input-1', { label: 'Input', blockId: 'input', state: 'drafting' });
        session.createNode('input', {
            nodeId: 'input-1',
            label: 'Input',
            config: { input: 'hello' },
        });
        session.setNodePhase('input-1', 'ready', 'prompt-ready');

        session.stageNode('view-1', { label: 'Viewer', blockId: 'view' });
        session.createNode('view', {
            nodeId: 'view-1',
            label: 'Viewer',
        });
        session.connectPorts(
            {
                sourceNodeId: 'input-1',
                sourcePort: 'output',
                targetNodeId: 'view-1',
                targetPort: 'input',
            },
            {
                sourceAnchor: { side: 'right', offset: 0.25 },
                targetAnchor: { side: 'left', offset: 0.75 },
                flowHint: 'horizontal',
            },
        );
        session.complete({ status: 'completed' });

        expect(events.map(event => event.type)).toEqual([
            'graph_started',
            'node_staged',
            'node_created',
            'node_phase_changed',
            'node_staged',
            'node_created',
            'edge_created',
            'graph_completed',
        ]);
        expect(events[6]).toEqual(
            expect.objectContaining({
                type: 'edge_created',
                data: expect.objectContaining({
                    edge: expect.objectContaining({
                        source: 'input-1',
                        target: 'view-1',
                        flowHint: 'horizontal',
                        sourceAnchor: expect.objectContaining({
                            side: 'right',
                            offset: 0.25,
                            portId: 'input-1:output',
                        }),
                        targetAnchor: expect.objectContaining({
                            side: 'left',
                            offset: 0.75,
                            portId: 'view-1:input',
                        }),
                    }),
                }),
                snapshot: expect.objectContaining({
                    nodes: expect.arrayContaining([
                        expect.objectContaining({ id: 'input-1', phase: 'ready', state: 'prompt-ready' }),
                        expect.objectContaining({ id: 'view-1', phase: 'created' }),
                    ]),
                    edges: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'input-1:output->view-1:input',
                            source: 'input-1',
                            target: 'view-1',
                        }),
                    ]),
                }),
                reagraph: expect.objectContaining({
                    nodes: expect.arrayContaining([
                        expect.objectContaining({ id: 'input-1', phase: 'ready', state: 'prompt-ready' }),
                        expect.objectContaining({ id: 'view-1', phase: 'created' }),
                    ]),
                    edges: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'input-1:output->view-1:input',
                            source: 'input-1',
                            target: 'view-1',
                        }),
                    ]),
                }),
            }),
        );
    });

    it('supports clear, node update/delete, and edge delete for incremental UIs', () => {
        const events: FlowDesignEvent[] = [];
        const session = new FlowDesignSession(
            'design-session-2',
            [InputBlock, ViewBlock],
            new CallbackFlowDesignConnection(event => {
                events.push(event);
            }),
        );

        session.start();
        session.createNode('input', {
            nodeId: 'input-1',
            label: 'Input',
            config: { input: 'hello' },
        });
        session.createNode('view', {
            nodeId: 'view-1',
            label: 'View',
        });
        session.connectPorts({
            sourceNodeId: 'input-1',
            sourcePort: 'output',
            targetNodeId: 'view-1',
            targetPort: 'input',
        });
        session.updateNode('view-1', { label: 'Updated View', state: 'renamed' });
        session.deleteEdge('input-1:output->view-1:input');
        session.deleteNode('view-1');
        session.clear({ reason: 'restart' });

        expect(events.map(event => event.type)).toContain('node_updated');
        expect(events.map(event => event.type)).toContain('edge_deleted');
        expect(events.map(event => event.type)).toContain('node_deleted');
        expect(events[events.length - 1]).toEqual(
            expect.objectContaining({
                type: 'graph_cleared',
                snapshot: {
                    nodes: [],
                    edges: [],
                },
                reagraph: {
                    nodes: [],
                    edges: [],
                },
            }),
        );
    });

    it('serializes monitoring events over a websocket-style transport', () => {
        const payloads: string[] = [];
        const connection = new WebSocketFlowDesignConnection({
            send(payload) {
                payloads.push(payload);
            },
        });
        const session = new FlowDesignSession('design-session-3', [InputBlock], connection);

        session.start();
        session.stageNode('input-1', { label: 'Input', blockId: 'input' });

        expect(payloads).toHaveLength(2);
        expect(JSON.parse(payloads[1]!)).toEqual(
            expect.objectContaining({
                sessionId: 'design-session-3',
                type: 'node_staged',
                snapshot: expect.objectContaining({
                    nodes: [],
                    edges: [],
                }),
                reagraph: expect.objectContaining({
                    nodes: [],
                    edges: [],
                }),
            }),
        );
    });
});
